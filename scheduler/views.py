from django.http import HttpResponse, HttpResponseBadRequest, HttpResponseForbidden, JsonResponse
from django.shortcuts import redirect, render, Http404
from django.contrib.auth.decorators import login_required
from django.db.models import Q
from django.utils import timezone
from .models import *

from django.conf import settings as _settings
CALENDAR_VARS, ONLINE_MODE = _settings.CALENDAR_VARS, _settings.ONLINE_MODE
from Comptech.utils import *

import datetime
import time

# Create your views here.
@login_required
def index(request):
    return render(request, 'scheduler/calendar.html', {"vars": CALENDAR_VARS, "today": datetime.date.today(), "left_sidebar": True, "right_sidebar": True})

def countdown(request, event_id, time="start"):
    from . import service as svc
    series, original = svc.resolve(event_id)
    if series is None:
        raise Http404()
    event_ = svc.occurrence_view(series, original) if original is not None else series
    if event_ is None:
        raise Http404()
    if not event_.public and not series.calendar.public:
        if not series.calendar.can_edit(request.user):
            return error_response("Not authorized", 401)

    if time == "start": event_time = event_.startdate
    elif time == "end": event_time = event_.enddate
    else: raise Http404()

    if event_time == None: raise Http404()
    if event_.enddate == None: time = "none"

    return render(request, 'scheduler/countdown.html', {"event": event_.getinfo(), "time": event_time, "se": time})

def public_calendar(request, calendar_id):
    try: cal = Calendar.objects.filter(id=calendar_id)[0]
    except: raise Http404()
    if not cal.public: raise Http404()
    if request.user.is_authenticated: sub = len(Subscriber.objects.filter(calendar=cal, user=request.user)) > 0
    else: sub = False

    return render(request, "scheduler/public.html", {"calendar": cal.getinfo(), "subscribed": sub})

def availability(request, username):
    try:
        u = ComptechUser.objects.filter(username=username)[0]
        fn = u.first_name
        if u.last_name != "": fn += " " + u.last_name
        return render(request, 'scheduler/availability.html', {"username": username, "name": fn})
    
    except IndexError: raise Http404()

def get_recent(user_):
    from . import service as svc
    ans = {"data": {}}

    subs = {s.calendar_id: s for s in user_.calendar_subscribed.filter(calendar__active=True, visible=True)}
    now = timezone.now()
    events = [e for e in svc.events_in_range(list(subs), now, now + datetime.timedelta(days=7)) if e.startdate >= now][:5]
    ans["data"]["events"] = [e.getinfo(sub_colour=subs[e.calendar_id].colour,
                                       masked=svc.masked_for(e, user_, subs[e.calendar_id].role)) for e in events]
    ans["data"]["todos"] = [i.getinfo() for i in Todo.objects.filter(user=user_, completed=False).order_by('complete_by')[:5]]

    return ans
