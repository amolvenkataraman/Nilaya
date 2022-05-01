from django.http import HttpResponse, HttpResponseBadRequest, HttpResponseForbidden, JsonResponse
from django.shortcuts import redirect, render, Http404
from django.contrib.auth.decorators import login_required
from django.db.models import Q
from django.utils import timezone
from .models import *

from Comptech.settings import CALENDAR_VARS, ONLINE_MODE
from Comptech.utils import *

import datetime
import time

# Create your views here.
@login_required
def index(request):
    return render(request, 'scheduler/schedule.html', {"vars": CALENDAR_VARS, "today": datetime.date.today()})

@login_required
def countdown(request, event_id, time="start"):
    try:
        event_ = Event.objects.filter(id=event_id)[0]
        if event_.public == False or event_.calendar.public == False:
            try:
                if event_.calendar.users_subscribed.filter(user=request.user)[0].subscribe_type not in [0, 1]:
                    return error_response("Not authorized", 401)
            except IndexError:
                return error_response("Not authorized", 401)
            
        name = event_.name
        if time == "start":
            event_time = event_.startdate
        elif time == "end":
            event_time = event_.enddate
        else: raise Http404()

        if event_time == None: raise Http404()
        if event_.enddate == None: time = "none"
    
        return render(request, 'scheduler/countdown.html', {"event": event_.getinfo(), "time": event_time.strftime("%b %d %Y %H:%M:%S %z"), "se": time})
    except IndexError:
        raise Http404()

def get_recent(user_):
    ans = {"data": {}}

    calendars = [i.calendar for i in user_.calendar_subscribed.filter(calendar__active=True, visible=True)]
    ans["data"]["events"] = [i.getinfo() for i in Event.objects.filter(calendar__in=calendars, startdate__gte=timezone.now(), startdate__lte=timezone.now() + datetime.timedelta(days=7)).order_by('startdate')[:5]]
    ans["data"]["todos"] = [i.getinfo() for i in Todo.objects.filter(user=user_, completed=False,)[:5]]
    ans["data"]["tasks"] = []

    return ans
