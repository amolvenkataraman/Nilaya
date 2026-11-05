"""Automatic reminders, run every minute by beat (tasks.tasks.send_auto_reminders):

- timed calendar events, N minutes before they start         (ReminderSettings.event_minutes)
- calendar deadlines/assignments (events with no end)         (deadline_minutes)
- todos with a due date and no reminders of their own         (todo_minutes)
- an optional morning agenda                                  (daily_agenda, agenda_time)
- optionally copy upcoming calendar deadlines into the Inbox  (deadlines_to_todos)

Each reminder is sent once (SentReminder key per item and occurrence).
"""

import datetime

import pytz
from django.db import IntegrityError
from django.db.models import Count
from django.utils import timezone

from notifications.models import ReminderSettings, SentReminder
from notifications.service import Priority, notify
from scheduler.models import Event, Subscriber, Todo

DEFAULTS = ReminderSettings()  # field defaults, for users who never opened the settings
LOOKAHEAD = datetime.timedelta(days=2)


def _settings(cache, user_id):
    if user_id not in cache:
        cache[user_id] = ReminderSettings.objects.filter(user_id=user_id).first() or DEFAULTS
    return cache[user_id]


def _tz(user):
    return pytz.timezone(user.timezone) if user.timezone in pytz.all_timezones_set else timezone.get_current_timezone()


def _once(user, key):
    try:
        _, created = SentReminder.objects.get_or_create(user=user, key=key[:160])
        return created
    except IntegrityError:
        return False


def _when(dt, user):
    local = timezone.localtime(dt, _tz(user))
    today = timezone.localtime(timezone.now(), _tz(user)).date()
    day = "today" if local.date() == today else ("tomorrow" if local.date() == today + datetime.timedelta(days=1)
                                                 else local.strftime("%a %b %-d"))
    return f"{day} at {local.strftime('%-I:%M %p')}"


def event_reminders(now, cache):
    sent = 0
    events = (Event.objects.filter(startdate__gt=now, startdate__lte=now + LOOKAHEAD, allday=False, calendar__active=True)
              .select_related("calendar"))
    subs = {}
    for s in Subscriber.objects.filter(calendar__in={e.calendar_id for e in events}, visible=True).select_related("user"):
        subs.setdefault(s.calendar_id, []).append(s.user)
    for e in events:
        deadline = e.enddate is None
        for user in subs.get(e.calendar_id, []):
            st = _settings(cache, user.id)
            lead = st.deadline_minutes if deadline else st.event_minutes
            if not lead or e.startdate - datetime.timedelta(minutes=lead) > now:
                continue
            if _once(user, f"ev:{e.id}:{e.startdate.isoformat()}"):
                title = f"Due {_when(e.startdate, user)}: {e.name}" if deadline else f"{e.name} · {_when(e.startdate, user)}"
                body = " · ".join(filter(None, [e.calendar.name, e.location]))
                notify(user, title, body, source="Calendar", url="/calendar/",
                       priority=Priority.HIGH if deadline or e.priority >= 15 else Priority.NORMAL)
                sent += 1
    return sent


def todo_reminders(now, cache):
    sent = 0
    todos = (Todo.objects.filter(completed=False, complete_by__gt=now, complete_by__lte=now + LOOKAHEAD)
             .annotate(n_rem=Count("reminders")).filter(n_rem=0).select_related("user"))
    for t in todos:
        lead = _settings(cache, t.user_id).todo_minutes
        if lead and t.complete_by - datetime.timedelta(minutes=lead) <= now and \
                _once(t.user, f"todo:{t.id}:{t.complete_by.isoformat()}"):
            notify(t.user, f"Due {_when(t.complete_by, t.user)}: {t.name}", source="Tasks", url=f"/tasks/?task={t.id}",
                   priority=Priority.HIGH if t.priority >= 15 else Priority.NORMAL)
            sent += 1
    return sent


def daily_agendas(now):
    sent = 0
    for st in ReminderSettings.objects.filter(daily_agenda=True).select_related("user"):
        user, tz = st.user, _tz(st.user)
        local = timezone.localtime(now, tz)
        start = datetime.datetime.combine(local.date(), st.agenda_time)
        start = tz.localize(start) if hasattr(tz, "localize") else start.replace(tzinfo=tz)
        if not (start <= now < start + datetime.timedelta(hours=3)):
            continue
        if not _once(user, f"agenda:{local.date().isoformat()}"):
            continue
        day_end = start.replace(hour=23, minute=59)
        cals = Subscriber.objects.filter(user=user, visible=True, calendar__active=True).values("calendar_id")
        events = list(Event.objects.filter(calendar_id__in=cals, startdate__gte=start.replace(hour=0, minute=0),
                                           startdate__lte=day_end).order_by("startdate")[:20])
        due = Todo.objects.filter(user=user, completed=False, complete_by__lte=day_end)
        overdue = due.filter(complete_by__lt=now).count()
        lines = [f"{timezone.localtime(e.startdate, tz).strftime('%-I:%M %p') if not e.allday else 'All day'} · {e.name}"
                 for e in events[:6]]
        summary = f"{len(events)} event{'s' * (len(events) != 1)}, {due.count()} todo{'s' * (due.count() != 1)} due"
        if overdue:
            summary += f" ({overdue} overdue)"
        notify(user, f"Today: {summary}", "\n".join(lines) or "Nothing scheduled.", source="Agenda", url="/",
               priority=Priority.NORMAL, expires_in=datetime.timedelta(days=1))
        sent += 1
    return sent


def deadlines_to_todos(now):
    from tasks.service import ensure_inbox
    from tasks.models import Reminder

    made = 0
    for st in ReminderSettings.objects.filter(deadlines_to_todos=True).select_related("user"):
        user = st.user
        cals = Subscriber.objects.filter(user=user, visible=True, calendar__active=True).values("calendar_id")
        for e in Event.objects.filter(calendar_id__in=cals, enddate__isnull=True, allday=False,
                                      startdate__gte=now, startdate__lte=now + datetime.timedelta(days=14)):
            if Todo.objects.filter(user=user, custom_info__event_id=str(e.id)).exists() or not _once(user, f"d2t:{e.id}"):
                continue
            inbox = ensure_inbox(user)
            t = Todo.objects.create(user=user, name=e.name[:256], description=e.description, complete_by=e.startdate,
                                    priority=e.priority, project=inbox, bucket=inbox.buckets.filter(is_done=False).first(),
                                    custom_info={"event_id": str(e.id), "calendar": e.calendar.name})
            Reminder.objects.create(todo=t, relative_to="due", offset=-86400, fire_at=e.startdate - datetime.timedelta(days=1))
            made += 1
    return made


def run(now=None):
    now = now or timezone.now()
    cache = {}
    out = {"events": event_reminders(now, cache), "todos": todo_reminders(now, cache), "agendas": daily_agendas(now)}
    if now.minute % 10 == 0:
        out["deadline_todos"] = deadlines_to_todos(now)
    if now.minute == 0 and now.hour == 4:
        SentReminder.objects.filter(sent_on__lt=now - datetime.timedelta(days=30)).delete()
    return out
