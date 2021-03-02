from django.http import HttpResponse, HttpResponseBadRequest, HttpResponseForbidden, JsonResponse
from django.contrib import messages
from django.shortcuts import redirect, render
from django.contrib.auth.decorators import login_required
from django.db.models import Q
from .models import *
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

    ans = {}

    user_ = request.user
    calendars = user_.calendar_subscribers.all().union(user_.calendar_owner.all())
    #print(calendars)
    return HttpResponse("LOL")
    

@login_required
def get_data(request):
    month = request.GET.get("month")
    if month == None:
        return HttpResponse("Month not provided")
    year = request.GET.get("year")
    if year == None:
        return HttpResponse("Year not provided")

    time = request.GET.get("time")
    context = {"data": {}}
    classes = request.user.class_student.all()
    context["data"]["class"] = [i.getinfo() for i in classes]
    assignments = []
    events = []
    groups = []
    invites = []
    
    if len(classes) > 0:
        for class_ in classes:
            assignments += Assignment.objects.filter(Q(Class=class_) & Q(deadline__month=int(month) + 1) & Q(deadline__year=int(year)))
            events += Event.objects.filter(Q(Class=class_) & ((Q(startdate__month=(int(month) + 1)) & Q(startdate__year=(int(year)))) | (Q(enddate__month=(int(month) + 1)) & Q(enddate__year=(int(year))))))
            groups += Group.objects.filter(classes=class_)
            invites += Invite.objects.filter(Class=class_)
    org_events = Org_Event.objects.filter((Q(startdate__month=(int(month) + 1)) & Q(startdate__year=(int(year)))) | (Q(enddate__month=(int(month) + 1)) & Q(enddate__year=(int(year)))))

    context["data"]["assignments"] = [i.getinfo() for i in assignments]
    context["data"]["events"] = [i.getinfo() for i in events]
    context["data"]["org_events"] = [i.getinfo() for i in org_events]
    context["data"]["days"] = [i.getinfo() for i in Day.objects.all()]
    context["data"]["slots"] = [i.getinfo() for i in Slot.objects.all()]
    context["data"]["periods"] = [i.getinfo() for i in Period.objects.all()]
    context["data"]["groups"] = [i.getinfo() for i in groups]
    context["data"]["invites"] = [i.getinfo() for i in invites]
    return JsonResponse(context)

@login_required
def class_(request):
    if request.user.teacher == True:
        if request.method == 'POST':
            b = json.loads(request.body.decode('utf8'))
            c = Class(name=b['name'])
            c.teacher = request.user
            c.save()
            c.students.add(request.user)

            for i in b['periods']:
                try:
                    c.period.add(Period.objects.filter(
                        day_id=int(i[0]),
                        period_id=int(i[1])
                    )[0])
                except IndexError:
                    print("", end="")
            return JsonResponse({"status": "success", "data": "OK"})
    else:
        return JsonResponse({"status": "error", "data": "Only teachers are allowed to access this.<br>Please contact me if you are a teacher and want administrative access."})

@login_required
def add(request):
    if request.user.teacher == True:
        if request.method == 'POST':
            req = json.loads(request.body)
            if req["type"] == "assignment":
                assignment = Assignment(
                    Class=Class.objects.filter(id=req["class"])[0],
                    name=req["name"],
                    deadline=datetime.datetime.strptime(req["deadline"], '%Y-%m-%d %H:%M'),
                    url=req["url"],
                    description=req["description"],
                    graded=req["graded"],
                    priority=req["priority"],
                )

                assignment.save()
            elif req["type"] == "event":
                event = Event(
                    Class=Class.objects.filter(id=req["class"])[0],
                    name=req["name"],
                    startdate=datetime.datetime.strptime(req["start"], '%Y-%m-%d %H:%M'),
                    enddate=datetime.datetime.strptime(req["end"], '%Y-%m-%d %H:%M'),
                    description=req["description"],
                )

                event.save()
            elif req["type"] == "org_event":
                org_event = Org_Event(
                    name=req["name"],
                    startdate=datetime.datetime.strptime(req["start"], '%Y-%m-%d %H:%M'),
                    enddate=datetime.datetime.strptime(req["end"], '%Y-%m-%d %H:%M'),
                    description=req["description"],
                    holiday=req["holiday"],
                    specialschedule=req["special_schedule"]
                )

                org_event.save()

            return HttpResponse("OK")
    else:
        return HttpResponse('Only teachers are allowed to access this.<br>Please contact me if you are a teacher and want administrative access.')

@login_required
def edit(request):
    if request.user.teacher == True:
        if request.method == 'POST':
            print("lol")
    else:
        return HttpResponse('Only teachers are allowed to access this.<br>Please contact me if you are a teacher and want administrative access.')

@login_required(login_url="users/login")
def delete(request):
    if request.user.teacher == True:
        if request.method == 'POST':
            print("lol")
    else:
        return HttpResponse('Only teachers are allowed to access this.<br>Please contact me if you are a teacher and want administrative access.')

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

@login_required
def settings(request):
    #return HttpResponse("ERROR: Not yet implemented!")
    return render(request, "scheduler/settings.html")

def add_from_gc(request):
    if request.user.is_superuser:
        calendar_id = "example@group.calendar.google.com"
        api_key = "REDACTED_GOOGLE_API_KEY"

        start_time = request.GET["start"]
        end_time = request.GET["end"]

        r = requests.get(f"https://www.googleapis.com/calendar/v3/calendars/{calendar_id}/events?key={api_key}&timeMin={start_time}&timeMax={end_time}")
        res = r.json()
        print(res["summary"])
        for i in res["items"]:
            _ = Org_Event(
                name=i["summary"],
                description=i["summary"],
            )

            try:
                _.startdate=i["start"]["date"]
            except KeyError:
                _.startdate=i["start"]["dateTime"]

            try:
                _.enddate=i["end"]["date"]
            except KeyError:
                _.enddate=i["end"]["dateTime"]

            print(_)
            _.save()

            #print(f"{i['summary']}, from {i['start']} to {i['end']}")

def stats(request):
    context = {
        "users": DocketUser.objects.count(),
        "classes": Class.objects.count(),
        "assignments": Assignment.objects.count(),
    }
    return render(request, 'scheduler/admin.html', context)