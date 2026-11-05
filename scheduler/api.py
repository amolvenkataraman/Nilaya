from django.http import HttpResponseBadRequest, JsonResponse
from django.db import transaction
from django.db.models import Count, Q
from django.db.models.functions import ExtractDay
from django.utils import timezone
from scheduler.models import *
from scheduler.sync import *
from scheduler.inject import *
from scheduler import service as svc
from scheduler import recurrence as rec

from django.conf import settings as _settings
CALENDAR_VARS, ONLINE_MODE, TIME_ZONE = _settings.CALENDAR_VARS, _settings.ONLINE_MODE, _settings.TIME_ZONE
from Comptech.utils import *
from photos.models import *
from notifications.service import notify, Priority

import datetime
import json
import pytz
import bleach

overlapping = svc.overlapping  # Events overlapping [start, end); assignments (no end) count at their start.

def month_bounds(year, month):
    tz = pytz.timezone(TIME_ZONE)
    return (tz.localize(datetime.datetime(year, month, 1)),
            tz.localize(datetime.datetime(year + month // 12, month % 12 + 1, 1)))

def can_edit_calendar(user, calendar):
    """True if the user owns the calendar (Calendar.owner) or is one of its admins."""
    return calendar.can_edit(user)

def _event_dicts(events, subs, user):
    """Legacy event dicts; subs: {calendar_id: Subscriber} for colours and private masking."""
    out = []
    for e in events:
        s = subs.get(e.calendar_id)
        r = s.role if s is not None else ("owner" if user.is_authenticated and e.calendar.owner_id == user.id else None)
        out.append(e.getinfo(sub_colour=s.colour if s else None, masked=svc.masked_for(e, user, r or "subscriber")))
    return out

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

    calendars = user_.calendar_subscribed.select_related('calendar')
    if request.GET.get("show_all") != "1":
        calendars = calendars.filter(calendar__active=True)
    shown = calendars if request.GET.get("show_invisible") == "1" else calendars.filter(visible=True)

    seen = set()  # duplicate subscriber rows (old data) list the calendar once
    ans["data"]["calendars"] = [i.getinfo(cal=True) for i in calendars.order_by('calendar__name', 'subscribe_type', 'id')
                                if not (i.calendar_id in seen or seen.add(i.calendar_id))]
    ans["data"]["birthdays"] = [i.getinfo_zip() for i in user_.friends.filter(birthday__month=month)]
    if user_.birthday and user_.birthday.month == month:
        ans["data"]["birthdays"].append(user_.getinfo_zip())

    shown = {s.calendar_id: s for s in shown}
    ans["data"]["events"] = _event_dicts(svc.events_in_range(list(shown), month_start, month_end), shown, user_)

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
            if calendar.owner_id != request.user.id:
                return error_response("You do not own this calendar", 401)
        except (IndexError, KeyError, ValueError):
            return error_response("Calendar does not exist")

        try: token = req['token']
        except KeyError:
            token = None

        tzoffset = datetime.datetime.now(pytz.timezone(timezone.get_current_timezone_name())).strftime('%z')
        start_time = f"{req['sy']}-{req['sm']}-01T00:00:00{tzoffset}"
        end_time = f"{req['ey']}-{req['em']}-01T00:00:00{tzoffset}"

        if calendar.calendar_type not in (1, 2, 50):
            return error_response("Calendar is a local calendar")
        status = sync_calendar(calendar, start_time, end_time, token, conditional=False)  # records the outcome

        if status == "busy": return error_response("This calendar is already syncing", 409)
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
    # Free (transparent) and cancelled events never block; deadlines have no length.
    evs = svc.events_in_range(some + every, day, day + datetime.timedelta(days=1), related=("calendar",), extra=(
        Q(transparency="busy", enddate__isnull=False)
        & (Q(calendar__in=every) | Q(calendar__in=some, category__in=busy_categories))))
    return success_response({"busy": [[e.startdate, e.enddate] for e in evs]})

def get_calendar_events(request):
    """Events of one calendar for a day (?timespan=day&time=YYYY-MM-DD) or a month
    (?timespan=month&time=YYYY-MM). Public calendars: anyone; otherwise subscribers."""
    c = Calendar.objects.filter(id=request.GET.get("calendar") or 0).first()
    if c is None:
        return error_response("Calendar does not exist", 404)
    sub = c.users_subscribed.filter(user=request.user).first() if request.user.is_authenticated else None
    if not (c.public or sub is not None):
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
    events = svc.events_in_range([c.id], start, end)
    return JsonResponse({"events": _event_dicts(events, {c.id: sub} if sub else {}, request.user)})

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
        editor = c_.role_of(request.user, sub) in ("owner", "admin")
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
            icon = svc.clean_icon(b.get('icon')) or ''
            with transaction.atomic():
                c = Calendar.objects.create(name=bleach.clean(b['name']), colour=b['color'], owner=request.user, icon=icon)
                Subscriber.objects.create(user=request.user, calendar=c, subscribe_type=0, colour=b['color'])
            return success_response()
        except (ValueError, KeyError, TypeError):
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
    except (IndexError, KeyError, ValueError, TypeError):
        return error_response("Calendar does not exist")

    if not can_edit_calendar(request.user, reqcal):
        return error_response("Not authorized", 401)

    try:
        if req["name"] == "": req["name"] = "Unnamed"

        if req['command'] == 'add':
            e = Event(created_by=request.user)
        elif req['command'] == 'edit':
            series, original = svc.resolve(req.get('old_id'))
            if series is None:
                return error_response("Event does not exist", 401)
            # Must also be able to edit the calendar the event currently lives in
            if not can_edit_calendar(request.user, series.calendar):
                return error_response("Not authorized", 401)
            if original is not None:  # one occurrence of a series: edit just that one
                try:
                    e = svc.make_override(series, original)
                except LookupError:
                    return error_response("Event does not exist", 401)
                reqcal = series.calendar  # an occurrence stays in its series' calendar
            else:
                e = series
        else:
            return error_response("Invalid command")

        owner_changed = e.calendar_id is not None and e.calendar_id != reqcal.id and e.calendar.owner_id != reqcal.owner_id
        e.calendar = reqcal
        legacy_cat = int(req["category"])
        if e._state.adding or owner_changed or legacy_cat != e.category or e.event_category_id is None:
            e.set_category(EventCategory.for_legacy(reqcal.owner_id, legacy_cat))
            e.category = legacy_cat
        e.name = bleach.clean(req["name"])
        e.description = bleach.clean(req["description"])
        e.public = req["public"]
        e.priority = req["priority"]

        if "location" in req:
            e.location = bleach.clean(req["location"]) if req["location"] else req["location"]
        # Newer optional keys (the old UI never sends them)
        if req.get("status") in ("confirmed", "tentative", "cancelled"): e.status = req["status"]
        if req.get("transparency") in ("busy", "free"): e.transparency = req["transparency"]
        if req.get("visibility") in ("default", "public", "private"): e.visibility = req["visibility"]
        if "tags" in req: e.tags = svc.clean_tags(req["tags"])
        if "colour" in req: e.colour = svc.clean_colour(req["colour"])
        if "icon" in req: e.icon = svc.clean_icon(req["icon"])
        if "meeting_url" in req: e.meeting_url = svc.clean_url(req["meeting_url"])
        if "rrule" in req and not e.recurrence_parent_id:
            e.rrule = rec.normalize_rrule(req["rrule"], reqcal.tz)

        if req['type'] == "ade":
            e.startdate = req["start"]
            e.enddate = req["end"]
            e.allday = True
            e.kind = "all_day"
            e.start_date = e.end_date = None  # recomputed from the datetimes the old UI sends
        elif req['type'] == "assignment":
            e.startdate = req["start"]
            e.enddate = None
            e.allday = False
            e.kind = "deadline"
        elif req['type'] == "event":
            e.startdate = req["start"]
            e.enddate = req["end"]
            e.allday = False
            e.kind = "event"

        e.save()

        return success_response()

    except ValueError as ex:
        return error_response(str(ex) or "Invalid value")
    except Exception as ex:
        return server_error(ex)

@post_request_only
@login_required_api
def duplicate_event(request):
    try: req = json.loads(request.body)
    except:
        return error_response("Malformed JSON. Can not decode.")

    try:
        series, original = svc.resolve(req.get("id"))
        if series is None:
            return error_response("Event does not exist", 401)
        if not can_edit_calendar(request.user, series.calendar):
            return error_response("Not authorized", 401)
        src = svc.occurrence_view(series, original) if original is not None else series
        if src is None:
            return error_response("Event does not exist", 401)
        days = datetime.timedelta(days=int(req["days"]))
        # A copy of one occurrence is a plain event; a copy of a series is a series.
        e = svc._clone(src, startdate=src.startdate + days, enddate=src.enddate + days if src.enddate else None,
                       start_date=src.start_date + days if src.start_date else None,
                       end_date=src.end_date + days if src.end_date else None,
                       rrule="" if original is not None else series.rrule, created_by=request.user)
        e.calendar = series.calendar
        e.save()
        return success_response()

    except (KeyError, ValueError, TypeError):
        return error_response("Invalid request")
    except Exception as ex:
        return server_error(ex)

@post_request_only
@login_required_api
def delete_event(request):
    series, original = svc.resolve(request.body.decode("utf-8").strip())
    if series is None:
        return error_response("Invalid Event")
    if not can_edit_calendar(request.user, series.calendar):
        return error_response("Not authorized", 401)
    try:
        if original is not None:
            svc.cancel_occurrence(series, original)  # just this occurrence
        else:
            series.delete()
        return success_response()
    except Exception as ex:
        return server_error(ex)

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
    POST: subscribe to it (with the invite's role; expiry and max uses are enforced)."""
    invite = None
    if request.GET.get('calendar'):
        calendar_ = Calendar.objects.filter(id=request.GET['calendar'], public=True).first()
        if calendar_ is None:
            return error_response("Calendar is not public")
    else:
        invite = Invite.objects.filter(code=request.GET.get('code') or "").select_related('calendar__owner').first()
        if invite is None:
            return error_response("Invalid invite code")
        problem = invite.problem()
        if problem:
            return error_response(problem)
        calendar_ = invite.calendar
    if request.user.calendar_subscribed.filter(calendar=calendar_).exists():
        return error_response("You are already subscribed to this calendar")

    if request.method == 'GET':
        owner = calendar_.owner
        return success_response({**calendar_.getinfo(), "owner": {
            "id": owner.id, "first_name": owner.first_name, "last_name": owner.last_name},
            "role": "admin" if invite is not None and invite.role == 1 else "subscriber"})

    if invite is not None:
        _, err = svc.join(request.user, invite)
        if err:
            return error_response(err)
    else:
        Subscriber.objects.create(calendar=calendar_, user=request.user, colour=calendar_.colour)
    if calendar_.owner_id != request.user.id:
        notify(calendar_.owner, f"{request.user.get_full_name() or request.user.username} subscribed to {calendar_.name}",
               "Manage subscribers in the calendar's settings.", source="Calendar", url="/calendar/")
    return success_response("Success")

@post_request_only
@login_required_api
def unsubscribe(request):
    sub = request.user.calendar_subscribed.select_related('calendar').filter(calendar_id=request.GET.get("calendar")).first()
    if sub is None:
        return error_response("Not subscribed to this calendar")
    if sub.calendar.owner_id == request.user.id:
        return error_response("Owners can't unsubscribe from their own calendar")
    sub.delete()
    return success_response()

def _invite_limits(get, invite, is_owner):
    """Optional ?expires_on=ISO|"" &max_uses=n|"" &role=admin|subscriber for invite create."""
    if "expires_on" in get:
        invite.expires_on = rec.parse_moment(get["expires_on"]) if get["expires_on"] else None
    if "max_uses" in get:
        invite.max_uses = int(get["max_uses"]) if get["max_uses"] else None
        if invite.max_uses is not None and invite.max_uses < 1:
            raise ValueError("max_uses must be at least 1")
    if "role" in get:
        if get["role"] not in ("admin", "subscriber"):
            raise ValueError("role must be admin or subscriber")
        if get["role"] == "admin" and not is_owner:
            raise PermissionError
        invite.role = 1 if get["role"] == "admin" else 2

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
        if invite.role == 1 and invite.calendar.owner_id != request.user.id:  # admin invites: the owner's (as in V2)
            return error_response("Only the owner can change admin invites", 401)
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
        invite = Invite(code=code[:8], active=True, calendar=calendar)
        try:
            _invite_limits(request.GET, invite, calendar.owner_id == request.user.id)
        except PermissionError:
            return error_response("Only the owner can create admin invites", 401)
        except ValueError as ex:
            return error_response(str(ex))
        invite.save()
        return success_response(invite.getinfo())

    return error_response("Unknown option")


def get_block_status(request):
    username = request.GET.get("user")
    if username == None: return error_response("No username provided")
    try:
        user = ComptechUser.objects.filter(username=username)[0]
        calendars = list(user.calendar_subscribed.filter(calendar__active=True).values_list("calendar_id", flat=True))
        now = timezone.now()
        evs = svc.events_in_range(calendars, now, now + datetime.timedelta(seconds=1), related=("calendar",),
                                  extra=Q(transparency="busy", enddate__isnull=False))
        return JsonResponse({"status": "success", "data": [i.category for i in evs if i.startdate <= now]})
    except IndexError: return error_response("User does not exist")
