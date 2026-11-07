import datetime

import pytz
from django.conf import settings
from django.db.models import F
from django.http import Http404, HttpResponse
from django.utils import timezone

from django.db.models import Q

from scheduler import ical
from scheduler.service import masked_for
from scheduler.models import Event, Subscriber

from . import ics
from .models import Feed


def _site(request):
    return getattr(settings, "SITE_URL", "") or request.build_absolute_uri("/").rstrip("/")


def feed(request, token):
    f = Feed.from_token(token)
    if f is None:
        raise Http404
    Feed.objects.filter(pk=f.pk).update(fetches=F("fetches") + 1, last_fetched_on=timezone.now())
    now = timezone.now()
    site = _site(request)
    tz = pytz.timezone(f.user.timezone) if f.user.timezone in pytz.all_timezones_set else timezone.get_current_timezone()
    items = []
    if f.kind == "calendar":
        return _calendar_feed(f, now)
    from tasks.service import visible_tasks
    for t in visible_tasks(f.user).filter(completed=False, complete_by__isnull=False,
                                         complete_by__gte=now - datetime.timedelta(days=30)).select_related("project"):
        local = timezone.localtime(t.complete_by, tz)
        item = {"uid": f"task-{t.id}@nilaya", "summary": t.name, "url": f"{site}/tasks?task={t.id}",
                "description": t.description, "categories": t.project.name if t.project_id else "Tasks"}
        if (local.hour, local.minute) == (23, 59):  # "due that day": an all-day entry reads better on phones
            item.update(all_day=True, start=local.date())
        else:
            item.update(start=t.complete_by, end=t.complete_by + datetime.timedelta(minutes=15))
        items.append(item)
    name = "Nilaya Tasks"
    resp = HttpResponse(ics.calendar(name, items), content_type="text/calendar; charset=utf-8")
    resp["Cache-Control"] = "private, max-age=300"
    resp["X-Robots-Tag"] = "noindex"
    return resp


def _calendar_feed(f, now):
    """Your visible calendars' events from 60 days ago to 400 days ahead. Repeating events are
    sent once with RRULE/EXDATE (the subscribing app expands them); cancelled events are left out."""
    subs = {s.calendar_id: s for s in Subscriber.objects.filter(user=f.user, visible=True, calendar__active=True)
            .select_related("calendar")}
    lo, hi = now - datetime.timedelta(days=60), now + datetime.timedelta(days=400)
    base = Event.objects.filter(calendar_id__in=list(subs)).exclude(status="cancelled").select_related(
        "calendar", "event_category")
    singles = base.filter(recurrence_parent__isnull=True, rrule="", startdate__gte=lo, startdate__lte=hi)
    series = list(base.filter(recurrence_parent__isnull=True, startdate__lte=hi).exclude(rrule="")
                  .filter(Q(recurrence_end__isnull=True) | Q(recurrence_end__gte=lo)))
    overrides = list(Event.objects.filter(recurrence_parent__in=[s.id for s in series])
                     .select_related("calendar", "event_category"))
    cancelled = {}
    for o in overrides:
        if o.status == "cancelled":
            cancelled.setdefault(o.recurrence_parent_id, []).append(ical.rec.key(o.original_start))
    zones, bodies = {}, []

    parents = {s.id: s for s in series}

    def add(e, **kw):
        s = subs[e.calendar_id]
        src = parents.get(e.recurrence_parent_id, e)  # an override uses its series' zone (RECURRENCE-ID)
        name = src.time_zone or src.calendar.time_zone or settings.TIME_ZONE
        tz = ical.rec.event_zone(src)
        if e.rrule or e.recurrence_parent_id:
            y = zones.setdefault(name, [tz, e.startdate.year, e.startdate.year])
            y[1] = min(y[1], e.startdate.year)
        bodies.extend(ical.vevent(e, calendar_name=s.calendar.name, colour=e.display_colour(s.colour), tz=tz,
                                  tzid=name, stamp=e.updated_on or now, masked=masked_for(e, f.user, s.role), **kw))

    for e in singles.iterator():
        add(e)
    for e in series:
        add(e, extra_exdates=cancelled.get(e.id, ()))
    for o in overrides:
        if o.status != "cancelled":
            add(o)
    header = []
    for name, (tz, first, _) in zones.items():
        header += ical.vtimezone(name, tz, first, now.year + 10)
    resp = HttpResponse(ical.calendar_text("Nilaya Calendar", header, bodies), content_type="text/calendar; charset=utf-8")
    resp["Cache-Control"] = "private, max-age=300"
    resp["X-Robots-Tag"] = "noindex"
    return resp
