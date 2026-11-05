"""Habit rules: local days, schedules, goals, streaks, completion rates, score and stats.

Vocabulary
- A *unit* is what a goal is judged on: one day for `period=day`, one Monday-first week for `week`,
  one calendar month for `month`. Streaks count units (days, weeks or months).
- Each unit is DONE, MISSED, SKIPPED (excused), OFF (not scheduled, paused, or a period with nothing
  required) or PENDING (today / this period, goal not reached yet, nothing lost).
- Streaks count DONE units in a row; only MISSED breaks them. SKIPPED, OFF and PENDING are neutral.
- `at_least` goals: a day/period is DONE once the total reaches the target. `at_most` goals (measurable
  only): DONE while the total stays at or under the limit, including unlogged days (nothing logged = 0);
  going over makes it MISSED immediately, even today.
- Week/month goals: values from any day in the period count. Skipped days scale the target down in
  proportion to the scheduled days left (3x/week with 5 of 7 days skipped needs 1); a fully skipped
  period is SKIPPED. The first, partial period scales the same way.
- Score: Loop-style exponential smoothing of each judged unit (partial credit for measurable
  `at_least` goals), half-life 13 scheduled days for a daily habit, longer in units for sparser habits
  (13*sqrt(frequency)), 0-100.

Everything here works on in-memory entry maps ({date: (value, skipped)}) so callers fetch each date
range once (`fetch_entries`) and the rules never query per day.
"""

import calendar
import datetime as dt
import math
from collections import defaultdict
from dataclasses import dataclass

import pytz
from django.db import IntegrityError, transaction
from django.utils import timezone

from .models import Entry, Habit

DONE, MISSED, SKIPPED, OFF, PENDING = "done", "missed", "skipped", "off", "pending"
ONE_DAY = dt.timedelta(days=1)
WINDOW_DAYS = 400       # history fetched for the Today view; extended only for streaks longer than this
MAX_VALUE = 1_000_000
EPS = 1e-9


class RuleError(ValueError):
    """A request that breaks a habit rule (future date, wrong value...). The API turns it into a 400."""


# ------------------------------------------------------------------ days

def user_tz(user):
    name = getattr(user, "timezone", "") or ""
    return pytz.timezone(name) if name in pytz.all_timezones_set else timezone.get_current_timezone()


def local_today(user, now=None):
    """The user's calendar date right now (habits never use the server's date)."""
    return timezone.localtime(now or timezone.now(), user_tz(user)).date()


def period_start(period, day):
    if period == Habit.Period.WEEK:
        return day - dt.timedelta(days=day.weekday())
    if period == Habit.Period.MONTH:
        return day.replace(day=1)
    return day


def period_end(period, day):
    if period == Habit.Period.WEEK:
        return period_start(period, day) + dt.timedelta(days=6)
    if period == Habit.Period.MONTH:
        return day.replace(day=calendar.monthrange(day.year, day.month)[1])
    return day


def _days(start, end):
    for n in range((end - start).days + 1):
        yield start + dt.timedelta(days=n)


# ------------------------------------------------------------------ schedule & goal

def matches_rule(h, day):
    """The schedule rule alone (ignores the start/end dates)."""
    if h.schedule == Habit.Schedule.WEEKDAYS:
        return bool((h.weekdays >> day.weekday()) & 1)
    if h.schedule == Habit.Schedule.INTERVAL:
        return (day - h.start_date).days % max(1, h.interval) == 0
    return True


def is_scheduled(h, day):
    if day < h.start_date or (h.end_date and day > h.end_date):
        return False
    return matches_rule(h, day)


def frequency(h):
    """Scheduled units per day (1 = daily); drives the score's smoothing."""
    if h.period == Habit.Period.WEEK:
        return 1 / 7
    if h.period == Habit.Period.MONTH:
        return 1 / 30.44
    if h.schedule == Habit.Schedule.WEEKDAYS:
        return max(1, bin(h.weekdays & 0b1111111).count("1")) / 7
    if h.schedule == Habit.Schedule.INTERVAL:
        return 1 / max(1, h.interval)
    return 1.0


def meets(h, total, required=None):
    required = h.target if required is None else required
    if h.goal == Habit.Goal.AT_MOST:
        return total <= required + EPS
    return total >= required - EPS


def _paused_from(h):
    return h.paused_on if h.paused and h.paused_on else None


# ------------------------------------------------------------------ evaluation

@dataclass(slots=True)
class Unit:
    start: dt.date
    end: dt.date
    status: str
    total: float
    required: float
    credit: float  # 0..1, for the score


def evaluate(h, entries, today, since=None):
    """Judge every unit from the habit's start (or `since`) up to today. entries: {date: (value, skipped)}."""
    last = min(today, h.end_date) if h.end_date else today
    first = max(h.start_date, since) if since else h.start_date
    if first > last:
        return []
    if h.period == Habit.Period.DAY:
        return _evaluate_days(h, entries, today, first, last)
    return _evaluate_periods(h, entries, today, first, last)


def _evaluate_days(h, entries, today, first, last):
    units, paused = [], _paused_from(h)
    at_most = h.goal == Habit.Goal.AT_MOST
    target = h.target or 1
    for d in _days(first, last):
        value, skipped = entries.get(d, (0.0, False))
        if skipped:
            units.append(Unit(d, d, SKIPPED, 0, h.target, 0))
            continue
        ok = meets(h, value)
        if not matches_rule(h, d) or (paused and d >= paused and d not in entries):
            # Unscheduled: a met at-least goal is a bonus; nothing else counts either way.
            status = DONE if ok and not at_most and d in entries else OFF
            units.append(Unit(d, d, status, value, h.target, 1.0 if status == DONE else 0))
            continue
        if ok:
            status = DONE
        elif not at_most and d == today:
            status = PENDING
        else:
            status = MISSED
        credit = (1.0 if ok else 0.0) if at_most else min(1.0, value / target)
        units.append(Unit(d, d, status, value, h.target, credit))
    return units


def _evaluate_periods(h, entries, today, first, last):
    units, paused = [], _paused_from(h)
    at_most = h.goal == Habit.Goal.AT_MOST
    whole = h.kind == Habit.Kind.YESNO
    ps = period_start(h.period, first)
    while ps <= last:
        pe = period_end(h.period, ps)
        full = avail = 0
        total = 0.0
        for d in _days(ps, pe):
            in_range = h.start_date <= d and (not h.end_date or d <= h.end_date)
            value, skipped = entries.get(d, (0.0, False))
            if in_range and not skipped:
                total += value
            if matches_rule(h, d):
                full += 1
                if in_range and not skipped and not (paused and d >= paused and d not in entries):
                    avail += 1
        if at_most:
            required = h.target
        else:
            required = h.target * avail / full if full else 0
            if whole:
                required = math.ceil(required - EPS)
        current = pe >= today
        if not at_most and required <= EPS:
            status, credit = (SKIPPED if avail < full else OFF), 0.0
        elif meets(h, total, required):
            status, credit = DONE, 1.0
        elif current and not at_most:
            status, credit = PENDING, min(1.0, total / required)
        else:
            status, credit = MISSED, (0.0 if at_most else min(1.0, total / required))
        units.append(Unit(ps, min(pe, last), status, total, required, credit))
        ps = pe + ONE_DAY
    return units


def streaks(units):
    """(current, best): DONE units in a row; MISSED breaks, everything else is neutral."""
    run = best = 0
    for u in units:
        if u.status == DONE:
            run += 1
            if run > best:
                best = run
        elif u.status == MISSED:
            run = 0
    return run, best


def completion_rates(units, today, first_day):
    """Share of judged units that were DONE, over windows ending today (None when nothing was judged)."""
    out = {}
    for key, days in (("d7", 7), ("d30", 30), ("d90", 90), ("all", None)):
        lo = today - dt.timedelta(days=days - 1) if days else first_day
        done = judged = 0
        for u in units:
            if u.end >= lo and u.status in (DONE, MISSED):
                judged += 1
                done += u.status == DONE
        out[key] = done / judged if judged else None
    return out


def score_series(h, units):
    """[(date, score 0-100)] after each judged unit."""
    half_life = 13 * math.sqrt(frequency(h))
    m = 0.5 ** (1 / max(half_life, 1))
    s, out = 0.0, []
    for u in units:
        if u.status in (DONE, MISSED):
            s = s * m + u.credit * (1 - m)
            out.append((u.end, s * 100))
    return out


# ------------------------------------------------------------------ queries

def fetch_entries(habits, since=None, until=None):
    """{habit_id: {date: (value, skipped)}} for several habits in one query."""
    by_habit = defaultdict(dict)
    if not habits:
        return by_habit
    qs = Entry.objects.filter(habit_id__in=[h.pk for h in habits])
    if since:
        qs = qs.filter(date__gte=since)
    if until:
        qs = qs.filter(date__lte=until)
    for hid, d, value, skipped in qs.values_list("habit_id", "date", "value", "skipped"):
        by_habit[hid][d] = (value, skipped)
    return by_habit


def _units_with_streak(h, entries, today, since):
    """Units since `since`, re-evaluated from the start if the current streak may reach further back."""
    units = evaluate(h, entries, today, since)
    if since > h.start_date and not any(u.status == MISSED for u in units):
        entries = fetch_entries([h])[h.pk]
        units = evaluate(h, entries, today)
    return units, entries


def today_state(h, entries, today, units=None):
    """Today's status for one habit, from its entries map. The flags are deliberately separate:

    - goal_met:   this day's/period's goal is reached (at_least) or the limit is kept so far (at_most)
    - done:       a checklist item that's finished: an at_least habit whose goal is met (never at_most)
    - done_today: today's own entry does the job (yes/no ticked; a daily amount reached; any amount
                  logged towards a week/month goal). A weekly habit can be done_today and not goal_met.
    - status:     one word for widgets: done, partial, pending, kept, over, skipped, off
    """
    units = evaluate(h, entries, today, period_start(h.period, today)) if units is None else units
    value, skipped = entries.get(today, (0.0, False))
    live = (not h.archived and not h.paused and h.start_date <= today
            and (not h.end_date or today <= h.end_date))
    cur = units[-1] if units and units[-1].end >= today else None
    at_most = h.goal == Habit.Goal.AT_MOST
    goal_met = bool(cur and cur.status == DONE) and not skipped
    over = bool(cur and cur.status == MISSED and at_most)
    if skipped or at_most:
        done_today = False
    elif h.kind == Habit.Kind.YESNO:
        done_today = value >= 1
    else:
        done_today = value >= h.target - EPS if h.period == Habit.Period.DAY else value > 0
    due = live and matches_rule(h, today) and not skipped
    period_value = cur.total if cur else 0.0
    if skipped:
        status = "skipped"
    elif not due and not done_today:
        status = "off"
    elif at_most:
        status = "over" if over else "kept"
    elif goal_met:
        status = "done"
    else:
        status = "partial" if done_today or value > 0 or period_value > 0 else "pending"
    return {
        "due": due, "done": goal_met and not at_most, "goal_met": goal_met, "done_today": done_today,
        "over": over, "status": status, "value": value, "skipped": skipped,
        "period_value": period_value, "period_required": cur.required if cur else h.target,
    }


def _since(h, today):
    return period_start(h.period, today - dt.timedelta(days=WINDOW_DAYS))


def fetch_since(today):
    edge = today - dt.timedelta(days=WINDOW_DAYS)
    return min(period_start(Habit.Period.WEEK, edge), period_start(Habit.Period.MONTH, edge))


def today_row(h, entries, today, note=""):
    units, entries = _units_with_streak(h, entries, today, _since(h, today))
    state = today_state(h, entries, today, units)
    lo = today - dt.timedelta(days=6)
    week = [u.status for u in units if u.end >= lo and u.status in (DONE, MISSED)]
    return {"habit": h, **state, "note": note, "streak": streaks(units)[0], "streak_unit": h.period,
            "_week": (week.count(DONE), len(week))}


def habit_today(h, today):
    """One habit's Today row (after a check or an edit)."""
    entries = fetch_entries([h], fetch_since(today))[h.pk]
    note = Entry.objects.filter(habit=h, date=today).values_list("note", flat=True).first() or ""
    return today_row(h, entries, today, note)


def today_summary(user, now=None, habits=None):
    """Every non-archived habit with today's status and current streak. Three small queries usually."""
    today = local_today(user, now)
    if habits is None:
        habits = list(Habit.objects.filter(user=user, archived=False))
    entries = fetch_entries(habits, fetch_since(today))
    notes = dict(Entry.objects.filter(habit__in=habits, date=today).exclude(note="").values_list("habit_id", "note"))
    rows = [today_row(h, entries[h.pk], today, notes.get(h.pk, "")) for h in habits]
    due = [r for r in rows if r["due"] and r["habit"].goal == Habit.Goal.AT_LEAST]
    done = sum(r["done"] for r in due)
    week_done, week_judged = (sum(r["_week"][i] for r in rows) for i in (0, 1))
    return {"date": today, "done": done, "total": len(due), "left": len(due) - done,
            "over": sum(r["over"] for r in rows), "week_done": week_done, "week_judged": week_judged,
            "habits": rows}


# ------------------------------------------------------------------ stats

HEAT_WEEKS = 53


def _heat_char(h, u_by_day, d, entries):
    """One heatmap cell: '0'-'4' intensity, 's' skipped, 'o' off/not scheduled, '-' outside the habit's dates."""
    if d < h.start_date or (h.end_date and d > h.end_date):
        return "-"
    value, skipped = entries.get(d, (0.0, False))
    if skipped:
        return "s"
    if h.period == Habit.Period.DAY:
        u = u_by_day.get(d)
        if u is None or u.status == OFF:
            return "o"
        if u.status == DONE:
            return "4"
        return str(min(3, int(u.credit * 4))) if u.credit else "0"
    if value <= 0:
        return "0" if matches_rule(h, d) else "o"
    per_day = h.target / (7 if h.period == Habit.Period.WEEK else 30.44)
    if h.kind == Habit.Kind.YESNO or h.goal == Habit.Goal.AT_MOST:
        return "4"
    return str(max(1, min(4, math.ceil(4 * value / max(per_day, EPS)))))


def habit_stats(h, today):
    """Streaks, rates, score (+ trend), a year heatmap, weekday breakdown and totals. One query."""
    rows = list(Entry.objects.filter(habit=h).values_list("date", "value", "skipped", "note"))
    entries = {d: (v, s) for d, v, s, _ in rows}
    units = evaluate(h, entries, today)
    current, best = streaks(units)
    series = score_series(h, units)

    trend, i, s = [], 0, 0.0
    for w in range(25, -1, -1):
        point = today - dt.timedelta(days=7 * w)
        while i < len(series) and series[i][0] <= point:
            s = series[i][1]
            i += 1
        if point >= h.start_date - dt.timedelta(days=7):
            trend.append({"date": point, "score": round(s, 1)})

    heat_start = period_start(Habit.Period.WEEK, today) - dt.timedelta(weeks=HEAT_WEEKS - 1)
    by_day = {u.start: u for u in units} if h.period == Habit.Period.DAY else {}
    heat_days = list(_days(heat_start, today))
    heat = {"start": heat_start, "end": today,
            "levels": "".join(_heat_char(h, by_day, d, entries) for d in heat_days),
            "values": [entries[d][0] if d in entries and not entries[d][1] else None for d in heat_days]}

    weekdays = [{"weekday": n, "done": 0, "judged": 0, "rate": None, "average": None} for n in range(7)]
    sums, counts = [0.0] * 7, [0] * 7
    if h.period == Habit.Period.DAY:
        for u in units:
            if u.status in (DONE, MISSED):
                w = weekdays[u.start.weekday()]
                w["judged"] += 1
                w["done"] += u.status == DONE
    for d, (v, sk) in entries.items():
        if not sk and d <= today:
            sums[d.weekday()] += v
            counts[d.weekday()] += 1
            if h.period != Habit.Period.DAY and v > 0:
                weekdays[d.weekday()]["done"] += 1
    for n, w in enumerate(weekdays):
        w["rate"] = w["done"] / w["judged"] if w["judged"] else None
        w["average"] = sums[n] / counts[n] if counts[n] else None

    logged = [(d, v) for d, (v, sk) in entries.items() if not sk and d <= today and v > 0]
    week0, month0 = period_start("week", today), today.replace(day=1)
    totals = {"total": sum(v for _, v in logged), "week": sum(v for d, v in logged if d >= week0),
              "month": sum(v for d, v in logged if d >= month0), "days": len(logged),
              "average": (sum(v for _, v in logged) / len(logged)) if logged else None,
              "best": max((v for _, v in logged), default=None)}

    cur = units[-1] if units and units[-1].end >= today else None
    return {
        "habit_id": h.pk, "today": today, "streak_unit": h.period,
        "current_streak": current, "best_streak": best,
        "score": round(series[-1][1], 1) if series else 0.0,
        "rates": completion_rates(units, today, h.start_date),
        "period_value": cur.total if cur else 0.0, "period_required": cur.required if cur else h.target,
        "score_trend": trend, "heatmap": heat, "weekdays": weekdays, "totals": totals,
        "notes": [{"date": d, "note": n, "value": v, "skipped": sk}
                  for d, v, sk, n in sorted(rows, reverse=True) if n][:30],
    }


def overview(user, now=None):
    """Today's progress plus every active habit's current and best streak (one entries query)."""
    summary = today_summary(user, now)
    today = summary["date"]
    habits = [r["habit"] for r in summary["habits"]]
    all_entries = fetch_entries(habits)
    streak_rows, week_done = [], 0
    week_judged = 0
    for h in habits:
        units = evaluate(h, all_entries[h.pk], today)
        current, best = streaks(units)
        streak_rows.append({"habit_id": h.pk, "name": h.name, "colour": h.colour, "current": current,
                            "best": best, "unit": h.period})
        for u in units:
            if u.end > today - dt.timedelta(days=7) and u.status in (DONE, MISSED):
                week_judged += 1
                week_done += u.status == DONE
    streak_rows.sort(key=lambda r: (-r["current"], -r["best"], r["name"]))
    return {"date": today, "done": summary["done"], "total": summary["total"], "left": summary["left"],
            "over": summary["over"], "week_rate": week_done / week_judged if week_judged else None,
            "streaks": streak_rows}


# ------------------------------------------------------------------ writes

def check_day(h, day, today):
    if day > today:
        raise RuleError("Future days can't be logged yet")
    if day < h.start_date:
        raise RuleError(f"This habit starts on {h.start_date.isoformat()}")
    if h.end_date and day > h.end_date:
        raise RuleError(f"This habit ended on {h.end_date.isoformat()}")


def check_value(h, value):
    if h.kind == Habit.Kind.YESNO and value not in (0, 1):
        raise RuleError("A yes/no habit takes 1 (done) or 0 (not done)")
    if not (0 <= value <= MAX_VALUE) or math.isnan(value):
        raise RuleError(f"Value must be between 0 and {MAX_VALUE}")


def save_entry(h, day, today, *, value=None, note=None, skipped=None):
    """Create or update the one entry for (habit, day). Fields left as None keep their stored value."""
    check_day(h, day, today)
    if value is not None:
        check_value(h, value)
    fields = {k: v for k, v in (("value", value), ("note", note), ("skipped", skipped)) if v is not None}
    for _ in range(2):  # a concurrent insert of the same day loses the race once, then updates
        try:
            with transaction.atomic():
                entry, created = Entry.objects.select_for_update().get_or_create(habit=h, date=day, defaults=fields)
                if not created and fields:
                    for k, v in fields.items():
                        setattr(entry, k, v)
                    entry.save(update_fields=[*fields, "updated_on"])
                if not entry.value and not entry.skipped and not entry.note:  # nothing left: keep the table lean
                    entry.delete()
                    return Entry(habit=h, date=day, value=0)
                return entry
        except IntegrityError:
            continue
    raise RuleError("Couldn't save that entry, try again")


def check(h, today, *, amount=None, done=None, day=None):
    """Tap / shortcut action: toggle a yes/no habit, or add `amount` (default 1) to a measurable one."""
    day = day or today
    check_day(h, day, today)
    entry = Entry.objects.filter(habit=h, date=day).first()
    cur = entry.value if entry and not entry.skipped else 0.0
    if h.kind == Habit.Kind.YESNO:
        new = float(done) if done is not None else (0.0 if cur >= 1 else 1.0)
    elif done is not None and amount is None:
        new = max(cur, h.target) if done and h.period == Habit.Period.DAY else (cur + 1 if done else 0.0)
    else:
        new = min(MAX_VALUE, max(0.0, cur + (1 if amount is None else amount)))
    if new == 0 and (entry is None or not entry.note):
        if entry:
            entry.delete()
        return Entry(habit=h, date=day, value=0)
    return save_entry(h, day, today, value=round(new, 4), skipped=False)


def set_paused(h, paused, today):
    """Pausing freezes the habit; resuming marks the scheduled days in between as skipped."""
    if paused and not h.paused:
        h.paused, h.paused_on = True, today
    elif not paused and h.paused:
        start = max(h.paused_on or today, h.start_date)
        end = min(today - ONE_DAY, h.end_date) if h.end_date else today - ONE_DAY
        Entry.objects.bulk_create([Entry(habit=h, date=d, skipped=True) for d in _days(start, end)
                                   if matches_rule(h, d)] if start <= end else [], ignore_conflicts=True)
        h.paused, h.paused_on = False, None
    h.save(update_fields=["paused", "paused_on", "updated_on"])
