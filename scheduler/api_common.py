"""Shared parts of /api/v2/calendar/: validation patterns, calendar schemas, role checks and the
calendar/subscription output used by calendars, events and insights."""

import datetime
from typing import Literal, Optional

from django.conf import settings
from ninja import Field, Schema
from ninja.errors import HttpError

from .models import LEGACY_CATEGORIES, Subscriber, user_brief

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
    # A synced calendar: 1 iCalendar link, 2 public Google calendar (its ID), 50 UWaterloo WCMS
    calendar_type: Literal[0, 1, 2, 50] = 0
    calendar_url: Optional[str] = Field(None, max_length=256)
    auto_sync: bool = False
    sync_past_months: int = Field(1, ge=0, le=120)
    sync_future_months: int = Field(6, ge=0, le=120)


def _check_source(calendar_type, url):
    """A synced calendar needs a source; links must be http(s) or webcal (Google takes a calendar ID)."""
    url = (url or "").strip()
    if calendar_type == 0:
        return None
    if not url:
        raise HttpError(400, "A synced calendar needs a link (or a Google calendar ID)")
    if calendar_type in (1, 50) and not url.lower().startswith(("http://", "https://", "webcal://", "webcals://")):
        raise HttpError(400, "Use an http(s) or webcal link")
    return url


class PreviewIn(Schema):
    calendar_type: Literal[1, 2] = 1
    url: str = Field(..., min_length=1, max_length=256)


class SyncIn(Schema):
    """A one-off sync of a chosen range (the classic Sync dialog). Months: [start, end)."""
    start: Optional[datetime.date] = None
    end: Optional[datetime.date] = None
    token: Optional[str] = Field(None, max_length=4096)  # Google OAuth access token for a private calendar


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


def _aware(value, tz):
    """A datetime sent without a zone is local time in ``tz`` (comparing it with stored times would 500)."""
    if isinstance(value, datetime.datetime) and value.tzinfo is None:
        return value.replace(tzinfo=tz)
    return value
