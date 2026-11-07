from celery import shared_task
from django.utils import timezone

from notifications.service import Priority, notify

from .service import due_reminders


@shared_task
def send_due_reminders():
    """Every minute (beat): notify for reminders that came due (missed ones older than a day are skipped)."""
    sent = 0
    for r in due_reminders():
        t = r.todo
        when = timezone.localtime(t.complete_by).strftime("%a %b %-d, %-I:%M %p") if t.complete_by else ""
        notify(t.user, f"Reminder: {t.name}", f"Due {when}" if when else "",
               source="Tasks", url=f"/tasks?task={t.id}",
               priority=Priority.HIGH if t.priority >= 15 else Priority.NORMAL)
        r.sent_at = timezone.now()
        r.save(update_fields=["sent_at"])
        sent += 1
    return sent


@shared_task
def send_auto_reminders():
    """Every minute (beat): event, deadline and todo reminders, morning agendas, deadline->todo copies."""
    from .auto_reminders import run

    return run()
