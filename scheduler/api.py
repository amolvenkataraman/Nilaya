from django.http import HttpResponseBadRequest, JsonResponse
from django.db.models import Count, Q
from django.db.models.functions import ExtractDay
from django.utils import timezone
from scheduler.models import *
from scheduler.sync import *
from scheduler.inject import *

from django.conf import settings as _settings
CALENDAR_VARS, ONLINE_MODE, TIME_ZONE = _settings.CALENDAR_VARS, _settings.ONLINE_MODE, _settings.TIME_ZONE
from Comptech.utils import *
from photos.models import *
from notifications.service import notify, Priority

import datetime
import json
import pytz
import bleach

def overlapping(start, end):
    """Events overlapping [start, end); assignments (no end) count at their start."""
    return Q(startdate__lt=end) & (Q(enddate__gt=start) | Q(enddate__isnull=True, startdate__gte=start))

def month_bounds(year, month):
    tz = pytz.timezone(TIME_ZONE)
    return (tz.localize(datetime.datetime(year, month, 1)),
            tz.localize(datetime.datetime(year + month // 12, month % 12 + 1, 1)))

def can_edit_calendar(user, calendar):
    """True if the user is the owner (0) or an editor (1) of the calendar."""
    return calendar.users_subscribed.filter(user=user, subscribe_type__in=[0, 1]).exists()

@login_required_api
def get_events(request):
    try:
        month, year = int(request.GET["month"]), int(request.GET["year"])
        month_start, month_end = month_bounds(year, month)
        tz = pytz.timezone(TIME_ZONE)
    except (KeyError, ValueError):
        return error_response("Valid month and year required")

    ans = {"data": {}}
    user_ = request.user
    albums = [i.album for i in user_.album_subscribed.all()]

    calendars = user_.calendar_subscribed.all()
    if request.GET.get("show_all") != "1":
        calendars = calendars.filter(calendar__active=True)
    shown = calendars if request.GET.get("show_invisible") == "1" else calendars.filter(visible=True)

    ans["data"]["calendars"] = [i.getinfo(cal=True) for i in calendars.order_by('calendar__name')]
    ans["data"]["birthdays"] = [i.getinfo_zip() for i in user_.friends.filter(birthday__month=month)]
    if user_.birthday and user_.birthday.month == month:
        ans["data"]["birthdays"].append(user_.getinfo_zip())

    ans["data"]["events"] = [i.getinfo() for i in Event.objects.filter(
        overlapping(month_start, month_end), calendar__in=[s.calendar_id for s in shown]
    ).order_by('startdate', '-enddate', 'name').iterator()]

    # Open todos, plus the ones completed this month.
    ans["data"]["todos"] = [i.getinfo() for i in Todo.objects.filter(
        Q(user=user_) & (Q(completed=False) | Q(completed_on__gte=month_start, completed_on__lt=month_end))
    ).order_by('complete_by')]

    # Photos per local day, counted in the database (not by loading every photo).
    per_day = (Photo.objects.filter(album__in=albums, hidden=False, date_taken__gte=month_start, date_taken__lt=month_end)
               .annotate(day=ExtractDay('date_taken', tzinfo=tz)).values('day').annotate(n=Count('id')))
    ans["data"]["photos"] = {row['day']: row['n'] for row in per_day}

    # TEMPORARY - For experiments
    # To remove later
    ext = request.GET.get("extra")
    if ext:
        inj = [i.rstrip().lstrip() for i in ext.split(",")]
        for i in inj:
            try:
                o, v = i.split(":")
                if o == "UW" or o == "uw":
                    cc = v.split(" ")
                    cals, evs = inject_uw_courses(month, year, request.user.id, cc[0], cc[1])
                    for i in cals: ans["data"]["calendars"].append(i)
                    for i in evs: ans["data"]["events"].append(i)
            except: pass

    return JsonResponse(ans)

@post_request_only
@login_required_api
def sync_events(request):
    if ONLINE_MODE:
        try: req = json.loads(request.body)
        except: return error_response("Malformed JSON. Can not decode.")

        try:
            calendar = Calendar.objects.filter(id=req["calendar"])[0]
            if calendar.owner != request.user:
                return error_response("You do not own this calendar", 401)
        except IndexError:
            return error_response("Calendar does not exist")

        try: token = req['token']
        except KeyError:
            token = None

        tzoffset = datetime.datetime.now(pytz.timezone(timezone.get_current_timezone_name())).strftime('%z')
        start_time = f"{req['sy']}-{req['sm']}-01T00:00:00{tzoffset}"
        end_time = f"{req['ey']}-{req['em']}-01T00:00:00{tzoffset}"

        if calendar.calendar_type == 1: # ICalendar:
            status = sync_ical(calendar, start_time, end_time) ## ACTUAL SYNC

        elif calendar.calendar_type == 2: # Public Google Calendar
            status = sync_google(calendar, start_time, end_time, token) ## ACTUAL SYNC

        elif calendar.calendar_type == 50: # UWaterloo WCMS
            status = sync_uwaterloo(calendar, start_time, end_time)

        else: return error_response("Calendar is a local calendar")

        if status: return success_response()
        return error_response("Calendar sync failed", 502)

    else: return error_response("Server is in offline mode")


def get_availability(request, username):
    """Busy blocks for one day, only from calendars the user chose to expose (display_busy)."""
    try:
        day = pytz.timezone(TIME_ZONE).localize(datetime.datetime.strptime(request.GET["date"], '%Y-%m-%d'))
    except (KeyError, ValueError):
        return error_response("Valid date (YYYY-MM-DD) required")
    user = ComptechUser.objects.filter(username=username).first()
    if user is None:
        return error_response("User does not exist", 404)

    subs = Subscriber.objects.filter(user=user, calendar__active=True, display_busy__in=[1, 2])
    some = [s.calendar_id for s in subs if s.display_busy == 1]  # only "busy" categories
    every = [s.calendar_id for s in subs if s.display_busy == 2]  # every event
    busy_categories = [1, 2, 4, 5, 6, 7, 9]
    evs = Event.objects.filter(
        Q(startdate__lt=day + datetime.timedelta(days=1), enddate__gt=day),  # overlaps the day
        Q(calendar__in=every) | Q(calendar__in=some, category__in=busy_categories),
    ).order_by('startdate')
    return success_response({"busy": [[e.startdate, e.enddate] for e in evs]})

def get_calendar_events(request):
    """Events of one calendar for a day (?timespan=day&time=YYYY-MM-DD) or a month
    (?timespan=month&time=YYYY-MM). Public calendars: anyone; otherwise subscribers."""
    c = Calendar.objects.filter(id=request.GET.get("calendar") or 0).first()
    if c is None:
        return error_response("Calendar does not exist", 404)
    if not (c.public or (request.user.is_authenticated and c.users_subscribed.filter(user=request.user).exists())):
        return error_response("Not authorized", 401)
    try:
        parts = [int(x) for x in (request.GET.get("time") or "").split("-")]
        if request.GET.get("timespan") == "day" and len(parts) == 3:
            start = pytz.timezone(TIME_ZONE).localize(datetime.datetime(*parts))
            end = start + datetime.timedelta(days=1)
        elif request.GET.get("timespan") == "month" and len(parts) == 2:
            start, end = month_bounds(parts[0], parts[1])
        else:
            raise ValueError
    except ValueError:
        return error_response("Malformed time")
    events = Event.objects.filter(overlapping(start, end), calendar=c).order_by('startdate', '-enddate', 'name')
    return JsonResponse({"events": [i.getinfo() for i in events]})

@login_required_api
def calendar(request):
    """GET ?id=: calendar info (subscribers + invites for owners/admins only).
    POST ?id=&command=active: toggle active (owners/admins). POST (JSON body): create."""
    cid = request.GET.get("id")
    if cid is not None:
        c_ = Calendar.objects.filter(id=cid).first()
        sub = c_.users_subscribed.filter(user=request.user).first() if c_ else None
        if sub is None:
            return error_response("Not authorized", 401)
        editor = sub.subscribe_type in (0, 1)
        if request.method == 'GET':
            return JsonResponse({**c_.getinfo(), **c_.get_subs(editor=editor)})
        if request.GET.get("command") == "active":
            if not editor:
                return error_response("Not authorized", 401)
            c_.active = not c_.active
            c_.save(update_fields=["active"])
            return success_response()
        return error_response("Unknown command")

    if request.method == 'POST':
        try:
            b = json.loads(request.body.decode('utf8'))
            c = Calendar.objects.create(name=bleach.clean(b['name']), colour=b['color'], owner=request.user)
            Subscriber.objects.create(user=request.user, calendar=c, subscribe_type=0, colour=b['color'])
            return success_response()
        except (ValueError, KeyError):
            return error_response("Name and colour required")
    return error_response("Calendar ID not provided")

@post_request_only
@login_required_api
def toggle_visibility(request):
    sub = request.user.calendar_subscribed.filter(calendar_id=request.GET.get("calendar") or 0).first()
    if sub is None:
        return error_response("Not subscribed to this calendar")
    sub.visible = not sub.visible
    sub.save(update_fields=["visible"])
    return success_response()

@post_request_only
@login_required_api
def create_edit_event(request):
    try:
        req = json.loads(request.body)
    except:
        return error_response("Malformed JSON. Can not decode.")

    try:
        reqcal = Calendar.objects.filter(id=req["calendar"])[0]
    except IndexError:
        return error_response("Calendar does not exist")

    if not can_edit_calendar(request.user, reqcal):
        return error_response("Not authorized", 401)

    try:
        if req["name"] == "": req["name"] = "Unnamed"

        if req['command'] == 'add': e = Event()
        elif req['command'] == 'edit':
            try:
                e = Event.objects.filter(id=req['old_id'])[0]
            except IndexError:
                return error_response("Event does not exist", 401)
            # Must also be able to edit the calendar the event currently lives in
            if not can_edit_calendar(request.user, e.calendar):
                return error_response("Not authorized", 401)
        else:
            return error_response("Invalid command")

        e.calendar = reqcal
        e.category = req["category"]
        e.name = bleach.clean(req["name"])
        e.description = bleach.clean(req["description"])
        e.public = req["public"]
        e.priority = req["priority"]

        if "location" in req:
            e.location = bleach.clean(req["location"]) if req["location"] else req["location"]

        if req['type'] == "ade":
            e.startdate = req["start"]
            e.enddate = req["end"]
            e.allday = True
        elif req['type'] == "assignment":
            e.startdate = req["start"]
            e.enddate = None
            e.allday = False
        elif req['type'] == "event":
            e.startdate = req["start"]
            e.enddate = req["end"]
            e.allday = False

        e.save()

        return success_response()

    except Exception as ex:
        return server_error(ex)

@post_request_only
@login_required_api
def duplicate_event(request):
    try: req = json.loads(request.body)
    except:
        return error_response("Malformed JSON. Can not decode.")

    try:
        try:
            e = Event.objects.filter(id=req["id"])[0]
            try:
                reqcal = e.calendar
                try:
                    if reqcal.users_subscribed.filter(user=request.user)[0].subscribe_type not in [0, 1]:
                        return error_response("Not authorized", 401)
                except IndexError: return error_response("Not authorized", 401)
            except IndexError: return error_response("Calendar does not exist")

            e.pk = None; e.id = None
            e.save()
            e.startdate = e.startdate + datetime.timedelta(days=int(req["days"]))
            try: e.enddate = e.enddate + datetime.timedelta(days=int(req["days"]))
            except: pass
            e.save()
            return success_response()

        except IndexError: return error_response("Event does not exist", 401)

    except Exception as ex:
        return server_error(ex)

@post_request_only
@login_required_api
def delete_event(request):
        evs = Event.objects.filter(id=request.body.decode("utf-8"))
        try:
            ev = evs[0]
            try:
                if ev.calendar.users_subscribed.filter(user=request.user)[0].subscribe_type not in [0, 1]:
                    return error_response("Not authorized", 401)
            except IndexError:
                return error_response("Not authorized", 401)
            try:
                ev.delete()
                return success_response()
            except Exception as ex:
                return server_error(ex)

        except IndexError:
            return error_response("Invalid Event")

        return success_response()

@post_request_only
@login_required_api
def todo(request, command):
    try:
        req = json.loads(request.body)
    except:
        return error_response("Malformed JSON. Can not decode.")

    try:
        if command in ["add", "edit"]:
            if command == "add": t = Todo()
            elif command == "edit":
                try: t = Todo.objects.filter(id=req["old_id"])[0]
                except IndexError: return error_response("Todo does not exist")
                if t.user != request.user: return error_response("Not authorized", 401)
            if req["name"] == "": req["name"] = "Unnamed"
            t.name = bleach.clean(req['name'])
            t.description = bleach.clean(req['description'])
            t.user = request.user
            t.priority = req['priority']
            if req['completion'] != " ":  t.complete_by = req['completion']
            else: t.complete_by = None
            t.recurring = req['recurring']

            t.save()
            return success_response()


        elif command in ["delete", "complete"]:
            try:
                t = Todo.objects.filter(id=req['id'])[0]
            except IndexError:
                return error_response("Todo does not exist")

            if t.user == request.user:
                if command == "delete":
                    t.delete()
                    return success_response()

                elif command == "complete":
                    t.completed = req['completion']
                    if req['completion']: t.completed_on = timezone.now()
                    t.save()
                    return success_response()

            else: return error_response("Not authorized", 401)

    except Exception as ex:
        return server_error(ex)

@login_required_api
def subscribe(request):
    """GET: preview the calendar behind an invite code (or a public ?calendar=id).
    POST: subscribe to it."""
    invite = None
    if request.GET.get('calendar'):
        calendar_ = Calendar.objects.filter(id=request.GET['calendar'], public=True).first()
        if calendar_ is None:
            return error_response("Calendar is not public")
    else:
        invite = Invite.objects.filter(code=request.GET.get('code') or "").select_related('calendar__owner').first()
        if invite is None:
            return error_response("Invalid invite code")
        if not invite.active:
            return error_response("Invite code is not active")
        calendar_ = invite.calendar
    if request.user.calendar_subscribed.filter(calendar=calendar_).exists():
        return error_response("You are already subscribed to this calendar")

    if request.method == 'GET':
        owner = calendar_.owner
        return success_response({**calendar_.getinfo(), "owner": {
            "id": owner.id, "first_name": owner.first_name, "last_name": owner.last_name}})

    Subscriber.objects.create(calendar=calendar_, user=request.user, colour=calendar_.colour)
    if calendar_.owner_id != request.user.id:
        notify(calendar_.owner, f"{request.user.get_full_name() or request.user.username} subscribed to {calendar_.name}",
               "Manage subscribers in the calendar's settings.", source="Calendar", url="/calendar/")
    if invite is not None:
        invite.uses += 1
        invite.save(update_fields=["uses"])
    return success_response("Success")

@post_request_only
@login_required_api
def unsubscribe(request):
    sub = request.user.calendar_subscribed.filter(calendar_id=request.GET.get("calendar")).first()
    if sub is None:
        return error_response("Not subscribed to this calendar")
    if sub.subscribe_type == 0:
        return error_response("Owners can't unsubscribe from their own calendar")
    sub.delete()
    return success_response()

@post_request_only
@login_required_api
def invite(request):
    option = request.GET.get("option")

    if option == "active":  # toggle an existing invite (by id)
        invite = Invite.objects.filter(id=request.GET.get("invite") or 0).select_related('calendar').first()
        if invite is None:
            return error_response("Invalid invite")
        if not can_edit_calendar(request.user, invite.calendar):
            return error_response("Not authorized", 401)
        invite.active = not invite.active
        invite.save(update_fields=["active"])
        return success_response({"active": invite.active})

    if option == "create":
        code = (request.GET.get("code") or "").strip()
        if not code:
            return error_response("No invite code provided")
        calendar = Calendar.objects.filter(id=request.GET.get("calendar") or 0).first()
        if calendar is None:
            return error_response("Invalid calendar")
        if not can_edit_calendar(request.user, calendar):
            return error_response("Not authorized", 401)
        if Invite.objects.filter(code=code).exists():
            return error_response("That invite code is already in use")
        invite = Invite.objects.create(code=code, active=True, calendar=calendar)
        return success_response(invite.getinfo())

    return error_response("Unknown option")


def get_block_status(request):
    username = request.GET.get("user")
    if username == None: return error_response("No username provided")
    try:
        user = ComptechUser.objects.filter(username=username)[0]
        calendars = [i.calendar for i in user.calendar_subscribed.filter(calendar__active=True)]
        return JsonResponse({"status": "success", "data": [i.category for i in Event.objects.filter(calendar__in=calendars, startdate__lte=timezone.now(), enddate__gte=timezone.now())]})
    except IndexError: return error_response("User does not exist")
