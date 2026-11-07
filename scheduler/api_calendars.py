"""/api/v2/calendar/: calendars, subscribing, subscribers, invites and categories."""

import datetime
import secrets
import string
from typing import Literal, Optional

import bleach
from django.conf import settings
from django.db import transaction
from django.shortcuts import get_object_or_404
from ninja import Field, Router, Schema
from ninja.errors import HttpError

from notifications.service import notify

from . import recurrence as rec
from . import service as svc
from .api_common import (
    EDITOR_FIELDS,
    HEX_OR_EMPTY,
    ICON,
    CalendarDetailOut,
    CalendarIn,
    CalendarOut,
    CalendarPatch,
    PreviewIn,
    SyncIn,
    _aware,
    _calendar_out,
    _check_source,
    _sub,
)
from .models import (
    ICONS,
    Calendar,
    Event,
    EventCategory,
    Invite,
    Subscriber,
    user_brief,
)

router = Router()  # tags come from scheduler.api_v2.router


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
    url = _check_source(payload.calendar_type, payload.calendar_url)
    with transaction.atomic():
        c = Calendar.objects.create(name=bleach.clean(payload.name), colour=payload.colour.lower(), owner=request.user,
                                    icon=payload.icon, description=bleach.clean(payload.description),
                                    time_zone=payload.time_zone, tags=svc.clean_tags(payload.tags),
                                    calendar_type=payload.calendar_type, calendar_url=url,
                                    auto_sync=payload.auto_sync and payload.calendar_type != 0,
                                    sync_past_months=payload.sync_past_months, sync_future_months=payload.sync_future_months)
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
            v = _check_source(data.get("calendar_type", c.calendar_type), v) if v.strip() else None
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


@router.post("/preview-source", summary="Read a calendar link (or public Google calendar ID) without saving: name, counts, next events")
def preview_source(request, payload: PreviewIn):
    from .sync import preview_source as preview
    if not settings.ONLINE_MODE:
        raise HttpError(503, "The server is in offline mode")
    _check_source(payload.calendar_type, payload.url)
    try:
        tz = rec.zone(request.user.timezone if rec.valid_zone(request.user.timezone) else "")
        return preview(payload.calendar_type, payload.url, tz)
    except ValueError as ex:
        raise HttpError(422, str(ex))


@router.post("/calendars/{int:calendar_id}/sync", summary="Sync a calendar from its source now (its window, or a chosen range of months)")
def sync_now(request, calendar_id: int):
    """Body optional: {start, end, token} (SyncIn). Without one, the calendar's own window."""
    from pydantic import ValidationError

    from .sync import sync_calendar

    try:
        is_json = request.content_type == "application/json" and request.body.strip()
        payload = SyncIn.model_validate_json(request.body) if is_json else None
    except ValidationError as ex:
        raise HttpError(422, ex.errors(include_url=False, include_context=False)[0]["msg"])

    c = _sub(request.user, calendar_id, editor=True).calendar
    if c.calendar_type == 0:
        raise HttpError(400, "This is a local calendar")
    if not c.calendar_url:
        raise HttpError(400, "Add the calendar's link first")
    if not settings.ONLINE_MODE:
        raise HttpError(503, "The server is in offline mode")
    start = end = None
    if payload and (payload.start or payload.end):
        if not (payload.start and payload.end) or payload.end <= payload.start:
            raise HttpError(400, "Pick a start month before the end month")
        if (payload.end - payload.start).days > 3 * 366:
            raise HttpError(400, "Sync up to three years at a time")
        at = lambda d: datetime.datetime(d.year, d.month, d.day, tzinfo=c.tz).isoformat()
        start, end = at(payload.start), at(payload.end)
    status = sync_calendar(c, start, end, token=(payload.token or None) if payload else None, conditional=False)
    if status == "busy":
        raise HttpError(409, "This calendar is already syncing")
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
               f"subscribed to {invite.calendar.name}", source="Calendar", url="/calendar")
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
    expires = _aware(payload.expires_on, me.calendar.tz)
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
    data = {k: v for k, v in payload.dict(exclude_unset=True).items() if v is not None or k in ("expires_on", "max_uses")}
    days = data.pop("expires_in_days", None)
    if data.get("expires_on") is not None:
        data["expires_on"] = _aware(data["expires_on"], me.calendar.tz)
    if days:
        from django.utils import timezone
        data["expires_on"] = timezone.now() + datetime.timedelta(days=days)
    # Admin invites grant admin: only the owner may change them in any way (or make one).
    if (data.get("role") == "admin" or i.role == 1) and me.role != "owner":
        raise HttpError(403, "Only the owner can change admin invites")
    for k, v in data.items():
        setattr(i, k, (1 if v == "admin" else 2) if k == "role" else v)
    i.save()
    return _invite_out(i)


@router.delete("/calendars/{int:calendar_id}/invites/{int:invite_id}", response={204: None})
def delete_invite(request, calendar_id: int, invite_id: int):
    me = _sub(request.user, calendar_id, editor=True)
    i = get_object_or_404(Invite, id=invite_id, calendar_id=calendar_id)
    if i.role == 1 and me.role != "owner":
        raise HttpError(403, "Only the owner can delete admin invites")
    i.delete()
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
