"""Habit reminders, run every minute by beat (habits.tasks.send_habit_reminders).

- Per habit: at its reminder time (user's local time, on its reminder weekdays), if it's due today and
  not done yet. Limit habits (`at_most`) never remind: there's nothing to do.
- Evening nudge (HabitSettings.evening_nudge): at nudge_time, "2 habits left today" if any are left.

Both fire within a 2-hour catch-up window (a stopped worker doesn't lose the day) and at most once per
habit / user per local day (notifications.SentReminder keys).
"""

import datetime as dt

from django.db import IntegrityError
from django.utils import timezone

from notifications.models import SentReminder
from notifications.service import Priority, notify

from . import service
from .models import Habit, HabitSettings

WINDOW = dt.timedelta(hours=2)
URL = "/habits/"


def _local_moment(now, tz, local_date, at):
    naive = dt.datetime.combine(local_date, at)
    return tz.localize(naive) if hasattr(tz, "localize") else naive.replace(tzinfo=tz)


def _in_window(now, user, at):
    """(local date, True) when `now` is within WINDOW after `at` o'clock in the user's zone."""
    tz = service.user_tz(user)
    local = timezone.localtime(now, tz)
    start = _local_moment(now, tz, local.date(), at)
    return local.date(), start <= now < start + WINDOW


def _once(user, key):
    try:
        return SentReminder.objects.get_or_create(user=user, key=key[:160])[1]
    except IntegrityError:
        return False


def _unit(n, period):
    word = {"day": "day", "week": "week", "month": "month"}[period]
    return f"{n}-{word} streak"


def _num(x):
    return f"{x:g}"


def habit_reminders(now):
    due = []
    for h in Habit.objects.filter(reminder_time__isnull=False, archived=False, paused=False,
                                  goal=Habit.Goal.AT_LEAST).select_related("user"):
        day, live = _in_window(now, h.user, h.reminder_time)
        if live and (h.reminder_days >> day.weekday()) & 1:
            due.append((h, day, f"habit:{h.pk}:{day.isoformat()}"))
    if not due:
        return 0
    sent_keys = set(SentReminder.objects.filter(key__in=[k for _, _, k in due]).values_list("key", flat=True))
    due = [x for x in due if x[2] not in sent_keys]
    if not due:
        return 0
    edge = min(day for _, day, _ in due)
    entries = service.fetch_entries([h for h, _, _ in due], service.fetch_since(edge))
    sent = 0
    for h, day, key in due:
        row = service.today_row(h, entries[h.pk], day)
        if not row["due"] or row["done"] or not _once(h.user, key):
            continue
        if h.kind == Habit.Kind.MEASURABLE or h.period != Habit.Period.DAY:
            what = h.unit or "times"
            span = {"day": "today", "week": "this week", "month": "this month"}[h.period]
            body = f"{_num(row['period_value'])} of {_num(row['period_required'])} {what} {span}."
        else:
            body = ""
        if row["streak"] >= 2:
            body = f"{body} Keep your {_unit(row['streak'], h.period)} going.".strip()
        notify(h.user, f"Time for {h.name}", body, source="Habits", url=URL, priority=Priority.NORMAL,
               expires_in=dt.timedelta(days=1))
        sent += 1
    return sent


def evening_nudges(now):
    sent = 0
    for st in HabitSettings.objects.filter(evening_nudge=True).select_related("user"):
        day, live = _in_window(now, st.user, st.nudge_time)
        key = f"habits-nudge:{day.isoformat()}"
        if not live or SentReminder.objects.filter(user=st.user, key=key).exists():
            continue
        summary = service.today_summary(st.user, now)
        left = [r["habit"].name for r in summary["habits"]
                if r["due"] and not r["done"] and r["habit"].goal == Habit.Goal.AT_LEAST]
        if not left or not _once(st.user, key):
            continue
        n = len(left)
        body = ", ".join(left[:6]) + (f" and {n - 6} more" if n > 6 else "")
        notify(st.user, f"{n} habit{'s' * (n != 1)} left today", body, source="Habits", url=URL,
               priority=Priority.LOW, expires_in=dt.timedelta(hours=8))
        sent += 1
    return sent


def run(now=None):
    now = now or timezone.now()
    return {"habits": habit_reminders(now), "nudges": evening_nudges(now)}
