"""Daily contact reminders (contacts.tasks.send_contact_reminders):

- Birthdays: one notification per person per year, the day before (or on the day, per
  ContactSettings); a missed day-before still sends on the day.
- Keep in touch: one notification per person each time they become due. When more than
  DIGEST_OVER people fall due at once (e.g. right after an import), one digest instead.

Dates are each owner's local dates. Dedupe uses notifications.SentReminder keys, so running
the task more than once a day is harmless.
"""

import datetime

import pytz
from django.db import IntegrityError
from django.db.models import Q
from django.utils import timezone

from notifications.models import SentReminder
from notifications.service import Priority, notify

from .models import ContactSettings, Person

DIGEST_OVER = 3
DEFAULTS = ContactSettings()


def _today(user):
    tz = pytz.timezone(user.timezone) if user.timezone in pytz.all_timezones_set else timezone.get_current_timezone()
    return timezone.localtime(timezone.now(), tz).date()


def _once(user, key):
    try:
        _, created = SentReminder.objects.get_or_create(user=user, key=key[:160])
        return created
    except IntegrityError:
        return False


def _md(d):
    q = Q(birthday_month=d.month, birthday_day=d.day)
    if d.month == 2 and d.day == 28:
        q |= Q(birthday_month=2, birthday_day=29)  # celebrated on the 28th in non-leap years
    return q


def birthday_reminders(today, settings, local):
    sent = 0
    window = Q()
    for offset in range(-1, 3):  # owners' local dates can differ from the server's by a day
        window |= _md(today + datetime.timedelta(days=offset))
    for p in Person.objects.filter(window).select_related("owner").only(
            "id", "first_name", "middle_name", "last_name", "display_name", "nickname", "company", "emails",
            "birthday_year", "birthday_month", "birthday_day", "owner"):
        st = settings(p.owner_id)
        if st.birthday_reminders == "off":
            continue
        t = local(p.owner)
        nb = p.next_birthday(t)
        days = (nb - t).days if nb else 99
        if days > (1 if st.birthday_reminders == "day_before" else 0):
            continue
        if not _once(p.owner, f"ct:bday:{p.id}:{nb.year}"):
            continue
        when = "today" if days == 0 else "tomorrow"
        if p.birthday_year:
            title = f"{p.name} turns {nb.year - p.birthday_year} {when}"
        else:
            title = f"{p.name}'s birthday is {when}"
        notify(p.owner, title, nb.strftime("%A, %B %-d"), source="Contacts", url=f"/contacts?person={p.id}",
               priority=Priority.NORMAL)
        sent += 1
    return sent


def keep_in_touch_reminders(today, settings, local):
    due = {}
    qs = (Person.objects.filter(keep_in_touch_days__isnull=False, next_due__lte=today + datetime.timedelta(days=1))
          .select_related("owner").only("id", "first_name", "middle_name", "last_name", "display_name", "nickname",
                                        "company", "emails", "next_due", "last_contacted", "keep_in_touch_days", "owner")
          .order_by("next_due"))
    for p in qs:
        if not settings(p.owner_id).keep_in_touch_reminders:
            continue
        t = local(p.owner)
        if p.next_due > t or not _once(p.owner, f"ct:kit:{p.id}:{p.next_due.isoformat()}"):
            continue
        due.setdefault(p.owner_id, (p.owner, []))[1].append(p)
    sent = 0
    for user, people in due.values():
        if len(people) > DIGEST_OVER:
            names = ", ".join(p.name for p in people[:5]) + (f" and {len(people) - 5} more" if len(people) > 5 else "")
            notify(user, f"{len(people)} people to catch up with", names, source="Contacts",
                   url="/contacts?filter=overdue", priority=Priority.LOW)
            sent += 1
            continue
        for p in people:
            last = f"Last in touch {p.last_contacted:%b %-d, %Y}" if p.last_contacted else "No contact logged yet"
            notify(user, f"Catch up with {p.name}", f"{last} · every {p.keep_in_touch_days} days", source="Contacts",
                   url=f"/contacts?person={p.id}", priority=Priority.LOW)
            sent += 1
    return sent


def run(today=None):
    """Send due reminders. `today` pins everyone's local date (tests)."""
    local = (lambda user: today) if today else _today
    today = today or timezone.localdate()
    cache = {}

    def settings(user_id):
        if user_id not in cache:
            cache[user_id] = ContactSettings.objects.filter(user_id=user_id).first() or DEFAULTS
        return cache[user_id]

    return {"birthdays": birthday_reminders(today, settings, local),
            "keep_in_touch": keep_in_touch_reminders(today, settings, local)}
