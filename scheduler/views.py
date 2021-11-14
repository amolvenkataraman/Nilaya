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
    calendars = user_.calendar_subscribed.all()

    if request.GET.get("show_all") == "0":
        calendars = user_.calendar_subscribed.filter(calendar__active=True)
    else:
        calendars = user_.calendar_subscribed.all()

    calendars1 = [i.calendar for i in calendars.filter(visible=True)]

    ans["data"]["calendars"] = [i.getinfo() for i in calendars.order_by('calendar__name')]
    ans["data"]["birthdays"] = [i.getinfo_zip() for i in user_.friends.filter(birthday__month=int(month))]
    ans["data"]["events"] = [i.getinfo() for i in Event.objects.filter(
        Q(calendar__in=list(calendars1)) &
        ((Q(startdate__month=int(month)) & Q(startdate__year=(int(year)))) |
        (Q(enddate__month=int(month)) & Q(enddate__year=(int(year)))) |
        Q(Q(startdate__month__lt=int(month), enddate__month__gt=int(month)) & (Q(startdate__year=int(year), enddate__year=int(year)))))
    ).order_by('startdate', 'name').iterator()]

    return JsonResponse(ans)

def get_todos(request):
    if not request.user.is_authenticated:
        return HttpResponseForbidden("Not logged in")

    ans = {"data": {}}
    user_ = request.user
    ans["data"]["todos"] = [i.getinfo() for i in reversed(Todo.objects.filter(user=user_, completed=False))]
    return JsonResponse(ans)

def sync_events(request):
    if request.method == 'POST':
        if ONLINE_MODE:
            if request.user.is_authenticated:
                try:
                    req = json.loads(request.body)
                except:
                    return JsonResponse({"status": "error", "data": "Malformed JSON. Can not decode."}, status=400)

                try:
                    calendar = Calendar.objects.filter(id=req["calendar"])[0]
                    if calendar.owner != request.user:
                        return JsonResponse({"status": "error", "data": "You do not own this calendar"}, status=401)
                except IndexError:
                    return JsonResponse({"status": "error", "data": "Calendar does not exist"}, status=400)

                try: token = req['token']
                except KeyError:
                    token = None

                if calendar.calendar_type == 1: # ICalendar:
                    r = requests.get(calendar.calendar_url)
                    cal = Cal(r.text)
                    for i in cal.events:
                        try:
                            if i.status != None and i.status.lower() == "cancelled":
                                try:
                                    e = Event.objects.filter(sync_id=i.uid)[0]
                                    e.delete()
                                except IndexError: pass
                            else:
                                try:
                                    e = Event.objects.filter(sync_id=i.uid)[0]
                                except IndexError:
                                    e = Event()

                                e.name = i.name
                                e.calendar = calendar
                                e.description = i.description
                                e.sync_id = i.uid
                                e.startdate = str(i.begin)
                                e.enddate = str(i.end)
                                e.save()

                        except Exception as ex:
                            print(f"A(n) {type(ex).__name__} occurred. {ex.args}")

                    return JsonResponse({"status": "success", "data": "OK"})

                elif calendar.calendar_type == 2: # Public Google Calendar
                    tzoffset = datetime.datetime.now(pytz.timezone(timezone.get_current_timezone_name())).strftime('%z')

                    start_time = f"{req['sy']}-{req['sm']}-01T00:00:00{tzoffset}"
                    end_time = f"{req['ey']}-{req['em']}-01T00:00:00{tzoffset}"
                    fields = str("items(kind,summary,start,end)")

                    r = requests.get(f"https://www.googleapis.com/calendar/v3/calendars/{calendar.calendar_url}/events?key={GOOGLE_API_KEY}&timeMin={start_time}&timeMax={end_time}&singleEvents=true&orderBy=startTime&showDeleted=true", headers= {'Authorization': f'Bearer {token}'} if token != None else None)
                    res = r.json()

                    for i in res["items"]:
                        try:
                            e_ = Event.objects.filter(sync_id=i['id'])
                            if i['status'] == 'confirmed':
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
                            else:
                                e_.delete()

                        except Exception as ex:
                            print(f"A(n) {type(ex).__name__} occurred. {ex.args}")

                    return JsonResponse({"status": "success", "data": "OK"})
                else:
                    return JsonResponse({"status": "error", "data": "Calendar is a local calendar"}, status=400)
            else:
                return JsonResponse({"status": "error", "data": "Not logged in"}, status=401)
        else:
            return JsonResponse({"status": "error", "data": "Server is in offline mode"}, status=400)

def clone_event(event_id, n):
    e = Event.objects.filter(id=event_id)[0]
    e.pk = None
    e.startdate = e.startdate + datetime.timedelta(days=n)
    e.enddate = e.enddate + datetime.timedelta(days=n)
    e.save()

def countdown(request, event_id, time="start"):
    try:
        event_ = Event.objects.filter(id=event_id)[0]
        if event_.public == False:
            try:
                if event_.calendar.users_subscribed.filter(user=request.user)[0].subscribe_type not in [0, 1]:
                    return JsonResponse({"status": "error", "data": "Not authorized"}, status=401)
            except IndexError:
                return JsonResponse({"status": "error", "data": "Not authorized"}, status=401)
            
        name = event_.name
        if time == "start":
            event_time = event_.startdate
        elif time == "end":
            event_time = event_.enddate
        else:
            raise Http404()

        if event_time == None:
            raise Http404()

        if event_.enddate == None: time = "none"
    
        return render(request, 'scheduler/countdown.html', {"event": event_.getinfo(), "time": event_time.strftime("%b %d %Y %H:%M:%S %z"), "se": time})
    except IndexError:
        raise Http404()

def get_recent(user_):
    ans = {"data": {}}

    calendars = [i.calendar for i in user_.calendar_subscribed.filter(calendar__active=True, visible=True)]
    ans["data"]["events"] = [i.getinfo() for i in Event.objects.filter(calendar__in=calendars, startdate__gte=timezone.now(), startdate__lte=timezone.now() + datetime.timedelta(days=7)).order_by('startdate')[:5]]
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
                if len(c_.users_subscribed.filter(user=request.user)) > 0:
                    return JsonResponse(c_.getinfo_full())
                else:
                    return JsonResponse({"status": "error", "data": "Not authorized"}, status=401)
            except IndexError:
                return HttpResponseBadRequest("Invalid Calendar")
        else:
            return JsonResponse({"status": "error", "data": "Not logged in"}, status=401)

    elif request.method == 'POST':
        if request.user.is_authenticated:
            b = json.loads(request.body.decode('utf8'))
            try:
                c = Calendar(name=b['name'], colour=b['color'])
                c.owner = request.user
                c.save()
                s = Subscriber(user=request.user, calendar=c)
                s.save()
            except IntegrityError:
                return JsonResponse({"status": "error", "data": "Calendar name must be unique"}, status=400)
        else:
            return JsonResponse({"status": "error", "data": "Not logged in"}, status=401)

        return JsonResponse({"status": "success", "data": "OK"})

def toggle_visibility(request):
    if request.user.is_authenticated:
        calendar = request.GET.get("calendar")
        if calendar == None:
            return HttpResponseBadRequest("Calendar ID not provided")
        try:
            c_ = Calendar.objects.filter(id=calendar)[0]
            qs = c_.users_subscribed.filter(user=request.user)
            if len(qs) > 0:
                qs[0].visible = not qs[0].visible
                qs[0].save()
                return JsonResponse({"status": "success", "data": "OK"})
            else:
                return JsonResponse({"status": "error", "data": "Not authorized"}, status=401)
        except IndexError:
            return HttpResponseBadRequest("Invalid Calendar")
    else:
        return JsonResponse({"status": "error", "data": "Not logged in"}, status=401)

def create_edit_event(request):
    if request.method == 'POST':
        if request.user.is_authenticated:
            try:
                req = json.loads(request.body)
            except:
                return JsonResponse({"status": "error", "data": "Malformed JSON. Can not decode."}, status=400)

            try:
                reqcal = Calendar.objects.filter(id=req["calendar"])[0]
            except IndexError:
                return JsonResponse({"status": "error", "data": "Calendar does not exist"}, status=400)

            try:
                if req["name"] == "":
                    return JsonResponse({"status": "error", "data": "Name can not be empty"}, status=400)
                else:
                    if req['command'] == 'add':
                        e = Event()
                    elif req['command'] == 'edit':
                        try:
                            e = Event.objects.filter(id=req['old_id'])[0]
                        except IndexError:
                            return JsonResponse({"status": "error", "data": "Event does not exist"}, status=401)
                        try:
                            if reqcal.users_subscribed.filter(user=request.user)[0].subscribe_type not in [0, 1]:
                                return JsonResponse({"status": "error", "data": "Not authorized"}, status=401)
                        except IndexError:
                            return JsonResponse({"status": "error", "data": "Not authorized"}, status=401)

                    e.calendar = reqcal
                    e.name = req["name"]
                    e.description = req["description"]
                    e.public = req["public"] == 'true'
                    e.priority = req["priority"]

                    if req['type'] == "ade":
                        e.startdate = req["start"]
                        e.enddate = req["end"]
                        e.allday = True
                    elif req['type'] == "assignment":
                        e.startdate = req["start"]
                    elif req['type'] == "event":
                        e.startdate = req["start"]
                        e.enddate = req["end"]

                    e.save()

                    return JsonResponse({"status": "success", "data": "OK"})

            except Exception as ex:
                return JsonResponse({"status": "error", "data": f"A(n) {type(ex).__name__} occurred. {ex.args}"}, status=500)
        else:
            return JsonResponse({"status": "error", "data": "Not logged in"}, status=401)

def delete_event(request):
    if request.method == 'POST':
        if request.user.is_authenticated:
            evs = Event.objects.filter(id=request.body.decode("utf-8"))
            try:
                ev = evs[0]
                try:
                    if ev.calendar.users_subscribed.filter(user=request.user)[0].subscribe_type not in [0, 1]:
                        return JsonResponse({"status": "error", "data": "Not authorized"}, status=401)
                except IndexError:
                    return JsonResponse({"status": "error", "data": "Not authorized"}, status=401)
                try:
                    ev.delete()
                    return JsonResponse({"status": "success", "data": "OK"})
                except Exception as ex:
                    return JsonResponse({"status": "error", "data": f"A(n) {type(ex).__name__} occurred. {ex.args}"}, status=500)

            except IndexError:
                return JsonResponse({"status": "error", "data": "Invalid Event"}, status=400)
        else:
            return JsonResponse({"status": "error", "data": "Not logged in"}, status=401)

        return JsonResponse({"status": "success", "data": "OK"}, status=200)

def todo(request, command):
    if request.method == "POST":
        if request.user.is_authenticated:
            try:
                req = json.loads(request.body)
            except:
                return JsonResponse({"status": "error", "data": "Malformed JSON. Can not decode."}, status=400)

            try:
                if command in ["create", "edit"]:
                    t = Todo()
                    t.name = req['name']
                    t.description = req['description']
                    t.user = request.user
                    t.priority = req['priority']
                    t.completiondate = req['completion']

                    t.save()
                    return JsonResponse({"status": "success", "data": "OK"})

                elif command == "delete":
                    try:
                        t = Todo.objects.filter(id=req['id'])[0]
                    except IndexError:
                        return JsonResponse({"status": "error", "data": "Todo does not exist"}, status=400)
                    if t.user == request.user:
                        t.delete()
                        return JsonResponse({"status": "success", "data": "OK"})
                    else:
                        return JsonResponse({"status": "error", "data": "Not authorized"}, status=401)

                elif command == "complete":
                    try:
                        t = Todo.objects.filter(id=req['id'])[0]
                    except IndexError:
                        return JsonResponse({"status": "error", "data": "Todo does not exist"}, status=400)
                    if t.user == request.user:
                        if req['completion'] == 'True': t.completed = True
                        elif req['completion'] == 'False': t.completed = False
                        t.save()
                        return JsonResponse({"status": "success", "data": "OK"})
                    else:
                        return JsonResponse({"status": "error", "data": "Not Authorized"}, status=401)
            except Exception as ex:
                return JsonResponse({"status": "error", "data": f"A(n) {type(ex).__name__} occurred. {ex.args}"}, status=500)
        else:
            return JsonResponse({"status": "error", "data": "Not logged in"}, status=401)

@login_required
def subscribe(request):
    invitecode = request.GET.get("code")
    if invitecode == None:
        return JsonResponse({"status": "error", "data": "No Invite Code provided"})
    invite = Invite.objects.filter(code=invitecode)
    if request.method == 'GET':
        try:
            calendar_ = invite[0].calendar
            if calendar_ in request.user.calendar_subscribed.all():
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
            if calendar_ in request.user.calendar_subscribed.all():
                return JsonResponse({"status": "error", "data": "You are already subscribed to this calendar"})
            else:
                invite_ = invite[0]
                if invite_.active == True:
                    calendar_.subscribers.add(request.user)
                    s = Subscriber(calendar=calendar_, user=request.user)
                    s.save()
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
    if invitecode == None: return JsonResponse({"status": "error", "data": "No Invite Code provided"})
    if option == None: return JsonResponse({"status": "error", "data": "No Choice provided"})

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
                try:
                    if Subscriber.objects.filter(calendar=invite.calendar, user=request.user)[0].subscribe_type not in [0, 1]:
                        return JsonResponse({"status": "error", "data": "Not authorized"}, status=401)
                except IndexError:
                    return JsonResponse({"status": "error", "data": "Not authorized"}, status=401)
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


def get_block_status(request):
    username = request.GET.get("user")
    if username == None:
        return JsonResponse({"status": "error", "data": "No username provided"}, status=400)
    try:
        user = ComptechUser.objects.filter(username=username)[0]
        calendars = [i.calendar for i in user.calendar_subscribed.filter(calendar__active=True, visible=True)]
        return JsonResponse({"status": "success", "data": [i.category for i in Event.objects.filter(calendar__in=calendars, startdate__lte=timezone.now(), enddate__gte=timezone.now())]})
    except IndexError:
        return JsonResponse({"status": "error", "data": "User does not exist"}, status=400)
