"""The one way for any app to notify a user:

    from notifications.service import notify, Priority
    notify(user, "Ingest finished", "42 new photos", source="Photos", url="/photos/")

The notification is saved (bell menu) and, after the surrounding transaction
commits, delivered in the background (Celery) to the user's enabled channels whose
minimum priority it meets. Delivery problems never break the caller.
"""

import datetime
import logging
from urllib.parse import urlsplit

from django.db import transaction
from django.utils import timezone

from .models import Notification, NotificationChannel, Priority

log = logging.getLogger("comptech.notifications")

__all__ = ["notify", "notify_many", "deliver", "safe_url", "Priority"]


def safe_url(url):
    """The link a notification may carry: a path on this site ("/photos/") or an http(s) URL.
    Anything else ("javascript:...", "//other.host", control characters) gives ""."""
    url = (url or "").strip()
    if not url or len(url) > 512 or any(ord(c) < 32 or ord(c) == 127 for c in url):
        return ""
    if url.startswith("/"):
        return "" if url[1:2] in ("/", "\\") else url
    try:
        parts = urlsplit(url)
    except ValueError:
        return ""
    return url if parts.scheme.lower() in ("http", "https") and parts.hostname else ""


def notify(user, title, body="", *, source="Nilaya", priority=Priority.NORMAL, url="",
           expires_in=None, deliver_now=True):
    n = Notification.objects.create(
        user=user, title=title[:128], description=body or None, source=source[:128],
        priority=int(priority), url=safe_url(url),
        expires_on=timezone.now() + expires_in if isinstance(expires_in, datetime.timedelta) else None,
    )
    if deliver_now:
        from .tasks import deliver_notification

        transaction.on_commit(lambda: _enqueue(deliver_notification, n.id))
    return n


def notify_many(users, title, body="", **kwargs):
    return [notify(u, title, body, **kwargs) for u in users]


def _enqueue(task, notification_id):
    try:
        task.delay(str(notification_id))
    except Exception:  # broker down: the notification is still in the bell menu
        log.exception("Couldn't queue delivery for notification %s", notification_id)


def deliver(notification, channels=None):
    """Send to each enabled channel at/above its minimum priority; record the outcome on the channel."""
    from .channels import DeliveryError, send

    if channels is None:
        channels = NotificationChannel.objects.filter(
            user=notification.user, enabled=True, min_priority__lte=notification.priority)
    results = {}
    for channel in channels:
        try:
            send(channel, notification)
        except DeliveryError as exc:
            channel.last_error = str(exc)
            results[channel.id] = str(exc)
        except Exception as exc:  # a broken channel must not stop the others
            log.exception("Delivery to channel %s failed", channel.id)
            channel.last_error = f"Unexpected error: {type(exc).__name__}"
            results[channel.id] = channel.last_error
        else:
            channel.last_error = ""
            channel.last_sent_at = timezone.now()
            results[channel.id] = None
        channel.save(update_fields=["last_error", "last_sent_at"])
    return results
