from django.http import HttpResponse, HttpResponseBadRequest, HttpResponseForbidden, JsonResponse
from django.contrib import messages
from django.shortcuts import redirect, render, Http404
from django.contrib.auth.decorators import login_required
from django.db.models import Q
from django.db.utils import IntegrityError
from django.utils import timezone
from .models import *
from .forms import *
from Comptech.settings import CALENDAR_VARS

import requests
import datetime
import json
import pytz

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
    calendars = user_.calendar_subscribers.filter(active=True).union(user_.calendar_owner.filter(active=True))
    ans["data"]["calendars"] = [i.getinfo_full() for i in calendars.iterator()]
    ans["data"]["assignments"] = []
    ans["data"]["events"] = []
    ans["data"]["tasks"] = []

    for calendar in calendars:
        ans["data"]["assignments"].extend([i.getinfo() for i in Assignment.objects.filter(calendar=calendar, date__month=(int(month) + 1), date__year=int(year)).iterator()])
        ans["data"]["events"].extend([i.getinfo() for i in Event.objects.filter(Q(calendar=calendar) & ((Q(startdate__month=(int(month) + 1)) & Q(startdate__year=(int(year)))) | (Q(enddate__month=(int(month) + 1)) & Q(enddate__year=(int(year)))))).iterator()])
        ans["data"]["tasks"].extend([i.getinfo() for i in Task.objects.filter(calendar=calendar, date__month=(int(month) + 1), date__year=int(year)).iterator()])

    return JsonResponse(ans)

def get_events_from_google_calendar(request):
    if not request.user.is_authenticated:
        return HttpResponseForbidden("Not logged in")
    month = request.GET.get("month")
    if month == None:
        return HttpResponseBadRequest("Month not provided")
    year = request.GET.get("year")
    if year == None:
        return HttpResponseBadRequest("Year not provided")

    calendar_id = "example@group.calendar.google.com"
    api_key = "REDACTED_GOOGLE_API_KEY"

    tzoffset = datetime.datetime.now(pytz.timezone(timezone.get_current_timezone_name())).strftime('%z')

    start_time = f"{year}-{str(int(month) + 1)}-01T00:00:00{tzoffset}"
    y_ = int(year)
    m_ = int(month) + 2
    if m_ == 13:
        m_ = 1
        y_ += 1
    end_time = f"{str(y_)}-{str(m_)}-01T00:00:00{tzoffset}"
    fields = str("items(kind,summary,start,end)")

    r = requests.get(f"https://www.googleapis.com/calendar/v3/calendars/{calendar_id}/events?key={api_key}&timeMin={start_time}&timeMax={end_time}&fields={fields}")
    
    res = r.json()

    return JsonResponse({"data": res["items"]})
    

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
        
            return render(request, 'scheduler/countdown.html', {"event": event_.getinfo(), "time": event_time.strftime("%b %d %Y %H:%M:%S"), "se": time})

        else:
            return HttpResponse('401 Unauthorized', status=401)
    except IndexError:
        raise Http404()

def get_recent(user_):
    ans = {"data": {}}

    calendars = list(user_.calendar_subscribers.all().union(user_.calendar_owner.all()))
    #ans["data"]["events"] = [i.getinfo_zip() for i in Event.objects.filter(Q(calendar__in=calendars) & Q(startdate__gte=datetime.datetime.now()) & Q(startdate__lte=datetime.datetime.now() + datetime.timedelta(days=7))).order_by('startdate')[:5]]
    ans["data"]["events"] = [i.getinfo_zip() for i in Event.objects.filter(calendar__in=calendars, startdate__gte=datetime.datetime.now(), startdate__lte=datetime.datetime.now() + datetime.timedelta(days=7)).order_by('startdate')[:5]]
    ans["data"]["tasks"] = [i.getinfo_zip() for i in Task.objects.filter(calendar__in=calendars, date=datetime.datetime.now().date())]

    return ans

def create_calendar(request):
    if request.method == 'POST':
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
                if req["type"] == "assignment":
                    assignment = Assignment(
                        calendar=Calendar.objects.filter(id=req["calendar"])[0],
                        name=req["name"],
                        date=datetime.datetime.strptime(req["date"], '%Y-%m-%d %H:%M'),
                        description=req["description"],
                        public=req["public"] == 'true',
                        priority=req["priority"],
                    )
                    assignment.save()

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

                elif req["type"] == "task":
                    task = Task(
                        calendar=Calendar.objects.filter(id=req["calendar"])[0],
                        name=req["name"],
                        date=datetime.datetime.strptime(req["date"], '%Y-%m-%d'),
                        description=req["description"],
                        priority=req["priority"],
                    )
                    task.save()

            else:
                return JsonResponse({"status": "error", "data": "You dot not own this calendar"})
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
            class_ = invite[0].calendar
            if class_ in request.user.calendar_subscribers.all():
                return JsonResponse({"status": "error", "data": "You are already subscribed to this calendar"})
            else:
                if invite[0].active == True:
                    return JsonResponse({"status": "success", "data": class_.getinfo()})
                else:
                    return JsonResponse({"status": "error", "data": "This invite is not active"})
        except IndexError:
            return JsonResponse({"status": "error", "data": "Invalid Invite Code"})
    else:
        try:
            class_ = invite[0].calendar
            if class_ in request.user.calendar_subscribers.all():
                return JsonResponse({"status": "error", "data": "You are already subscribed to this calendar"})
            else:
                invite_ = invite[0]
                if invite_.active == True:
                    class_.subscribers.add(request.user)
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
                class_ = request.GET.get("class")
                if class_ == None:
                    return JsonResponse({"status": "error", "data": "No Calendar provided"})
                
                try:
                    if len(invitecode) > 8:
                        return JsonResponse({"status": "error", "data": "Invite code too long"})
                    else:
                        class1 = Calendar.objects.filter(id=class_)[0]
                        if class1.owner.id != request.user.id:
                            return JsonResponse({"status": "error", "data": "Unauthorized"})

                        invite = Invite(calendar=class1, code=invitecode, uses=0, active=True)
                        invite.save()

                        return JsonResponse({"status": "success", "data": invite.id})
                except IndexError:
                    return JsonResponse({"status": "error", "data": "Calendar does not exist"})
