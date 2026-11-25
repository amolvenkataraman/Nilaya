from celery import shared_task
from django.utils import timezone

from .models import Notification
from .service import deliver


@shared_task
def deliver_notification(notification_id):
    notification = Notification.objects.select_related("user").filter(id=notification_id).first()
    if notification is not None:
        deliver(notification)


@shared_task
def deliver_held_notifications():
    """Push what quiet hours held back once they're over, unless it was read (or deleted) in the app meanwhile.
    Beat runs this every minute; the single-row claim keeps an overlapping run from sending anything twice."""
    now = timezone.now()
    Notification.objects.filter(deliver_after__lte=now, read=True).update(deliver_after=None)
    sent = 0
    for n in Notification.objects.select_related("user").filter(deliver_after__lte=now, read=False):
        if Notification.objects.filter(id=n.id, deliver_after__isnull=False, read=False).update(deliver_after=None):
            deliver(n)
            sent += 1
    return sent


@shared_task
def cleanup_expired_notifications():
    """Delete notifications past their expiry (schedule it with Celery beat, e.g. hourly)."""
    deleted, _ = Notification.objects.filter(expires_on__lt=timezone.now()).delete()
    return deleted
