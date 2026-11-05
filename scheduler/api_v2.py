"""/api/v2/calendar/: calendars you're subscribed to and their events.

Roles come from Calendar.owner (owner) and Subscriber.subscribe_type (admin or
subscriber): owners and admins edit, subscribers read, everyone else gets 404.
Event ids are uuids, or "<series uuid>:<original start, UTC ISO>" for occurrences of
a repeating event; PATCH/DELETE take ?scope=this|following|all for those.
"""

import datetime
import secrets
import string
import uuid
from typing import Literal, Optional

import bleach
from django.conf import settings
from django.db import transaction
from django.db.models import Count, Q
from django.shortcuts import get_object_or_404
from ninja import Field, Router, Schema
from ninja.errors import HttpError

from notifications.service import notify

from . import recurrence as rec
from . import service as svc
from .models import (ICONS, LEGACY_CATEGORIES, Calendar, Event, EventAttendee, EventCategory, EventReminder, Invite,
                     Subscriber, user_brief)

router = Router(tags=["calendar"])
HEX = r"^#[0-9a-fA-F]{6}$"
HEX_OR_EMPTY = r"^(#[0-9a-fA-F]{6})?$"
ICON = r"^[a-z0-9-]{0,24}$"
CATEGORIES = {k: v[0] for k, v in LEGACY_CATEGORIES.items()}  # old numbers (still accepted as `category`)
Scope = Literal["this", "following", "all"]


def _bad(ex):
    raise HttpError(400, str(ex) or "Invalid value")


# ---------------------------------------------------------------- schemas: calendars

class SubscriptionOut(Schema):
    colour: Optional[str]
    visible: bool
    notify: bool
    display_busy: int


class SyncOut(Schema):
    url: Optional[str] = None  # owners/admins only
    auto_sync: bool
    past_months: int
    future_months: int
    last_synced_at: Optional[datetime.datetime]
    last_error: str
    last_sync_error: str  # = last_error


class SyncPatch(Schema):
    url: Optional[str] = Field(None, max_length=256)
    auto_sync: Optional[bool] = None
    past_months: Optional[int] = Field(None, ge=0, le=120)
    future_months: Optional[int] = Field(None, ge=0, le=120)


class CalendarOut(Schema):
    id: int
    name: str
    colour: str              # your colour for it (falls back to the calendar colour)
    calendar_colour: str
    icon: str
    description: str
    role: Literal["owner", "admin", "subscriber"]
    visible: bool
    notify: bool
    active: bool
    public: bool
    calendar_type: int
    synced: bool
    can_edit: bool
    owner_id: str
    time_zone: str
    tags: list[str]


class CalendarDetailOut(CalendarOut):
    my_colour: Optional[str]  # your own colour for it (null = the calendar colour)
    owner: dict
    subscription: SubscriptionOut
    sync: SyncOut
    subscriber_count: int


class CalendarIn(Schema):
    name: str = Field(..., min_length=1, max_length=64)
    colour: str = Field("#1a73e8", pattern=HEX)
    icon: str = Field("", pattern=ICON)
    description: str = Field("", max_length=2000)
    time_zone: str = ""
    tags: list[str] = []


class CalendarPatch(Schema):
    # yours (anyone subscribed)
    my_colour: Optional[str] = Field(None, pattern=HEX_OR_EMPTY)  # "" = back to the calendar colour
    colour: Optional[str] = Field(None, pattern=HEX)  # = my_colour (older name)
    visible: Optional[bool] = None
    notify: Optional[bool] = None
    display_busy: Optional[int] = Field(None, ge=0, le=2)
    # the calendar's (owners/admins)
    name: Optional[str] = Field(None, min_length=1, max_length=64)
    calendar_colour: Optional[str] = Field(None, pattern=HEX)
    icon: Optional[str] = Field(None, pattern=ICON)
    description: Optional[str] = Field(None, max_length=2000)
    active: Optional[bool] = None
    public: Optional[bool] = None
    time_zone: Optional[str] = None
    tags: Optional[list[str]] = None
    calendar_type: Optional[Literal[0, 1, 2, 50]] = None
    calendar_url: Optional[str] = Field(None, max_length=256)
    auto_sync: Optional[bool] = None
    sync_past_months: Optional[int] = Field(None, ge=0, le=120)
    sync_future_months: Optional[int] = Field(None, ge=0, le=120)
    sync: Optional[SyncPatch] = None  # nested form of calendar_url/auto_sync/sync_*_months


EDITOR_FIELDS = {"name", "calendar_colour", "icon", "description", "active", "public", "time_zone", "tags",
                 "calendar_type", "calendar_url", "auto_sync", "sync_past_months", "sync_future_months"}


def _calendar_out(sub, detail=False, subscriber_count=None):
    c = sub.calendar
    role = sub.role
    out = {"id": c.id, "name": c.name, "colour": sub.colour or c.colour, "calendar_colour": c.colour, "icon": c.icon,
           "description": c.description, "role": role, "visible": sub.visible, "notify": sub.notify,
           "active": c.active, "public": c.public, "calendar_type": c.calendar_type, "synced": c.calendar_type != 0,
           "can_edit": role in ("owner", "admin"), "owner_id": str(c.owner_id), "time_zone": c.time_zone or settings.TIME_ZONE,
           "tags": c.tags or []}
    if detail:
        out.update({
            "my_colour": sub.colour,
            "owner": user_brief(c.owner),
            "subscription": {"colour": sub.colour, "visible": sub.visible, "notify": sub.notify,
                             "display_busy": sub.display_busy},
            "sync": {"url": c.calendar_url if role in ("owner", "admin") else None, "auto_sync": c.auto_sync,
                     "past_months": c.sync_past_months, "future_months": c.sync_future_months,
                     "last_synced_at": c.last_synced_at, "last_error": c.last_sync_error,
                     "last_sync_error": c.last_sync_error},
            "subscriber_count": subscriber_count if subscriber_count is not None else c.users_subscribed.count(),
        })
    return out


def _sub(user, calendar_id, editor=False, owner=False):
    sub = (Subscriber.objects.select_related("calendar", "calendar__owner").filter(user=user, calendar_id=calendar_id)
           .order_by("subscribe_type", "id").first())
    if sub is None:
        raise HttpError(404, "Calendar not found")
    if owner and sub.role != "owner":
        raise HttpError(403, "Only the owner can do that")
    if editor and sub.role not in ("owner", "admin"):
        raise HttpError(403, "Read-only calendar")
    return sub


# ---------------------------------------------------------------- calendars

@router.get("/icons", summary="Icon keys for calendars, categories and events")
def icons(request):
    return list(ICONS)


@router.get("/calendars", response=list[CalendarOut])
def list_calendars(request, include_inactive: bool = False):
    subs = Subscriber.objects.filter(user=request.user).select_related("calendar").order_by("calendar__name", "subscribe_type", "id")
    if not include_inactive:
        subs = subs.filter(calendar__active=True)
    seen = set()  # old data can hold duplicate rows for one user and calendar: list it once
    return [_calendar_out(s) for s in subs if not (s.calendar_id in seen or seen.add(s.calendar_id))]


@router.post("/calendars", response={201: CalendarOut})
def create_calendar(request, payload: CalendarIn):
    if payload.icon and payload.icon not in ICONS:
        raise HttpError(400, "Unknown icon")
    if payload.time_zone and not rec.valid_zone(payload.time_zone):
        raise HttpError(400, "Unknown time zone")
    with transaction.atomic():
        c = Calendar.objects.create(name=bleach.clean(payload.name), colour=payload.colour.lower(), owner=request.user,
                                    icon=payload.icon, description=bleach.clean(payload.description),
                                    time_zone=payload.time_zone, tags=svc.clean_tags(payload.tags))
        sub = Subscriber.objects.create(user=request.user, calendar=c, subscribe_type=0, colour=payload.colour.lower())
    return 201, _calendar_out(sub)


@router.get("/calendars/{int:calendar_id}", response=CalendarDetailOut)
def get_calendar(request, calendar_id: int):
    return _calendar_out(_sub(request.user, calendar_id), detail=True)


@router.patch("/calendars/{int:calendar_id}", response=CalendarDetailOut)
def update_calendar(request, calendar_id: int, payload: CalendarPatch):
    data = payload.dict(exclude_unset=True)
    nested = data.pop("sync", None) or {}
    for k, flat in (("url", "calendar_url"), ("auto_sync", "auto_sync"), ("past_months", "sync_past_months"),
                    ("future_months", "sync_future_months")):
        if nested.get(k) is not None:
            data[flat] = nested[k]
    if "my_colour" in data:
        data["colour"] = data.pop("my_colour") or None
        if data["colour"] is None:
            sub_ = _sub(request.user, calendar_id)
            sub_.colour = None
            sub_.save(update_fields=["colour"])
            data.pop("colour")
    sub = _sub(request.user, calendar_id, editor=bool(EDITOR_FIELDS & set(data)))
    for k in ("colour", "visible", "notify", "display_busy"):
        if k in data and data[k] is not None:
            setattr(sub, k, data[k].lower() if k == "colour" else data[k])
    sub.save()
    c = sub.calendar
    changed = []
    for k, v in data.items():
        if k not in EDITOR_FIELDS or v is None:
            continue
        if k == "icon" and v and v not in ICONS:
            raise HttpError(400, "Unknown icon")
        if k == "time_zone" and v and not rec.valid_zone(v):
            raise HttpError(400, "Unknown time zone")
        if k == "calendar_url":
            v = v.strip() or None
            if v != c.calendar_url:
                c.sync_etag, c.sync_last_modified = "", ""
                changed += ["sync_etag", "sync_last_modified"]
        if k in ("name", "description"):
            v = bleach.clean(v)
        if k == "tags":
            v = svc.clean_tags(v)
        field = "colour" if k == "calendar_colour" else k
        setattr(c, field, v.lower() if k == "calendar_colour" else v)
        changed.append(field)
    if changed:
        c.save(update_fields=changed)
    return _calendar_out(sub, detail=True)


@router.delete("/calendars/{int:calendar_id}", response={204: None}, summary="Delete a calendar and all its events")
def delete_calendar(request, calendar_id: int, confirm: str):
    sub = _sub(request.user, calendar_id, owner=True)
    if confirm != sub.calendar.name:
        raise HttpError(400, "Type the calendar's name in `confirm` to delete it")
    sub.calendar.delete()
    return 204, None


@router.post("/calendars/{int:calendar_id}/sync", summary="Sync a calendar from its source now")
def sync_now(request, calendar_id: int):
    from .sync import sync_calendar

    c = _sub(request.user, calendar_id, editor=True).calendar
    if c.calendar_type == 0:
        raise HttpError(400, "This is a local calendar")
    if not settings.ONLINE_MODE:
        raise HttpError(503, "The server is in offline mode")
    status = sync_calendar(c, conditional=False)
    c.refresh_from_db(fields=["last_synced_at", "last_sync_error"])
    return {"ok": bool(status), "not_modified": status == "not_modified", "last_synced_at": c.last_synced_at,
            "last_sync_error": c.last_sync_error}


@router.post("/subscribe", response=CalendarOut, summary="Subscribe with an invite code")
def subscribe(request, code: str):
    invite = Invite.objects.select_related("calendar").filter(code=code).first()
    if invite is None:
        raise HttpError(404, "Invalid invite code")
    existed = Subscriber.objects.filter(user=request.user, calendar=invite.calendar).exists()
    sub, err = svc.join(request.user, invite)
    if err:
        raise HttpError(404 if err == "Invite code is not active" else 410, err)
    if not existed and invite.calendar.owner_id != request.user.id:
        notify(invite.calendar.owner, f"{request.user.get_full_name() or request.user.username} "
               f"subscribed to {invite.calendar.name}", source="Calendar", url="/calendar/")
    return _calendar_out(Subscriber.objects.select_related("calendar").get(pk=sub.pk))


@router.delete("/calendars/{int:calendar_id}/subscription", response={204: None}, summary="Unsubscribe")
def unsubscribe(request, calendar_id: int):
    sub = _sub(request.user, calendar_id)
    if sub.role == "owner":
        raise HttpError(400, "Owners can't unsubscribe from their own calendar")
    sub.delete()
    return 204, None


# ---------------------------------------------------------------- subscribers

class SubscriberOut(Schema):
    id: int
    user: dict
    role: Literal["owner", "admin", "subscriber"]
    display_busy: int


class SubscriberPatch(Schema):
    role: Optional[Literal["admin", "subscriber"]] = None
    display_busy: Optional[int] = Field(None, ge=0, le=2)  # only for your own row (it's your privacy setting)


def _subscriber_out(s):
    return {"id": s.id, "user": user_brief(s.user), "role": s.role, "display_busy": s.display_busy}


@router.get("/calendars/{int:calendar_id}/subscribers", response=list[SubscriberOut])
def list_subscribers(request, calendar_id: int):
    _sub(request.user, calendar_id, editor=True)
    subs = Subscriber.objects.filter(calendar_id=calendar_id).select_related("user", "calendar")
    return sorted((_subscriber_out(s) for s in subs), key=lambda s: (ROLE_ORDER[s["role"]], s["user"]["username"]))


ROLE_ORDER = {"owner": 0, "admin": 1, "subscriber": 2}


def _target_sub(request, calendar_id, sub_id):
    me = _sub(request.user, calendar_id, editor=True)
    s = get_object_or_404(Subscriber.objects.select_related("user", "calendar"), id=sub_id, calendar_id=calendar_id)
    return me, s


@router.patch("/calendars/{int:calendar_id}/subscribers/{int:sub_id}", response=SubscriberOut)
def update_subscriber(request, calendar_id: int, sub_id: int, payload: SubscriberPatch):
    me, s = _target_sub(request, calendar_id, sub_id)
    data = payload.dict(exclude_unset=True)
    if data.get("role"):
        if s.role == "owner":
            raise HttpError(400, "The owner's role can't change")
        if me.role != "owner" and (s.role == "admin" or data["role"] == "admin"):
            raise HttpError(403, "Only the owner can add or remove admins")
        s.subscribe_type = 1 if data["role"] == "admin" else 2
    if data.get("display_busy") is not None:
        if s.user_id != request.user.id:
            raise HttpError(403, "Busy sharing is each person's own setting")
        s.display_busy = data["display_busy"]
    s.save()
    return _subscriber_out(s)


@router.delete("/calendars/{int:calendar_id}/subscribers/{int:sub_id}", response={204: None})
def remove_subscriber(request, calendar_id: int, sub_id: int):
    me, s = _target_sub(request, calendar_id, sub_id)
    if s.role == "owner":
        raise HttpError(400, "The owner can't be removed")
    if s.role == "admin" and me.role != "owner" and s.user_id != request.user.id:
        raise HttpError(403, "Only the owner can remove admins")
    s.delete()
    return 204, None


# ---------------------------------------------------------------- invites

class InviteOut(Schema):
    id: int
    code: str
    uses: int
    active: bool
    expires_on: Optional[datetime.datetime]
    max_uses: Optional[int]
    role: Literal["admin", "subscriber"]
    usable: bool


class InviteIn(Schema):
    code: Optional[str] = Field(None, min_length=4, max_length=8, pattern=r"^[A-Za-z0-9_-]+$")  # none = random
    expires_in_days: Optional[int] = Field(None, ge=1, le=3650)  # or expires_on
    expires_on: Optional[datetime.datetime] = None
    max_uses: Optional[int] = Field(None, ge=1)
    role: Literal["admin", "subscriber"] = "subscriber"


class InvitePatch(Schema):
    active: Optional[bool] = None
    expires_in_days: Optional[int] = Field(None, ge=1, le=3650)
    expires_on: Optional[datetime.datetime] = None  # null = never
    max_uses: Optional[int] = Field(None, ge=1)
    role: Optional[Literal["admin", "subscriber"]] = None


def _invite_out(i):
    return {"id": i.id, "code": i.code, "uses": i.uses, "active": i.active, "expires_on": i.expires_on,
            "max_uses": i.max_uses, "role": "admin" if i.role == 1 else "subscriber", "usable": i.problem() is None}


@router.get("/calendars/{int:calendar_id}/invites", response=list[InviteOut])
def list_invites(request, calendar_id: int):
    _sub(request.user, calendar_id, editor=True)
    return [_invite_out(i) for i in Invite.objects.filter(calendar_id=calendar_id).order_by("-id")]


@router.post("/calendars/{int:calendar_id}/invites", response={201: InviteOut})
def create_invite(request, calendar_id: int, payload: InviteIn):
    me = _sub(request.user, calendar_id, editor=True)
    if payload.role == "admin" and me.role != "owner":
        raise HttpError(403, "Only the owner can create admin invites")
    code = payload.code
    if code and Invite.objects.filter(code=code).exists():
        raise HttpError(409, "That invite code is already in use")
    while not code or Invite.objects.filter(code=code).exists():
        code = "".join(secrets.choice(string.ascii_letters + string.digits) for _ in range(8))
    expires = payload.expires_on
    if payload.expires_in_days:
        from django.utils import timezone
        expires = timezone.now() + datetime.timedelta(days=payload.expires_in_days)
    i = Invite.objects.create(calendar_id=calendar_id, code=code, expires_on=expires,
                              max_uses=payload.max_uses, role=1 if payload.role == "admin" else 2)
    return 201, _invite_out(i)


@router.patch("/calendars/{int:calendar_id}/invites/{int:invite_id}", response=InviteOut)
def update_invite(request, calendar_id: int, invite_id: int, payload: InvitePatch):
    me = _sub(request.user, calendar_id, editor=True)
    i = get_object_or_404(Invite, id=invite_id, calendar_id=calendar_id)
    data = payload.dict(exclude_unset=True)
    days = data.pop("expires_in_days", None)
    if days:
        from django.utils import timezone
        data["expires_on"] = timezone.now() + datetime.timedelta(days=days)
    if (data.get("role") == "admin" or i.role == 1) and me.role != "owner" and "role" in data:
        raise HttpError(403, "Only the owner can change admin invites")
    for k, v in data.items():
        setattr(i, k, (1 if v == "admin" else 2) if k == "role" else v)
    i.save()
    return _invite_out(i)


@router.delete("/calendars/{int:calendar_id}/invites/{int:invite_id}", response={204: None})
def delete_invite(request, calendar_id: int, invite_id: int):
    _sub(request.user, calendar_id, editor=True)
    get_object_or_404(Invite, id=invite_id, calendar_id=calendar_id).delete()
    return 204, None


# ---------------------------------------------------------------- categories

class CategoryOut(Schema):
    id: int
    name: str
    label: str  # = name (the old /categories key)
    colour: str
    icon: str
    position: int
    legacy_id: Optional[int]


class CategoryIn(Schema):
    name: str = Field(..., min_length=1, max_length=64)
    colour: str = Field("", pattern=HEX_OR_EMPTY)  # "" = use the calendar colour
    icon: str = Field("", pattern=ICON)
    position: Optional[int] = None


class CategoryPatch(Schema):
    name: Optional[str] = Field(None, min_length=1, max_length=64)
    colour: Optional[str] = Field(None, pattern=HEX_OR_EMPTY)
    icon: Optional[str] = Field(None, pattern=ICON)
    position: Optional[int] = None


def _category_out(c):
    return {"id": c.id, "name": c.name, "label": c.name, "colour": c.colour, "icon": c.icon, "position": c.position,
            "legacy_id": c.legacy_id}


@router.get("/categories", response=list[CategoryOut], summary="Event categories (yours, or a calendar owner's)")
def categories(request, calendar: Optional[int] = None):
    owner_id = _sub(request.user, calendar).calendar.owner_id if calendar is not None else request.user.id
    EventCategory.ensure_defaults(owner_id)
    return [_category_out(c) for c in EventCategory.objects.filter(owner_id=owner_id)]


@router.post("/categories", response={201: CategoryOut})
def create_category(request, payload: CategoryIn):
    if payload.icon and payload.icon not in ICONS:
        raise HttpError(400, "Unknown icon")
    EventCategory.ensure_defaults(request.user.id)
    pos = payload.position
    if pos is None:
        pos = (EventCategory.objects.filter(owner=request.user).order_by("-position").values_list("position", flat=True)
               .first() or 0) + 1
    c = EventCategory.objects.create(owner=request.user, name=bleach.clean(payload.name), colour=payload.colour.lower(),
                                     icon=payload.icon, position=pos)
    return 201, _category_out(c)


@router.patch("/categories/{int:category_id}", response=CategoryOut)
def update_category(request, category_id: int, payload: CategoryPatch):
    c = get_object_or_404(EventCategory, id=category_id, owner=request.user)
    for k, v in payload.dict(exclude_unset=True).items():
        if v is None:
            continue
        if k == "icon" and v and v not in ICONS:
            raise HttpError(400, "Unknown icon")
        setattr(c, k, bleach.clean(v) if k == "name" else (v.lower() if k == "colour" else v))
    c.save()
    return _category_out(c)


@router.delete("/categories/{int:category_id}", response={204: None}, summary="Delete; its events become Uncategorized")
def delete_category(request, category_id: int):
    c = get_object_or_404(EventCategory, id=category_id, owner=request.user)
    if c.legacy_id == 0:
        raise HttpError(400, "Uncategorized can't be deleted")
    with transaction.atomic():
        fallback = EventCategory.for_legacy(request.user.id, 0)
        Event.objects.filter(event_category=c).update(event_category=fallback, category=0)
        c.delete()
    return 204, None


# ---------------------------------------------------------------- events: schemas

class PlaceOut(Schema):
    id: str
    name: str
    lat: float
    lon: float
    latitude: float   # = lat
    longitude: float  # = lon


class EventOut(Schema):
    id: str                       # uuid, or "<series>:<original start>" for an occurrence
    series_id: Optional[str]      # the repeating event it belongs to
    override_id: Optional[str]    # the row holding this occurrence's changes, if any
    recurring: bool
    original_start: Optional[datetime.datetime]
    calendar_id: int
    name: str
    kind: Literal["event", "all_day", "deadline"]
    start: datetime.datetime
    end: Optional[datetime.datetime]
    all_day: bool
    start_date: Optional[datetime.date]   # all-day events: dates, end exclusive
    end_date: Optional[datetime.date]
    category_id: Optional[int]
    category: Optional[dict]              # {id, name, colour, icon}
    legacy_category: int
    location: Optional[str]
    place: Optional[PlaceOut]
    meeting_url: str
    description: Optional[str]
    status: Literal["confirmed", "tentative", "cancelled"]
    transparency: Literal["busy", "free"]
    visibility: Literal["default", "public", "private"]
    colour: Optional[str]
    icon: Optional[str]
    display_colour: str                   # event → category → your calendar colour → calendar colour
    tags: list[str]
    rrule: Optional[str]
    recurrence_text: str                  # "Every week on Mon, Wed until Dec 31, 2026" ("" = doesn't repeat)
    time_zone: str                        # the zone it repeats in (the event's own, else the calendar's)
    exdates: list[str]
    rdates: list[str]
    recurrence_end: Optional[datetime.datetime]
    completed: bool                       # retired; kept for old clients (custom_info)
    priority: int
    created_on: datetime.datetime
    updated_on: datetime.datetime
    created_by: Optional[str]
    masked: bool = False                  # a private event you can only see as busy


class AttendeeOut(Schema):
    id: int
    contact_id: Optional[str]
    user_id: Optional[str]
    name: str
    email: str
    rsvp: Literal["needs_action", "accepted", "declined", "tentative"]
    is_organizer: bool


class EventDetailOut(EventOut):
    reminders: list[int]          # minutes before; [] = the global reminder setting
    attendees: list[AttendeeOut]
    task_id: Optional[str] = None  # the todo made from it (Tasks → from-event), if any


class EventIn(Schema):
    calendar_id: int
    name: str = Field(..., min_length=1, max_length=256)
    kind: Optional[Literal["event", "all_day", "deadline"]] = None  # default: from all_day / end
    start: Optional[datetime.datetime] = None
    end: Optional[datetime.datetime] = None  # none = a deadline (unless kind says otherwise)
    all_day: bool = False
    start_date: Optional[datetime.date] = None  # all-day events
    end_date: Optional[datetime.date] = None    # exclusive
    category_id: Optional[int] = None
    category: Optional[int] = None  # an old category number (0–9, 100)
    location: Optional[str] = Field(None, max_length=256)
    place_id: Optional[uuid.UUID] = None
    meeting_url: str = Field("", max_length=500)
    description: Optional[str] = None
    status: Literal["confirmed", "tentative", "cancelled"] = "confirmed"
    transparency: Optional[Literal["busy", "free"]] = None  # default: busy, deadlines free
    visibility: Literal["default", "public", "private"] = "default"
    colour: Optional[str] = Field(None, pattern=HEX_OR_EMPTY)
    icon: Optional[str] = Field(None, pattern=ICON)
    tags: list[str] = []
    time_zone: str = ""  # "" = the calendar's
    rrule: str = ""
    exdates: list[str] = []
    rdates: list[str] = []
    reminders: Optional[list[int]] = None  # minutes before; none = the global setting
    priority: Optional[int] = None
    completed: Optional[bool] = None


class EventPatch(Schema):
    calendar_id: Optional[int] = None
    name: Optional[str] = Field(None, min_length=1, max_length=256)
    kind: Optional[Literal["event", "all_day", "deadline"]] = None
    start: Optional[datetime.datetime] = None
    end: Optional[datetime.datetime] = None
    all_day: Optional[bool] = None
    start_date: Optional[datetime.date] = None
    end_date: Optional[datetime.date] = None
    category_id: Optional[int] = None
    category: Optional[int] = None
    location: Optional[str] = Field(None, max_length=256)
    place_id: Optional[uuid.UUID] = None
    meeting_url: Optional[str] = Field(None, max_length=500)
    description: Optional[str] = None
    status: Optional[Literal["confirmed", "tentative", "cancelled"]] = None
    transparency: Optional[Literal["busy", "free"]] = None
    visibility: Optional[Literal["default", "public", "private"]] = None
    colour: Optional[str] = Field(None, pattern=HEX_OR_EMPTY)
    icon: Optional[str] = Field(None, pattern=ICON)
    tags: Optional[list[str]] = None
    time_zone: Optional[str] = None
    rrule: Optional[str] = None
    exdates: Optional[list[str]] = None
    rdates: Optional[list[str]] = None
    reminders: Optional[list[int]] = None
    completed: Optional[bool] = None
    priority: Optional[int] = None


# ---------------------------------------------------------------- events: helpers

def _event_out(e, sub_colour=None, masked=False, detail=False, user=None):
    cat = e.event_category if e.event_category_id else None
    place = e.place if e.place_id else None
    series = e.series()
    occ = getattr(e, "is_occurrence", False) or bool(e.recurrence_parent_id)
    out = {
        "id": e.ident(), "series_id": str(series) if series else None,
        "override_id": str(e.id) if e.recurrence_parent_id else None, "recurring": bool(series),
        "original_start": e.original_start if occ else None, "calendar_id": e.calendar_id, "name": e.name,
        "kind": e.kind, "start": e.startdate, "end": e.enddate, "all_day": e.kind == "all_day",
        "start_date": e.start_date, "end_date": e.end_date, "category_id": e.event_category_id,
        "category": cat.brief() if cat else None, "legacy_category": e.category, "location": e.location,
        "place": {"id": str(place.id), "name": place.name, "lat": float(place.latitude), "lon": float(place.longitude),
                  "latitude": float(place.latitude), "longitude": float(place.longitude)} if place else None,
        "meeting_url": e.meeting_url, "description": e.description, "status": e.status,
        "transparency": e.transparency, "visibility": e.visibility, "colour": e.colour, "icon": e.icon,
        "display_colour": e.display_colour(sub_colour), "tags": e.tags or [], "rrule": e.rrule or None,
        "recurrence_text": rec.describe(e.rrule, rec.event_zone(e)) if e.rrule else "",
        "time_zone": e.time_zone or e.calendar.time_zone or settings.TIME_ZONE,
        "exdates": e.exdates or [], "rdates": e.rdates or [], "recurrence_end": e.recurrence_end,
        "completed": e.completed, "priority": e.priority, "created_on": e.created_on, "updated_on": e.updated_on,
        "created_by": str(e.created_by_id) if e.created_by_id else None, "masked": masked,
    }
    if masked:
        out.update({"name": "Busy", "description": None, "location": None, "place": None, "meeting_url": "",
                    "tags": []})
    if detail:
        src = e.recurrence_parent_id or e.pk  # occurrences share their series' reminders and attendees
        out["reminders"] = list(EventReminder.objects.filter(event_id=src).values_list("minutes_before", flat=True))
        out["attendees"] = [] if masked else [_attendee_out(a) for a in EventAttendee.objects.filter(event_id=src)]
        if user is not None:
            from scheduler.models import Todo
            t = Todo.objects.filter(user=user, custom_info__event_id=out["id"]).values_list("id", flat=True).first()
            out["task_id"] = str(t) if t else None
    return out


def _out_for(user, e, detail=False):
    sub = Subscriber.objects.filter(user=user, calendar_id=e.calendar_id).select_related("calendar").first()
    return _event_out(e, sub.colour if sub else None, svc.masked_for(e, user, sub.role if sub else None), detail, user)


def _resolve(user, event_id, editor=False):
    """(row, original_start, subscription) for an event id the user can see (404 otherwise)."""
    e, original = svc.resolve(event_id, Event.objects.filter(calendar__users_subscribed__user=user))
    if e is None:
        raise HttpError(404, "Event not found")
    sub = _sub(user, e.calendar_id, editor=editor)
    return e, original, sub


def _apply(e, data, user):
    """Copy validated payload fields onto an Event (not saved)."""
    cal = e.calendar
    tz = cal.tz
    try:
        if "calendar_id" in data and data["calendar_id"] != e.calendar_id:
            new_cal = _sub(user, data["calendar_id"], editor=True).calendar
            if e.event_category_id and new_cal.owner_id != cal.owner_id and "category_id" not in data:
                old = e.event_category
                e.set_category(EventCategory.for_legacy(new_cal.owner_id, old.legacy_id) if old.legacy_id is not None
                               else EventCategory.objects.get_or_create(owner_id=new_cal.owner_id, name=old.name,
                                                                        defaults={"colour": old.colour, "icon": old.icon})[0])
            e.calendar = cal = new_cal
            tz = cal.tz
        for k in ("name", "description", "location"):
            if k in data:
                setattr(e, k, bleach.clean(data[k]) if data[k] else data[k])
        if data.get("category_id") is not None:
            c = EventCategory.objects.filter(id=data["category_id"], owner_id=cal.owner_id).first()
            if c is None:
                raise HttpError(400, "Unknown category (use one of the calendar owner's)")
            e.set_category(c)
        elif data.get("category") is not None:
            if data["category"] not in CATEGORIES:
                raise HttpError(400, "Unknown category")
            e.set_category(EventCategory.for_legacy(cal.owner_id, data["category"]))
        if "place_id" in data:
            from map.models import Location
            if data["place_id"] is None:
                e.place = None
            else:
                p = Location.objects.filter(Q(group__owner=user) | Q(group__is_public=True), id=data["place_id"]).first()
                if p is None:
                    raise HttpError(400, "Unknown place")
                e.place = p
        if "meeting_url" in data:
            e.meeting_url = svc.clean_url(data["meeting_url"])
        for k in ("status", "transparency", "visibility"):
            if data.get(k) is not None:
                setattr(e, k, data[k])
        if "colour" in data:
            e.colour = svc.clean_colour(data["colour"])
        if "icon" in data:
            e.icon = svc.clean_icon(data["icon"])
        if data.get("tags") is not None:
            e.tags = svc.clean_tags(data["tags"])
        if data.get("priority") is not None:
            e.priority = data["priority"]
        if data.get("completed") is not None:
            e.completed = data["completed"]

        # time
        kind = data.get("kind")
        if kind is None and data.get("all_day") is not None:
            kind = "all_day" if data["all_day"] else (e.kind if e.kind != "all_day" else "event")
        if kind is None and "end" in data and data["end"] is None and e.kind == "event":
            kind = "deadline"
        if kind is None and data.get("end") is not None and e.kind == "deadline":
            kind = "event"
        if "start" in data and data["start"] is not None:
            e.startdate = data["start"]
        if "end" in data:
            e.enddate = data["end"]
        if kind is not None:
            e.kind = kind
        if e.kind == "all_day":
            if data.get("start_date"):
                e.start_date = data["start_date"]
                e.end_date = data.get("end_date") or (e.end_date if e.end_date and e.end_date > e.start_date else None)
                e.startdate = rec.local_midnight(e.start_date, tz)
            elif data.get("end_date") and e.start_date:
                e.end_date = data["end_date"]
            elif "start" in data or "end" in data:
                e.start_date = e.end_date = None  # recompute from the datetimes
            if e.startdate is None:
                raise HttpError(400, "An all-day event needs start_date (or start)")
        elif e.kind == "deadline":
            e.enddate = None
        elif e.enddate is None and e.startdate is not None:
            e.enddate = e.startdate + datetime.timedelta(hours=1)
        if e.startdate is None:
            raise HttpError(400, "start is required")
        if e.enddate is not None and e.enddate < e.startdate:
            raise HttpError(400, "The end is before the start")
        if e.kind == "all_day" and e.end_date and e.start_date and e.end_date <= e.start_date:
            raise HttpError(400, "end_date is exclusive and must be after start_date")

        if data.get("time_zone") is not None:
            if data["time_zone"] and not rec.valid_zone(data["time_zone"]):
                raise HttpError(400, "Unknown time zone")
            e.time_zone = data["time_zone"]
        if "rrule" in data and data["rrule"] is not None and not e.recurrence_parent_id:
            e.rrule = rec.normalize_rrule(data["rrule"], rec.event_zone(e))
        if data.get("exdates") is not None:
            e.exdates = rec.normalize_keys(data["exdates"], tz)
        if data.get("rdates") is not None:
            e.rdates = rec.normalize_keys(data["rdates"], tz)
    except ValueError as ex:
        _bad(ex)


def _set_reminders(e, minutes):
    if minutes is None:
        return
    clean = sorted({int(m) for m in minutes if 0 <= int(m) <= 40320})[:5]  # up to 5, at most 4 weeks
    EventReminder.objects.filter(event=e).exclude(minutes_before__in=clean).delete()
    have = set(EventReminder.objects.filter(event=e).values_list("minutes_before", flat=True))
    EventReminder.objects.bulk_create([EventReminder(event=e, minutes_before=m) for m in clean if m not in have])


def _save(e):
    try:
        e.save()
    except ValueError as ex:
        _bad(ex)


# ---------------------------------------------------------------- events

@router.get("/events", response=list[EventOut], summary="Events overlapping [start, end), repeating events expanded")
def list_events(request, start: datetime.datetime, end: datetime.datetime,
                calendar: Optional[int] = None, include_hidden: bool = False, q: str = "", tag: str = "",
                include_cancelled: bool = False):
    if end <= start or end - start > datetime.timedelta(days=400):
        raise HttpError(400, "Pick a range of up to 400 days")
    subs = svc.visible_calendar_ids(request.user, include_hidden=include_hidden).select_related("calendar")
    if calendar is not None:
        subs = subs.filter(calendar_id=calendar)
    subs = {s.calendar_id: s for s in subs}
    extra = Q(name__icontains=q) if q else None
    events = svc.events_in_range(list(subs), start, end, include_cancelled=include_cancelled, extra=extra)
    if tag:
        events = [e for e in events if svc.in_tags(e, tag)]
    return [_event_out(e, subs[e.calendar_id].colour, svc.masked_for(e, request.user, subs[e.calendar_id].role))
            for e in events]


@router.post("/events", response={201: EventDetailOut})
def create_event(request, payload: EventIn):
    sub = _sub(request.user, payload.calendar_id, editor=True)
    data = payload.dict()
    if data["start"] is None and data["start_date"] is None:
        raise HttpError(400, "start (or start_date for an all-day event) is required")
    if data["kind"] is None and data["start_date"] and data["start"] is None:
        data["kind"] = "all_day"
    e = Event(calendar=sub.calendar, created_by=request.user)
    if data["transparency"] is None:
        data.pop("transparency")  # model default: busy, deadlines free
    _apply(e, data, request.user)
    with transaction.atomic():
        _save(e)
        _set_reminders(e, data.get("reminders"))
    return 201, _event_out(e, sub.colour, False, detail=True)


@router.get("/events/{event_id}", response=EventDetailOut, summary="One event or occurrence")
def get_event(request, event_id: str):
    e, original, sub = _resolve(request.user, event_id)
    if original is not None:
        e = svc.occurrence_view(e, original)
        if e is None:
            raise HttpError(404, "No such occurrence")
    return _event_out(e, sub.colour, svc.masked_for(e, request.user, sub.role), detail=True, user=request.user)


def _shift_data(data, occ, series):
    """Turn an occurrence's new times into the series' new times (same offset), for scope=all."""
    delta = datetime.timedelta()
    if data.get("start") is not None:
        delta = data["start"] - occ.startdate
        length = (data["end"] - data["start"]) if data.get("end") is not None else (
            (occ.enddate - occ.startdate) if occ.enddate else None)
        data["start"] = series.startdate + delta
        if "end" in data or length is not None:
            data["end"] = data["start"] + length if length is not None else None
    elif data.get("end") is not None and occ.enddate is not None:
        data["end"] = series.startdate + (data["end"] - occ.startdate)
    if data.get("start_date") and occ.start_date:
        days = data["start_date"] - occ.start_date
        length = ((data["end_date"] - data["start_date"]) if data.get("end_date")
                  else (occ.end_date - occ.start_date))
        data["start_date"] = series.start_date + days
        data["end_date"] = data["start_date"] + length
        delta = datetime.timedelta(days=days.days)
    return delta


_NON_TIME = ("name", "description", "location", "category_id", "category", "place_id", "meeting_url",
             "transparency", "visibility", "colour", "icon", "tags")


@router.patch("/events/{event_id}", response=EventDetailOut,
              summary="Edit; for repeating events scope = this (one occurrence), following or all")
def update_event(request, event_id: str, payload: EventPatch, scope: Optional[Scope] = None):
    e, original, sub = _resolve(request.user, event_id, editor=True)
    data = payload.dict(exclude_unset=True)
    reminders = data.pop("reminders", None)
    if "calendar_id" in data and data["calendar_id"] != e.calendar_id and (original is not None or e.rrule):
        if original is not None and (scope or "this") == "this":
            raise HttpError(400, "Move the whole series (scope=all) to change its calendar")
    if not e.rrule:  # a plain event
        _apply(e, data, request.user)
        with transaction.atomic():
            _save(e)
            _set_reminders(e, reminders)
        return _out_for(request.user, e, detail=True)

    scope = scope or ("this" if original is not None else "all")
    if scope in ("this", "following") and original is None:
        raise HttpError(400, "Pass an occurrence id (<series>:<start>) for scope=this/following")
    with transaction.atomic():
        if scope == "this":
            try:
                o = svc.make_override(e, original)
            except LookupError:
                raise HttpError(404, "No such occurrence")
            data.pop("rrule", None)
            _apply(o, data, request.user)
            _save(o)
            return _out_for(request.user, o, detail=True)
        # times sent for an occurrence move the series by the same offset
        occ = rec.occurrence_at(e, original, rec.event_zone(e)) if original is not None else e
        if occ is None:
            raise HttpError(404, "No such occurrence")
        if scope == "following":
            if data.get("rrule") and rec.parts(data["rrule"]) == rec.parts(e.rrule or ""):
                data.pop("rrule")  # an unchanged rule from the form must not undo split()'s adjusted COUNT
            try:
                e = svc.split(e, original)
            except LookupError:
                raise HttpError(404, "No such occurrence")
        before = e.startdate
        if occ is not e:
            _shift_data(data, occ, e)
        _apply(e, data, request.user)
        svc.shift_series(e, e.startdate - before)
        _save(e)
        # non-time changes reach the series' existing overrides too
        changed = {k: data[k] for k in _NON_TIME if k in data}
        if changed:
            for o in Event.objects.filter(recurrence_parent=e).select_related("calendar"):
                _apply(o, changed, request.user)
                _save(o)
        _set_reminders(e, reminders)
    return _out_for(request.user, e, detail=True)


@router.post("/events/{event_id}/duplicate", response={201: EventDetailOut})
def duplicate_event(request, event_id: str, days: int = 0):
    e, original, sub = _resolve(request.user, event_id, editor=True)
    src = svc.occurrence_view(e, original) if original is not None else e
    if src is None:
        raise HttpError(404, "No such occurrence")
    shift = datetime.timedelta(days=days)
    copy = svc._clone(src, startdate=src.startdate + shift, enddate=src.enddate + shift if src.enddate else None,
                      start_date=src.start_date + shift if src.start_date else None,
                      end_date=src.end_date + shift if src.end_date else None,
                      rrule="" if original is not None else e.rrule, created_by=request.user)
    copy.calendar = e.calendar
    _save(copy)
    return 201, _event_out(copy, sub.colour, False, detail=True)


@router.delete("/events/{event_id}", response={204: None},
               summary="Delete; for repeating events scope = this (one occurrence), following or all")
def delete_event(request, event_id: str, scope: Optional[Scope] = None):
    e, original, _ = _resolve(request.user, event_id, editor=True)
    scope = scope or ("this" if original is not None else "all")
    if original is None or scope == "all":
        e.delete()
    elif scope == "this":
        svc.cancel_occurrence(e, original)
    else:
        svc.delete_following(e, original)
    return 204, None


# ---------------------------------------------------------------- attendees

class AttendeeIn(Schema):
    contact_id: Optional[uuid.UUID] = None
    user_id: Optional[uuid.UUID] = None
    name: str = Field("", max_length=200)
    email: str = Field("", max_length=254)
    rsvp: Literal["needs_action", "accepted", "declined", "tentative"] = "needs_action"
    is_organizer: bool = False


class AttendeePatch(Schema):
    rsvp: Optional[Literal["needs_action", "accepted", "declined", "tentative"]] = None
    is_organizer: Optional[bool] = None
    name: Optional[str] = Field(None, max_length=200)
    email: Optional[str] = Field(None, max_length=254)


def _attendee_out(a):
    return {"id": a.id, "contact_id": str(a.contact_id) if a.contact_id else None,
            "user_id": str(a.user_id) if a.user_id else None, "name": a.name, "email": a.email, "rsvp": a.rsvp,
            "is_organizer": a.is_organizer}


def _attendee_event(request, event_id, editor):
    """Attendees belong to the series (or the plain event)."""
    e, original, sub = _resolve(request.user, event_id, editor=editor)
    return e, original, sub


@router.get("/events/{event_id}/attendees", response=list[AttendeeOut])
def list_attendees(request, event_id: str):
    e, _, sub = _attendee_event(request, event_id, editor=False)
    if svc.masked_for(e, request.user, sub.role):
        return []
    return [_attendee_out(a) for a in e.attendees.all()]


@router.post("/events/{event_id}/attendees", response={201: AttendeeOut},
             summary="Add an attendee (a contact, a user, or a name/email)")
def add_attendee(request, event_id: str, payload: AttendeeIn):
    from django.core.validators import validate_email
    from django.core.exceptions import ValidationError
    from django.utils import timezone

    e, original, _ = _attendee_event(request, event_id, editor=True)
    a = EventAttendee(event=e, name=bleach.clean(payload.name), email=payload.email.strip(), rsvp=payload.rsvp,
                      is_organizer=payload.is_organizer)
    contact = None
    if payload.contact_id:
        from contacts.models import Person
        contact = Person.objects.filter(id=payload.contact_id, owner=request.user).first()
        if contact is None:
            raise HttpError(400, "Unknown contact")
        a.contact = contact
        a.name = a.name or contact.name
        if not a.email and contact.emails:
            a.email = (contact.emails[0] or {}).get("value", "")[:254]
    if payload.user_id:
        from users.models import ComptechUser
        u = ComptechUser.objects.filter(id=payload.user_id).first()
        if u is None:
            raise HttpError(400, "Unknown user")
        a.user = u
        a.name = a.name or (u.get_full_name() or u.username)
    if a.email:
        try:
            validate_email(a.email)
        except ValidationError:
            raise HttpError(400, "Invalid email")
    if not (a.name or a.email):
        raise HttpError(400, "An attendee needs a contact, a user, a name or an email")
    a.save()
    # Meeting a contact counts as contact: move their last-contacted date forward.
    when = (svc.occurrence_view(e, original).startdate if original is not None else e.startdate)
    if contact is not None and when <= timezone.now():
        day = timezone.localtime(when, e.calendar.tz).date()
        if contact.last_contacted is None or contact.last_contacted < day:
            contact.last_contacted = day
            contact.save(update_fields=["last_contacted"])
    return 201, _attendee_out(a)


@router.patch("/events/{event_id}/attendees/{int:attendee_id}", response=AttendeeOut)
def update_attendee(request, event_id: str, attendee_id: int, payload: AttendeePatch):
    e, _, _ = _attendee_event(request, event_id, editor=True)
    a = get_object_or_404(EventAttendee, id=attendee_id, event=e)
    for k, v in payload.dict(exclude_unset=True).items():
        if v is not None:
            setattr(a, k, bleach.clean(v) if k == "name" else v)
    a.save()
    return _attendee_out(a)


@router.delete("/events/{event_id}/attendees/{int:attendee_id}", response={204: None})
def remove_attendee(request, event_id: str, attendee_id: int):
    e, _, _ = _attendee_event(request, event_id, editor=True)
    get_object_or_404(EventAttendee, id=attendee_id, event=e).delete()
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
    series_id: Optional[str] = None
    status: Optional[str] = None
    icon: Optional[str] = None
    start_date: Optional[datetime.date] = None
    end_date: Optional[datetime.date] = None


def _user_tz(user):
    import pytz
    from django.utils import timezone as tz_
    return pytz.timezone(user.timezone) if user.timezone in pytz.all_timezones_set else tz_.get_current_timezone()


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
