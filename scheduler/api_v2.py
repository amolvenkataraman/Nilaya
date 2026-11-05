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
