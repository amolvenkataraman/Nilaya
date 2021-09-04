from django.http import HttpResponse, HttpResponseBadRequest, HttpResponseForbidden, JsonResponse
from django.contrib import messages
from django.core import serializers
from django.shortcuts import redirect, render, Http404
from django.contrib.auth.decorators import login_required
from django.db.models import Q
from django.db.utils import IntegrityError
from django.utils import timezone
from .models import *
from .forms import *
from Comptech.settings import CALENDAR_VARS, ONLINE_MODE
from Comptech.api import GOOGLE_API_KEY

from ics import Calendar as Cal

import date_converter
import requests
import datetime
import json
import pytz
import time

# Create your views here.
@login_required
def index(request):
    return render(request, 'scheduler/schedule.html', {"vars": CALENDAR_VARS})

def get_events(request):
    if not request.user.is_authenticated:
        return HttpResponseForbidden("Not logged in")
    month = request.GET.get("month")
    if month == None:
        return HttpResponseBadRequest("Month not provided")
    year = request.GET.get("year")
    if year == None:
        return HttpResponseBadRequest("Year not provided")

    ans = {"data": {}}
    user_ = request.user
    if request.GET.get("show_all") == "1":
        calendars = user_.calendar_subscribers.all().union(user_.calendar_owner.all())
    else:
        calendars = user_.calendar_subscribers.filter(active=True).union(user_.calendar_owner.filter(active=True)).order_by('name')
    ans["data"]["calendars"] = [i.getinfo() for i in calendars.iterator()]
    ans["data"]["events"] = [i.getinfo() for i in Event.objects.filter(
        Q(calendar__in=list(calendars)) &
        ((Q(startdate__month=(int(month) + 1)) & Q(startdate__year=(int(year)))) |
        (Q(enddate__month=(int(month) + 1)) & Q(enddate__year=(int(year)))) |
        Q(Q(startdate__month__lt=(int(month) + 1), enddate__month__gt=(int(month) + 1)) & (Q(startdate__year=int(year), enddate__year=int(year)))))
    ).order_by('startdate').iterator()]
    ans["data"]["online_mode"] = ONLINE_MODE

    return JsonResponse(ans)

def sync_events(calendar_id, sy, sm, ey, em, sync_type):
    if ONLINE_MODE:
        calendar = Calendar.objects.filter(id=calendar_id)[0]
        if sync_type == "pgc": # Public Google Calendar
            tzoffset = datetime.datetime.now(pytz.timezone(timezone.get_current_timezone_name())).strftime('%z')

            start_time = f"{sy}-{sm}-01T00:00:00{tzoffset}"
            end_time = f"{ey}-{em}-01T00:00:00{tzoffset}"
            fields = str("items(kind,summary,start,end)")

            r = requests.get(f"https://www.googleapis.com/calendar/v3/calendars/{calendar.calendar_url}/events?key={GOOGLE_API_KEY}&timeMin={start_time}&timeMax={end_time}&singleEvents=true&orderBy=startTime")
            res = r.json()
            print(len(res["items"]))
            for i in res["items"]:
                try:
                    #print(i, end="\n\n")
                    e_ = Event.objects.filter(sync_id=i['id'])
                    try:
                        e = e_[0]
                    except IndexError:
                        e = Event()

                    e.calendar = calendar
                    e.name = i['summary']
                    e.sync_id = i['id']
                    try:
                        e.startdate = i['start']['dateTime']
                    except KeyError:
                        e.startdate = i['start']['date']
                        e.allday = True
                    try:
                        e.enddate = i['end']['dateTime']
                    except KeyError:
                        e.enddate = i['end']['date']
                        e.allday = True
                    
                    e.save()

                except Exception as ex:
                    print(f"A(n) {type(ex).__name__} occurred. {ex.args}")
    else:
        print("Server is on Offline Mode")

def clone_event(event_id, n):
    e = Event.objects.filter(id=event_id)[0]
    e.pk = None
    e.startdate = e.startdate + datetime.timedelta(days=n)
    e.enddate = e.enddate + datetime.timedelta(days=n)
    e.save()

def countdown(request, event_id, time="start"):
    try:
        event_ = Event.objects.filter(id=event_id)[0]
        if request.user == event_.calendar.owner or request.user in event_.calendar.subscribers.all() or event_.public == True:
            name = event_.name
            if time == "start":
                event_time = event_.startdate
            elif time == "end":
                event_time = event_.enddate
            else:
                raise Http404()

            if event_time == None:
                raise Http404
        
            return render(request, 'scheduler/countdown.html', {"event": event_.getinfo(), "time": event_time.strftime("%b %d %Y %H:%M:%S %z"), "se": time})
            

        else:
            return HttpResponse('401 Unauthorized', status=401)
    except IndexError:
        raise Http404()

def get_recent(user_):
    ans = {"data": {}}

    calendars = list(user_.calendar_subscribers.all().union(user_.calendar_owner.all()))
    ans["data"]["events"] = [i.getinfo_zip() for i in Event.objects.filter(calendar__in=calendars, startdate__gte=timezone.now(), startdate__lte=timezone.now() + datetime.timedelta(days=7)).order_by('startdate')[:5]]
    ans["data"]["tasks"] = []

    return ans

def calendar(request):
    if request.method == 'GET':
        if request.user.is_authenticated:
            calendar = request.GET.get("id")
            if calendar == None:
                return HttpResponseBadRequest("Calendar ID not provided")
            try:
                c_ = Calendar.objects.filter(id=calendar)[0]
                return JsonResponse(c_.getinfo_full())
            except IndexError:
                return HttpResponseBadRequest("Invalid Calendar")
        else:
            return JsonResponse({"status": "error", "data": "Not logged in"})

    elif request.method == 'POST':
        if request.user.is_authenticated:
            b = json.loads(request.body.decode('utf8'))
            try:
                c = Calendar(name=b['name'], colour=b['color'])
                c.owner = request.user
                c.save()
            except IntegrityError:
                return JsonResponse({"status": "error", "data": "Calendar name must be unique"})
        else:
            return JsonResponse({"status": "error", "data": "Not logged in"})

        return JsonResponse({"status": "success", "data": "OK"})

def add(request):
    if request.method == 'POST':
        if request.user.is_authenticated:
            req = json.loads(request.body)

            if (Calendar.objects.filter(id=req["calendar"])[0].owner == request.user):
                try:
                    if req["type"] == "event":
                        event = Event(
                            calendar=Calendar.objects.filter(id=req["calendar"])[0],
                            name=req["name"],
                            startdate=datetime.datetime.strptime(req["start"], '%Y-%m-%d %H:%M'),
                            enddate=datetime.datetime.strptime(req["end"], '%Y-%m-%d %H:%M'),
                            description=req["description"],
                            public=req["public"] == 'true',
                            priority=req["priority"],
                        )
                        event.save()
                        return JsonResponse({"status": "success", "data": "OK"})
                
                except Exception as ex:
                    return JsonResponse({"status": "error", "data": f"A(n) {type(ex).__name__} occurred. {ex.args}"})    

            else:
                return JsonResponse({"status": "error", "data": "You do not own this calendar"})
        else:
            return JsonResponse({"status": "error", "data": "Not logged in"})

def delete(request):
    if request.method == 'POST':
        if request.user.is_authenticated:
            evs = Event.objects.filter(id=request.body.decode("utf-8"))
            try:
                ev = evs[0]
                if (ev.calendar.owner == request.user):
                    try:
                        ev.delete()
                        return JsonResponse({"status": "success", "data": "OK"})
                    except Exception as ex:
                        return JsonResponse({"status": "error", "data": f"A(n) {type(ex).__name__} occurred. {ex.args}"})
                else:
                    return JsonResponse({"status": "error", "data": "You do not own this calendar"})

            except IndexError:
                return JsonResponse({"status": "error", "data": "Invalid Event"})
        else:
            return JsonResponse({"status": "error", "data": "Not logged in"})

        return JsonResponse({"status": "success", "data": "OK"})

@login_required
def enroll(request):
    invitecode = request.GET.get("code")
    if invitecode == None:
        return JsonResponse({"status": "error", "data": "No Invite Code provided"})
    invite = Invite.objects.filter(code=invitecode)
    if request.method == 'GET':
        try:
            calendar_ = invite[0].calendar
            if calendar_ in request.user.calendar_subscribers.all() or calendar_.owner == request.user:
                return JsonResponse({"status": "error", "data": "You are already subscribed to this calendar"})
            else:
                if invite[0].active == True:
                    return JsonResponse({"status": "success", "data": calendar_.getinfo()})
                else:
                    return JsonResponse({"status": "error", "data": "This invite is not active"})
        except IndexError:
            return JsonResponse({"status": "error", "data": "Invalid Invite Code"})
    else:
        try:
            calendar_ = invite[0].calendar
            if calendar_ in request.user.calendar_subscribers.all():
                return JsonResponse({"status": "error", "data": "You are already subscribed to this calendar"})
            else:
                invite_ = invite[0]
                if invite_.active == True:
                    calendar_.subscribers.add(request.user)
                    invite_.uses += 1
                    invite_.save()
                    return JsonResponse({"status": "success"})
                else:
                    return JsonResponse({"status": "error", "data": "This invite is not active"})
        except IndexError:
            return JsonResponse({"status": "error", "data": "Invalid Invite Code"})

@login_required
def invite(request):
    invitecode = request.GET.get("code")
    option = request.GET.get("option")
    if invitecode == None:
        return JsonResponse({"status": "error", "data": "No Invite Code provided"})
    if option == None:
        return JsonResponse({"status": "error", "data": "No Choice provided"})

    if request.method == "GET":
        if option == "check":
            invite = Invite.objects.filter(id=invitecode)
            try:
                temp = invite[0].getinfo()
                return JsonResponse({"status": "success", "data": "NO"})
            except IndexError:
                return JsonResponse({"status": "success", "data": "YES"})

    elif request.method == "POST":
        if option == "active":
            try:
                invite = Invite.objects.filter(id=invitecode)[0]
                if invite.calendar.owner.id != request.user.id:
                    return JsonResponse({"status": "error", "data": "Unauthorzed"})
                if invite.active == True:
                    invite.active = False
                else:
                    invite.active = True
                invite.save()
                return JsonResponse({"status": "success", "data": "OK"})
            except IndexError:
                return JsonResponse({"status": "error", "data": "Invalid Invite"})

        elif option == "create":
            invite = Invite.objects.filter(code=invitecode)
            try:
                temp = invite[0].getinfo()
                return JsonResponse({"status": "error", "data": "This invite already exists"})
            except IndexError:
                calendar_ = request.GET.get("class")
                if calendar_ == None:
                    return JsonResponse({"status": "error", "data": "No Calendar provided"})
                
                try:
                    if len(invitecode) > 8:
                        return JsonResponse({"status": "error", "data": "Invite code too long"})
                    else:
                        calendar1_ = Calendar.objects.filter(id=calendar_)[0]
                        if calendar1_.owner.id != request.user.id:
                            return JsonResponse({"status": "error", "data": "Unauthorized"})

                        invite = Invite(calendar=calendar1_, code=invitecode, uses=0, active=True)
                        invite.save()

                        return JsonResponse({"status": "success", "data": invite.id})
                except IndexError:
                    return JsonResponse({"status": "error", "data": "Calendar does not exist"})
