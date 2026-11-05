"""/api/v2/calendar/: calendars you're subscribed to and their events."""

import datetime
import uuid
from typing import Literal, Optional

import bleach
from django.db import transaction
from django.shortcuts import get_object_or_404
from ninja import Field, Router, Schema
from ninja.errors import HttpError

from notifications.service import notify

from .models import Calendar, Event, Invite, Subscriber

router = Router(tags=["calendar"])
EDITOR = (0, 1)  # owner, admin
CATEGORIES = dict(Event._meta.get_field("category").choices)


class CalendarOut(Schema):
    id: int
    name: str
    colour: str
    role: Literal["owner", "admin", "subscriber"]
    visible: bool
    active: bool
    public: bool
    calendar_type: int
    synced: bool
    can_edit: bool


class CalendarIn(Schema):
    name: str = Field(..., min_length=1, max_length=64)
    colour: str = Field("#1a73e8", pattern=r"^#[0-9a-fA-F]{6}$")


class CalendarPatch(Schema):
    name: Optional[str] = Field(None, min_length=1, max_length=64)
    colour: Optional[str] = Field(None, pattern=r"^#[0-9a-fA-F]{6}$")  # your colour for it
    visible: Optional[bool] = None
    active: Optional[bool] = None


class EventOut(Schema):
    id: uuid.UUID
    calendar_id: int
    name: str
    start: datetime.datetime
    end: Optional[datetime.datetime]
    all_day: bool
    kind: Literal["event", "all_day", "deadline"]
    category: int
    location: Optional[str]
    description: Optional[str]
    completed: bool
    priority: int

    @staticmethod
    def resolve_start(obj):
        return obj.startdate

    @staticmethod
    def resolve_end(obj):
        return obj.enddate

    @staticmethod
    def resolve_all_day(obj):
        return obj.allday

    @staticmethod
    def resolve_kind(obj):
        return "all_day" if obj.allday else ("deadline" if obj.enddate is None else "event")


class EventIn(Schema):
    calendar_id: int
    name: str = Field(..., min_length=1, max_length=256)
    start: datetime.datetime
    end: Optional[datetime.datetime] = None  # none = a deadline
    all_day: bool = False
    category: int = 0
    location: Optional[str] = Field(None, max_length=256)
    description: Optional[str] = None
    priority: int = 10


class EventPatch(Schema):
    calendar_id: Optional[int] = None
    name: Optional[str] = Field(None, min_length=1, max_length=256)
    start: Optional[datetime.datetime] = None
    end: Optional[datetime.datetime] = None
    all_day: Optional[bool] = None
    category: Optional[int] = None
    location: Optional[str] = Field(None, max_length=256)
    description: Optional[str] = None
    completed: Optional[bool] = None
    priority: Optional[int] = None


def _calendar_out(sub):
    c = sub.calendar
    return {"id": c.id, "name": c.name, "colour": sub.colour or c.colour,
            "role": ("owner", "admin", "subscriber")[sub.subscribe_type], "visible": sub.visible,
            "active": c.active, "public": c.public, "calendar_type": c.calendar_type,
            "synced": c.calendar_type != 0, "can_edit": sub.subscribe_type in EDITOR}


def _sub(user, calendar_id, editor=False):
    sub = Subscriber.objects.select_related("calendar").filter(user=user, calendar_id=calendar_id).first()
    if sub is None or (editor and sub.subscribe_type not in EDITOR):
        raise HttpError(404 if sub is None else 403, "Calendar not found" if sub is None else "Read-only calendar")
    return sub


def _editable_event(user, event_id):
    e = get_object_or_404(Event, id=event_id, calendar__users_subscribed__user=user)
    _sub(user, e.calendar_id, editor=True)
    return e


def _apply(e, data):
    if "category" in data and data["category"] not in CATEGORIES:
        raise HttpError(400, "Unknown category")
    mapping = {"start": "startdate", "end": "enddate", "all_day": "allday", "calendar_id": "calendar_id"}
    for key, value in data.items():
        if key in ("name", "description", "location") and value:
            value = bleach.clean(value)
        setattr(e, mapping.get(key, key), value)
    if e.enddate is not None and e.enddate < e.startdate:
        raise HttpError(400, "The end is before the start")
    if e.allday and e.enddate is None:
        e.enddate = e.startdate + datetime.timedelta(days=1)


# ---------------------------------------------------------------- calendars

@router.get("/calendars", response=list[CalendarOut])
def list_calendars(request, include_inactive: bool = False):
    subs = Subscriber.objects.filter(user=request.user).select_related("calendar").order_by("calendar__name")
    if not include_inactive:
        subs = subs.filter(calendar__active=True)
    return [_calendar_out(s) for s in subs]


@router.post("/calendars", response={201: CalendarOut})
def create_calendar(request, payload: CalendarIn):
    with transaction.atomic():
        c = Calendar.objects.create(name=bleach.clean(payload.name), colour=payload.colour, owner=request.user)
        sub = Subscriber.objects.create(user=request.user, calendar=c, subscribe_type=0, colour=payload.colour)
    return 201, _calendar_out(sub)


@router.patch("/calendars/{int:calendar_id}", response=CalendarOut)
def update_calendar(request, calendar_id: int, payload: CalendarPatch):
    data = payload.dict(exclude_unset=True)
    sub = _sub(request.user, calendar_id, editor=bool({"name", "active"} & set(data)))
    if "colour" in data:
        sub.colour = data["colour"]
    if "visible" in data:
        sub.visible = data["visible"]
    sub.save()
    if "name" in data or "active" in data:
        c = sub.calendar
        c.name = bleach.clean(data.get("name", c.name))
        c.active = data.get("active", c.active)
        c.save(update_fields=["name", "active"])
    return _calendar_out(sub)


@router.post("/subscribe", response=CalendarOut, summary="Subscribe with an invite code")
def subscribe(request, code: str):
    invite = Invite.objects.select_related("calendar").filter(code=code, active=True).first()
    if invite is None:
        raise HttpError(404, "Invalid invite code")
    sub, created = Subscriber.objects.get_or_create(user=request.user, calendar=invite.calendar,
                                                    defaults={"subscribe_type": 2, "colour": invite.calendar.colour})
    if created:
        invite.uses += 1
        invite.save(update_fields=["uses"])
        if invite.calendar.owner_id != request.user.id:
            notify(invite.calendar.owner, f"{request.user.get_full_name() or request.user.username} "
                   f"subscribed to {invite.calendar.name}", source="Calendar", url="/calendar/")
    return _calendar_out(sub)


@router.delete("/calendars/{int:calendar_id}/subscription", response={204: None}, summary="Unsubscribe")
def unsubscribe(request, calendar_id: int):
    sub = _sub(request.user, calendar_id)
    if sub.subscribe_type == 0:
        raise HttpError(400, "Owners can't unsubscribe from their own calendar")
    sub.delete()
    return 204, None


# ---------------------------------------------------------------- events

@router.get("/categories", summary="Event categories")
def categories(request):
    return [{"id": k, "label": v} for k, v in CATEGORIES.items()]


@router.get("/events", response=list[EventOut], summary="Events overlapping [start, end)")
def list_events(request, start: datetime.datetime, end: datetime.datetime,
                calendar: Optional[int] = None, include_hidden: bool = False, q: str = ""):
    if end <= start or end - start > datetime.timedelta(days=400):
        raise HttpError(400, "Pick a range of up to 400 days")
    subs = Subscriber.objects.filter(user=request.user, calendar__active=True)
    if not include_hidden:
        subs = subs.filter(visible=True)
    if calendar is not None:
        subs = subs.filter(calendar_id=calendar)
    from .api import overlapping

    qs = Event.objects.filter(overlapping(start, end), calendar_id__in=subs.values("calendar_id"))
    if q:
        qs = qs.filter(name__icontains=q)
    return list(qs.order_by("startdate", "-enddate", "name")[:5000])


@router.post("/events", response={201: EventOut})
def create_event(request, payload: EventIn):
    _sub(request.user, payload.calendar_id, editor=True)
    e = Event()
    _apply(e, payload.dict())
    e.save()
    return 201, e


@router.get("/events/{uuid:event_id}", response=EventOut)
def get_event(request, event_id: uuid.UUID):
    return get_object_or_404(Event, id=event_id, calendar__users_subscribed__user=request.user)


@router.patch("/events/{uuid:event_id}", response=EventOut)
def update_event(request, event_id: uuid.UUID, payload: EventPatch):
    e = _editable_event(request.user, event_id)
    data = payload.dict(exclude_unset=True)
    if "calendar_id" in data:
        _sub(request.user, data["calendar_id"], editor=True)
    _apply(e, data)
    e.save()
    return e


@router.post("/events/{uuid:event_id}/duplicate", response={201: EventOut})
def duplicate_event(request, event_id: uuid.UUID, days: int = 0):
    e = _editable_event(request.user, event_id)
    shift = datetime.timedelta(days=days)
    e.pk = None
    e.id = uuid.uuid4()
    e.sync_id = None
    e.startdate += shift
    if e.enddate:
        e.enddate += shift
    e.save()
    return 201, e


@router.delete("/events/{uuid:event_id}", response={204: None})
def delete_event(request, event_id: uuid.UUID):
    _editable_event(request.user, event_id).delete()
    return 204, None


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


def _user_tz(user):
    import pytz
    from django.utils import timezone as tz_
    return pytz.timezone(user.timezone) if user.timezone in pytz.all_timezones_set else tz_.get_current_timezone()


@router.get("/agenda", response=list[AgendaItem], summary="Upcoming events, deadlines and due todos, merged")
def agenda(request, days: int = 14, include_overdue: bool = True):
    from django.db.models import Q
    from django.utils import timezone as tz_

    from scheduler.models import Todo
    from .api import overlapping

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
    for e in Event.objects.filter(overlapping(now if not include_overdue else start, end),
                                  calendar_id__in=subs).order_by("startdate")[:500]:
        if e.enddate and e.enddate < now and not e.allday:
            continue  # already over
        s = subs[e.calendar_id]
        kind = "all_day" if e.allday else ("deadline" if e.enddate is None else "event")
        items.append({"kind": kind, "id": str(e.id), "title": e.name, "start": e.startdate, "end": e.enddate,
                      "colour": s.colour or s.calendar.colour, "calendar": s.calendar.name, "location": e.location,
                      "done": e.completed, "priority": e.priority, "has_todo": str(e.id) in todo_events})
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
    from .api import overlapping

    cals = Subscriber.objects.filter(user=user, visible=True, calendar__active=True).select_related("calendar")
    colours = {s.calendar_id: (s.colour or s.calendar.colour, s.calendar.name) for s in cals}
    events = list(Event.objects.filter(overlapping(start, end), calendar_id__in=colours).order_by("startdate"))
    days = (end - start).days
    per_day = [0.0] * days
    per_day_n = [0] * days
    by_weekday, by_hour = [0.0] * 7, [0.0] * 24
    heat = [[0.0] * 24 for _ in range(7)]
    cat, cal, loc = {}, {}, {}
    timed = [e for e in events if not e.allday and e.enddate]
    deadlines = [e for e in events if not e.allday and e.enddate is None and start <= e.startdate < end]
    all_day = [e for e in events if e.allday]
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
        c = cat.setdefault(e.category, {"id": e.category, "label": CATEGORIES.get(e.category, "Other"), "hours": 0, "events": 0})
        c["hours"] += h_total
        c["events"] += 1
        colour, name = colours[e.calendar_id]
        k = cal.setdefault(e.calendar_id, {"id": e.calendar_id, "name": name, "colour": colour, "hours": 0, "events": 0})
        k["hours"] += h_total
        k["events"] += 1
        if e.location:
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
                   "meeting_hours": r(cat.get(1, {}).get("hours", 0)), "focus_hours": r(cat.get(2, {}).get("hours", 0))},
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
