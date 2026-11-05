import datetime

import pytz
from django.conf import settings
from django.db.models import F
from django.http import Http404, HttpResponse
from django.utils import timezone

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
        subs = Subscriber.objects.filter(user=f.user, visible=True, calendar__active=True).select_related("calendar")
        names = {s.calendar_id: s.calendar.name for s in subs}
        for e in Event.objects.filter(calendar_id__in=names, startdate__gte=now - datetime.timedelta(days=60),
                                      startdate__lte=now + datetime.timedelta(days=400)).iterator():
            if e.allday:
                start = timezone.localtime(e.startdate, tz).date()
                end = timezone.localtime(e.enddate, tz).date() if e.enddate else None
                items.append({"uid": f"{e.id}@avnet", "summary": e.name, "all_day": True, "start": start,
                              "end": end if end and end > start else None, "categories": names[e.calendar_id]})
            else:
                items.append({"uid": f"{e.id}@avnet", "summary": e.name if e.enddate else f"Due: {e.name}",
                              "start": e.startdate, "end": e.enddate, "location": e.location,
                              "description": e.description, "categories": names[e.calendar_id]})
        name = "AVNet Calendar"
    else:
        from tasks.service import visible_tasks
        for t in visible_tasks(f.user).filter(completed=False, complete_by__isnull=False,
                                             complete_by__gte=now - datetime.timedelta(days=30)).select_related("project"):
            local = timezone.localtime(t.complete_by, tz)
            item = {"uid": f"task-{t.id}@avnet", "summary": t.name, "url": f"{site}/tasks/?task={t.id}",
                    "description": t.description, "categories": t.project.name if t.project_id else "Tasks"}
            if (local.hour, local.minute) == (23, 59):  # "due that day": an all-day entry reads better on phones
                item.update(all_day=True, start=local.date())
            else:
                item.update(start=t.complete_by, end=t.complete_by + datetime.timedelta(minutes=15))
            items.append(item)
        name = "AVNet Tasks"
    resp = HttpResponse(ics.calendar(name, items), content_type="text/calendar; charset=utf-8")
    resp["Cache-Control"] = "private, max-age=300"
    resp["X-Robots-Tag"] = "noindex"
    return resp
