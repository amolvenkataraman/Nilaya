"""/api/v2/calendar/public/: what anyone with the link may see, signed in or not.

- A public calendar: its name and colour, and its events (times, name, location) for a range.
- A countdown to an event's start or end: public events, events on public calendars, or the
  calendar's owner and admins.

Private events show only as "Busy" (service.masked_for) to everyone but the calendar's owner and
admins, exactly as in the calendar itself. Reading needs no sign-in (auth=None); subscribing does.
"""

import datetime
from typing import Literal, Optional

from django.shortcuts import get_object_or_404
from ninja import Router, Schema
from ninja.errors import HttpError

from notifications.service import notify

from . import service as svc
from .models import Calendar, Subscriber

router = Router(tags=["calendar"])


class PublicCalendarOut(Schema):
    id: int
    name: str
    colour: str
    description: str
    owner: str
    time_zone: str
    subscribed: Optional[bool]  # None when signed out


class PublicEventOut(Schema):
    id: str
    name: str
    start: datetime.datetime
    end: Optional[datetime.datetime]
    all_day: bool
    location: Optional[str]
    busy: bool  # a private event: name "Busy", no location


class CountdownOut(Schema):
    id: str
    name: str
    target: datetime.datetime
    which: Literal["start", "end"]
    deadline: bool  # the event has no end (a deadline): the page doesn't say "to start"
    busy: bool


def _public_calendar(calendar_id):
    return get_object_or_404(Calendar.objects.select_related("owner"), id=calendar_id, public=True)


def _role(request, calendar):
    return calendar.role_of(request.user) if request.user.is_authenticated else None


@router.get("/calendars/{int:calendar_id}", auth=None, response=PublicCalendarOut,
            summary="A public calendar's name, colour and owner (no sign-in needed)")
def public_calendar(request, calendar_id: int):
    cal = _public_calendar(calendar_id)
    subscribed = Subscriber.objects.filter(calendar=cal, user=request.user).exists() \
        if request.user.is_authenticated else None
    owner = cal.owner
    return {"id": cal.id, "name": cal.name, "colour": cal.colour or "#0891b2", "description": cal.description or "",
            "owner": (owner.get_full_name() or owner.username) if owner else "", "time_zone": cal.time_zone or "",
            "subscribed": subscribed}


@router.get("/calendars/{int:calendar_id}/events", auth=None, response=list[PublicEventOut],
            summary="A public calendar's events overlapping [start, end) (at most 100 days; private ones as Busy)")
def public_events(request, calendar_id: int, start: datetime.datetime, end: datetime.datetime):
    cal = _public_calendar(calendar_id)
    if end <= start or end - start > datetime.timedelta(days=100):
        raise HttpError(400, "Pick a range of up to 100 days")
    role = _role(request, cal)
    out = []
    for e in svc.events_in_range([cal.id], start, end):
        busy = svc.masked_for(e, request.user, role)
        out.append({"id": e.ident(), "name": "Busy" if busy else e.name, "start": e.startdate, "end": e.enddate,
                    "all_day": e.kind == "all_day", "location": None if busy else (e.location or None), "busy": busy})
    return out


@router.post("/calendars/{int:calendar_id}/subscribe", response={201: dict},
             summary="Subscribe to a public calendar (no invite code needed)")
def subscribe_public(request, calendar_id: int):
    cal = _public_calendar(calendar_id)
    _, created = Subscriber.objects.get_or_create(calendar=cal, user=request.user, defaults={"colour": cal.colour})
    if created and cal.owner_id != request.user.id:
        notify(cal.owner, f"{request.user.get_full_name() or request.user.username} subscribed to {cal.name}",
               "Manage subscribers in the calendar's settings.", source="Calendar", url="/calendar")
    return 201, {"calendar_id": cal.id, "subscribed": True}


@router.get("/countdown/{event_id}", auth=None, response=CountdownOut,
            summary="Countdown to an event's start or end (public events and calendars, or their owner and admins)")
def countdown(request, event_id: str, which: Literal["start", "end"] = "start"):
    series, original = svc.resolve(event_id)
    if series is None:
        raise HttpError(404, "Not found")
    event = svc.occurrence_view(series, original) if original is not None else series
    if event is None:
        raise HttpError(404, "Not found")
    role = _role(request, series.calendar)
    if not event.public and not series.calendar.public and role not in ("owner", "admin"):
        raise HttpError(404, "Not found")  # don't confirm that a private event exists
    target = event.startdate if which == "start" else event.enddate
    if target is None:
        raise HttpError(404, "This event has no end time")
    busy = svc.masked_for(event, request.user, role)
    return {"id": event.ident(), "name": "Busy" if busy else event.name, "target": target, "which": which,
            "deadline": event.enddate is None, "busy": busy}
