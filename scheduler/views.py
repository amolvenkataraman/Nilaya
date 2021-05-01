from django.http import HttpResponse, HttpResponseBadRequest, HttpResponseForbidden, JsonResponse
from django.contrib import messages
from django.shortcuts import redirect, render, Http404
from django.contrib.auth.decorators import login_required
from django.db.models import Q
from django.db.utils import IntegrityError
from .models import *
from .forms import *
from Comptech.settings import CALENDAR_VARS

import requests
import datetime
import json

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
    #print(month, year)

    user_ = request.user
    calendars = user_.calendar_subscribers.all().union(user_.calendar_owner.all())
    ans["data"]["calendars"] = [i.getinfo() for i in calendars]
    ans["data"]["events"] = []
    ans["data"]["reminders"] = []

    for calendar in calendars:
        ans["data"]["events"].extend([i.getinfo() for i in Event.objects.filter(Q(calendar=calendar) & ((Q(startdate__month=(int(month) + 1)) & Q(startdate__year=(int(year)))) | (Q(enddate__month=(int(month) + 1)) & Q(enddate__year=(int(year))))))])
        ans["data"]["reminders"].extend([i.getinfo() for i in Reminder.objects.filter(calendar=calendar, date__month=(int(month) + 1))])

    
    return JsonResponse(ans)

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

    calendars = user_.calendar_subscribers.all().union(user_.calendar_owner.all())
    ans["data"]["events"] = []
    ans["data"]["reminders"] = []

    for calendar in calendars:
        ans["data"]["events"].extend([i.getinfo_zip() for i in Event.objects.filter(Q(calendar=calendar) & Q(startdate__gte=datetime.datetime.now()) & Q(startdate__lte=datetime.datetime.now() + datetime.timedelta(days=7))).order_by('startdate')[:5]])
        ans["data"]["reminders"].extend([i.getinfo_zip() for i in Reminder.objects.filter(calendar=calendar, date=datetime.datetime.today())])

    return ans

def create_calendar(request):
    if request.method == 'POST':
        if request.user.is_authenticated:
            b = json.loads(request.body.decode('utf8'))
            try:
                c = Calendar(name=b['name'])
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
                if req["type"] == "event":
                    event = Event(
                        calendar=Calendar.objects.filter(id=req["calendar"])[0],
                        name=req["name"],
                        startdate=datetime.datetime.strptime(req["start"], '%Y-%m-%d %H:%M'),
                        enddate=datetime.datetime.strptime(req["end"], '%Y-%m-%d %H:%M'),
                        description=req["description"],
                    )
                    event.save()
            
                elif req["type"] == "reminder":
                    reminder = Reminder(
                        calendar=Calendar.objects.filter(id=req["calendar"])[0],
                        name=req["name"],
                        date=datetime.datetime.strptime(req["date"], '%Y-%m-%d'),
                        description=req["description"],
                    )
                    reminder.save()

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
            class_ = invite[0].Class
            if class_ in request.user.class_student.all():
                return JsonResponse({"status": "error", "data": "You are already enrolled in this class"})
            else:
                if invite[0].active == True:
                    return JsonResponse({"status": "success", "data": class_.getinfo()})
                else:
                    return JsonResponse({"status": "error", "data": "This invite is not active"})
        except IndexError:
            return JsonResponse({"status": "error", "data": "Invalid Invite Code"})
    else:
        try:
            class_ = invite[0].Class
            if class_ in request.user.class_student.all():
                return JsonResponse({"status": "error", "data": "You are already enrolled in this class"})
            else:
                invite_ = invite[0]
                if invite_.active == True:
                    class_.students.add(request.user)
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
                    return JsonResponse({"status": "error", "data": "No Class provided"})
                
                try:
                    if len(invitecode) > 8:
                        return JsonResponse({"status": "error", "data": "Invite code too long"})
                    else:
                        class1 = Class.objects.filter(id=class_)[0]

                        invite = Invite(Class=class1, code=invitecode, uses=0, active=True)
                        invite.save()

                        return JsonResponse({"status": "success", "data": invite.id})
                except IndexError:
                    return JsonResponse({"status": "error", "data": "Class does not exist"})
