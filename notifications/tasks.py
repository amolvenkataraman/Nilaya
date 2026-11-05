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
def cleanup_expired_notifications():
    """Delete notifications past their expiry (schedule it with Celery beat, e.g. hourly)."""
    deleted, _ = Notification.objects.filter(expires_on__lt=timezone.now()).delete()
    return deleted
