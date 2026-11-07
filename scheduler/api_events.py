"""/api/v2/calendar/events: events and occurrences (create, edit with scope, duplicate, delete) and attendees."""

import datetime
import uuid
from typing import Literal, Optional

import bleach
from django.conf import settings
from django.db import transaction
from django.db.models import Q
from django.shortcuts import get_object_or_404
from ninja import Field, Router, Schema
from ninja.errors import HttpError

from . import recurrence as rec
from . import service as svc
from .api_common import CATEGORIES, HEX_OR_EMPTY, ICON, Scope, _aware, _bad, _sub
from .models import Event, EventAttendee, EventCategory, EventReminder, Subscriber

router = Router()  # tags come from scheduler.api_v2.router


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
    role = sub.role if sub else e.calendar.role_of(user)
    return _event_out(e, sub.colour if sub else None, svc.masked_for(e, user, role), detail, user)


def _aware_times(data, tz):
    for k in ("start", "end"):
        if data.get(k) is not None:
            data[k] = _aware(data[k], tz)
    return data


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
        if data.get("name") is None:
            data.pop("name", None)  # required: null leaves it as it is
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
                include_cancelled: bool = False, include_inactive: bool = False):
    tz = rec.zone(request.user.timezone if rec.valid_zone(request.user.timezone) else "")
    start, end = _aware(start, tz), _aware(end, tz)
    if end <= start or end - start > datetime.timedelta(days=400):
        raise HttpError(400, "Pick a range of up to 400 days")
    # Inactive (disabled) calendars stay out of the normal view, but asking for one by id, or with
    # include_inactive, shows its events (to look something up before re-enabling it).
    subs = svc.visible_calendar_ids(request.user, include_hidden=include_hidden or calendar is not None,
                                    include_inactive=include_inactive or calendar is not None).select_related("calendar")
    if calendar is not None:
        subs = subs.filter(calendar_id=calendar)
    subs = {s.calendar_id: s for s in subs}
    extra = Q(name__icontains=q) if q else None
    events = svc.events_in_range(list(subs), start, end, include_cancelled=include_cancelled, extra=extra)
    if tag:
        events = [e for e in events if svc.in_tags(e, tag)]
    out = ((e, svc.masked_for(e, request.user, subs[e.calendar_id].role)) for e in events)
    # q and tag only match what the caller can see: a masked event ("Busy", no tags) never matches,
    # or a search could spell out a private title letter by letter.
    return [_event_out(e, subs[e.calendar_id].colour, masked) for e, masked in out if not (masked and (q or tag))]


@router.post("/events", response={201: EventDetailOut})
def create_event(request, payload: EventIn):
    sub = _sub(request.user, payload.calendar_id, editor=True)
    data = payload.dict()
    if data["start"] is None and data["start_date"] is None:
        raise HttpError(400, "start (or start_date for an all-day event) is required")
    if data["kind"] is None and data["start_date"] and data["start"] is None:
        data["kind"] = "all_day"
    _aware_times(data, sub.calendar.tz)
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
    data = _aware_times(payload.dict(exclude_unset=True), e.calendar.tz)
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
    if abs(days) > 36600:
        raise HttpError(400, "Shift by up to 100 years")
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
    from django.core.exceptions import ValidationError
    from django.core.validators import validate_email
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
