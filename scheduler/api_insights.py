"""/api/v2/calendar/: agenda, someone's availability and insights (where your time went)."""

import datetime
from typing import Literal, Optional

from django.shortcuts import get_object_or_404
from ninja import Router, Schema

from . import service as svc
from .models import Subscriber

router = Router()  # tags come from scheduler.api_v2.router


# ---------------------------------------------------------------- agenda + insights

class AgendaItem(Schema):
    kind: Literal["event", "all_day", "deadline", "todo"]
    id: str
    title: str
    start: Optional[datetime.datetime]
    end: Optional[datetime.datetime]
    colour: str
    calendar: str
    location: Optional[str] = None
    done: bool = False
    priority: int = 10
    has_todo: bool = False  # deadline already copied into Tasks
    series_id: Optional[str] = None
    status: Optional[str] = None
    icon: Optional[str] = None
    start_date: Optional[datetime.date] = None
    end_date: Optional[datetime.date] = None


def _user_tz(user):
    import pytz
    from django.utils import timezone as tz_
    return pytz.timezone(user.timezone) if user.timezone in pytz.all_timezones_set else tz_.get_current_timezone()


@router.get("/availability/{username}", auth=None,
            summary="Someone's busy times on a day, only from calendars they share as busy (times only; no sign-in needed)")
def availability(request, username: str, date: datetime.date):
    import pytz
    from django.db.models import Q

    from users.models import ComptechUser

    from . import service as svc_
    user = get_object_or_404(ComptechUser, username=username, is_active=True)
    tz = pytz.timezone(user.timezone) if user.timezone in pytz.all_timezones_set else pytz.timezone("America/Toronto")
    day = tz.localize(datetime.datetime.combine(date, datetime.time()))
    subs = Subscriber.objects.filter(user=user, calendar__active=True, display_busy__in=[1, 2])
    some = [s.calendar_id for s in subs if s.display_busy == 1]  # only "busy" kinds of events
    every = [s.calendar_id for s in subs if s.display_busy == 2]
    busy_categories = [1, 2, 4, 5, 6, 7, 9]
    evs = svc_.events_in_range(some + every, day, day + datetime.timedelta(days=1), related=("calendar",), extra=(
        Q(transparency="busy", enddate__isnull=False, kind="event")  # timed events only: not all-day or deadlines
        & (Q(calendar__in=every) | Q(calendar__in=some, category__in=busy_categories))))
    return {"username": user.username, "name": user.get_full_name() or user.username, "date": date,
            "busy": [{"start": e.startdate, "end": e.enddate} for e in evs]}


@router.get("/agenda", response=list[AgendaItem], summary="Upcoming events, deadlines and due todos, merged")
def agenda(request, days: int = 14, include_overdue: bool = True):
    from django.utils import timezone as tz_

    from scheduler.models import Todo

    days = max(1, min(days, 90))
    tz = _user_tz(request.user)
    now = tz_.now()
    start = tz_.localtime(now, tz).replace(hour=0, minute=0, second=0, microsecond=0)
    end = start + datetime.timedelta(days=days)
    subs = {s.calendar_id: s for s in Subscriber.objects.filter(user=request.user, visible=True, calendar__active=True)
            .select_related("calendar")}
    todo_events = set(Todo.objects.filter(user=request.user, custom_info__has_key="event_id")
                      .values_list("custom_info__event_id", flat=True))
    items = []
    for e in svc.events_in_range(list(subs), now if not include_overdue else start, end, limit=500):
        if e.enddate and e.enddate < now and e.kind != "all_day":
            continue  # already over
        s = subs[e.calendar_id]
        masked = svc.masked_for(e, request.user, s.role)
        icon = e.icon or (e.event_category.icon if e.event_category_id else None) or None
        items.append({"kind": e.kind, "id": e.ident(), "title": "Busy" if masked else e.name, "start": e.startdate,
                      "end": e.enddate, "colour": e.display_colour(s.colour), "calendar": s.calendar.name,
                      "location": None if masked else e.location, "done": e.completed, "priority": e.priority,
                      "has_todo": e.ident() in todo_events, "series_id": str(e.series()) if e.series() else None,
                      "status": e.status, "icon": icon, "start_date": e.start_date, "end_date": e.end_date})
    todos = Todo.objects.filter(user=request.user, completed=False, complete_by__lt=end)
    if not include_overdue:
        todos = todos.filter(complete_by__gte=now)
    for t in todos.select_related("project").order_by("complete_by")[:200]:
        items.append({"kind": "todo", "id": str(t.id), "title": t.name, "start": t.complete_by, "end": None,
                      "colour": (t.project.colour if t.project_id and t.project.colour else "#64748b"),
                      "calendar": t.project.name if t.project_id else "Tasks", "priority": t.priority})
    items.sort(key=lambda i: (i["start"] or end, i["kind"] != "all_day"))
    return items


class InsightsOut(Schema):
    period: str
    start: datetime.date
    end: datetime.date
    totals: dict
    previous: dict
    by_category: list[dict]
    by_calendar: list[dict]
    by_weekday: list[float]
    by_hour: list[float]
    heat: list[list[float]]
    per_day: list[dict]
    todos: dict
    top_locations: list[dict]
    photos: int


def _split_hours(start, end, tz, rs, re_):
    """Yield (local_datetime_hour_start, hours) pieces of [start, end) clipped to [rs, re_)."""
    s, e = max(start, rs), min(end, re_, start + datetime.timedelta(hours=24))
    while s < e:
        local = s.astimezone(tz)
        nxt = (local.replace(minute=0, second=0, microsecond=0) + datetime.timedelta(hours=1)).astimezone(datetime.timezone.utc)
        piece_end = min(nxt, e)
        yield local, (piece_end - s).total_seconds() / 3600
        s = piece_end


def _period_stats(user, start, end, tz):
    cals = Subscriber.objects.filter(user=user, visible=True, calendar__active=True).select_related("calendar")
    colours = {s.calendar_id: (s.colour or s.calendar.colour, s.calendar.name) for s in cals}
    roles = {s.calendar_id: s.role for s in cals}
    events = svc.events_in_range(list(colours), start, end, related=("calendar", "event_category"))
    days = (end - start).days
    per_day = [0.0] * days
    per_day_n = [0] * days
    by_weekday, by_hour = [0.0] * 7, [0.0] * 24
    heat = [[0.0] * 24 for _ in range(7)]
    cat, cal, loc = {}, {}, {}
    legacy_hours = {}
    timed = [e for e in events if e.kind == "event" and e.enddate]
    deadlines = [e for e in events if e.kind == "deadline" and start <= e.startdate < end]
    all_day = [e for e in events if e.kind == "all_day"]
    hours = 0.0
    starts, ends, lengths = [], [], []
    for e in timed:
        h_total = 0.0
        for local, h in _split_hours(e.startdate, e.enddate, tz, start, end):
            idx = (local.date() - start.astimezone(tz).date()).days
            if 0 <= idx < days:
                per_day[idx] += h
            by_weekday[local.weekday()] += h
            by_hour[local.hour] += h
            heat[local.weekday()][local.hour] += h
            h_total += h
        hours += h_total
        if start <= e.startdate < end:
            idx = (e.startdate.astimezone(tz).date() - start.astimezone(tz).date()).days
            if 0 <= idx < days:
                per_day_n[idx] += 1
            ls = e.startdate.astimezone(tz)
            le = e.enddate.astimezone(tz)
            starts.append(ls.hour * 60 + ls.minute)
            ends.append(le.hour * 60 + le.minute)
            lengths.append((e.enddate - e.startdate).total_seconds() / 60)
        ec = e.event_category if e.event_category_id else None
        # Categories belong to each calendar's owner: merge same-named ones (e.g. your "Meeting" and a
        # shared calendar's "meeting") into one row, shown with your own category's id/colour/icon if you have one.
        name = ec.name if ec else "Uncategorized"
        c = cat.setdefault(name.strip().casefold(), {
            "id": e.event_category_id, "label": name, "name": name,
            "colour": ec.colour if ec else "", "icon": ec.icon if ec else "",
            "legacy_id": ec.legacy_id if ec else 0, "hours": 0, "events": 0})
        if ec and ec.owner_id == user.id and c["id"] != ec.id:
            c.update(id=ec.id, label=ec.name, name=ec.name, colour=ec.colour, icon=ec.icon, legacy_id=ec.legacy_id)
        c["hours"] += h_total
        c["events"] += 1
        lid = ec.legacy_id if ec else e.category
        legacy_hours[lid] = legacy_hours.get(lid, 0) + h_total
        colour, name = colours[e.calendar_id]
        k = cal.setdefault(e.calendar_id, {"id": e.calendar_id, "name": name, "colour": colour, "hours": 0, "events": 0})
        k["hours"] += h_total
        k["events"] += 1
        if e.location and not svc.masked_for(e, user, roles.get(e.calendar_id)):  # others' private events: times only
            loc[e.location] = loc.get(e.location, 0) + 1

    def median_clock(values):
        if not values:
            return None
        v = sorted(values)[len(values) // 2]
        return f"{v // 60:02d}:{v % 60:02d}"

    local_start = start.astimezone(tz).date()
    busiest = max(range(days), key=lambda i: per_day[i]) if days and any(per_day) else None
    r = lambda x: round(x, 2)
    return {
        "events": events, "timed": timed,
        "totals": {"events": len(timed) + len(all_day) + len(deadlines), "timed_events": len(timed),
                   "hours": r(hours), "deadlines": len(deadlines), "all_day": len(all_day),
                   "avg_minutes": round(sum(lengths) / len(lengths)) if lengths else 0,
                   "longest_minutes": round(max(lengths)) if lengths else 0,
                   "busiest_day": {"date": (local_start + datetime.timedelta(days=busiest)).isoformat(),
                                   "hours": r(per_day[busiest])} if busiest is not None else None,
                   "free_days": sum(1 for h in per_day if h == 0),
                   "typical_start": median_clock(starts), "typical_end": median_clock(ends),
                   "evening_hours": r(sum(by_hour[18:])), "early_hours": r(sum(by_hour[:8])),
                   "weekend_hours": r(by_weekday[5] + by_weekday[6]),
                   "meeting_hours": r(legacy_hours.get(1, 0)), "focus_hours": r(legacy_hours.get(2, 0))},
        "by_category": sorted(({**c, "hours": r(c["hours"])} for c in cat.values()), key=lambda c: -c["hours"]),
        "by_calendar": sorted(({**c, "hours": r(c["hours"])} for c in cal.values()), key=lambda c: -c["hours"]),
        "by_weekday": [r(x) for x in by_weekday], "by_hour": [r(x) for x in by_hour],
        "heat": [[r(x) for x in row] for row in heat],
        "per_day": [{"date": (local_start + datetime.timedelta(days=i)).isoformat(), "hours": r(per_day[i]),
                     "events": per_day_n[i]} for i in range(days)],
        "top_locations": [{"name": k, "count": v} for k, v in sorted(loc.items(), key=lambda kv: -kv[1])[:5]],
    }


@router.get("/insights", response=InsightsOut, summary="Where your time went this week/month, compared with the previous one")
def insights(request, period: Literal["week", "month"] = "week", date: Optional[datetime.date] = None):
    from django.utils import timezone as tz_

    from photos.api_v2 import library
    from scheduler.models import Todo

    tz = _user_tz(request.user)
    day = date or tz_.localtime(tz_.now(), tz).date()
    if period == "week":
        first = day - datetime.timedelta(days=day.weekday())
        last = first + datetime.timedelta(days=7)
        prev_first = first - datetime.timedelta(days=7)
    else:
        first = day.replace(day=1)
        last = (first + datetime.timedelta(days=32)).replace(day=1)
        prev_first = (first - datetime.timedelta(days=1)).replace(day=1)
    loc = lambda d: tz.localize(datetime.datetime.combine(d, datetime.time()))
    start, end, prev_start = loc(first), loc(last), loc(prev_first)
    cur = _period_stats(request.user, start, end, tz)
    prev = _period_stats(request.user, prev_start, start, tz)
    todos = Todo.objects.filter(user=request.user)
    return {
        "period": period, "start": first, "end": last - datetime.timedelta(days=1),
        "totals": cur["totals"],
        "previous": {**{k: prev["totals"][k] for k in ("events", "hours", "deadlines", "meeting_hours", "focus_hours")},
                     "photos": library(request.user).filter(date_taken__gte=prev_start, date_taken__lt=start).count()},
        "by_category": cur["by_category"], "by_calendar": cur["by_calendar"],
        "by_weekday": cur["by_weekday"], "by_hour": cur["by_hour"], "heat": cur["heat"], "per_day": cur["per_day"],
        "todos": {"completed": todos.filter(completed_on__gte=start, completed_on__lt=end).count(),
                  "completed_previous": todos.filter(completed_on__gte=prev_start, completed_on__lt=start).count(),
                  "created": todos.filter(created_on__gte=start, created_on__lt=end).count(),
                  "due": todos.filter(complete_by__gte=start, complete_by__lt=end).count(),
                  "overdue_now": todos.filter(completed=False, complete_by__lt=tz_.now()).count()},
        "top_locations": cur["top_locations"],
        "photos": library(request.user).filter(date_taken__gte=start, date_taken__lt=end).count(),
    }
