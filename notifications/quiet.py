"""Quiet hours (Settings › Preferences): while they last, a notification still lands in the bell at once but its
pushes to the user's channels are held until they end (service.notify sets deliver_after; tasks flushes it)."""

import datetime
from typing import Optional
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from django.conf import settings
from django.utils import timezone

from users import preferences


def user_zone(user) -> ZoneInfo:
    try:
        return ZoneInfo(user.timezone)
    except (ZoneInfoNotFoundError, ValueError, TypeError):  # a stale or blank zone name: the server's
        return ZoneInfo(settings.TIME_ZONE)


def quiet_until(user, now: Optional[datetime.datetime] = None) -> Optional[datetime.datetime]:
    """When the user's quiet hours end, if `now` falls inside them; None when they're off or it's outside them.
    Wall clock in the user's zone; a window like 22:00–07:00 crosses midnight."""
    q = preferences.of(user).quiet_hours
    if not q.enabled or q.start == q.end:
        return None
    zone = user_zone(user)
    local = (now or timezone.now()).astimezone(zone)
    t, day = local.time(), local.date()
    if q.start < q.end:  # same-day window, e.g. 13:00–14:00
        if not q.start <= t < q.end:
            return None
    elif t >= q.start:  # the evening half of an overnight window: it ends tomorrow
        day += datetime.timedelta(days=1)
    elif t >= q.end:  # between the morning end and the evening start
        return None
    return datetime.datetime.combine(day, q.end, tzinfo=zone)


def reschedule_held(user) -> int:
    """After the user changes their quiet hours: pushes already held follow the new window (sent on the next flush
    when it's over or switched off) instead of waiting for the old end time."""
    from .models import Notification
    until = quiet_until(user) or timezone.now()
    return Notification.objects.filter(user=user, deliver_after__isnull=False).update(deliver_after=until)
