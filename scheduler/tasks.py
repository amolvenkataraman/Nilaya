from celery import shared_task
from celery.utils.log import get_task_logger

from django.conf import settings as _settings
from scheduler.models import Calendar
from scheduler.sync import cache_lock, sync_calendar
from notifications.service import notify, Priority

logger = get_task_logger(__name__)


@shared_task
def autosync_calendars():
    """Sync every active auto-sync calendar over its window ([this month − past, + future months)).
    ICS feeds use a conditional GET; each outcome is recorded on the calendar
    (last_synced_at / last_sync_error). The owner is notified when a sync starts failing."""
    if not _settings.ONLINE_MODE:
        print("Calendar sync task has been cancelled because the server is in offline mode.")
        return
    with cache_lock("calendar:autosync") as free:
        if not free:
            print("Calendar sync is already running; skipped this run.")
            return
        _autosync()


def _autosync():
    for cal in Calendar.objects.filter(calendar_type__gt=0, auto_sync=True, active=True).select_related("owner"):
        print(f"Syncing {cal.name}...")
        was_failing = bool(cal.last_sync_error)
        status = sync_calendar(cal)
        if status == "busy":
            print(f"{cal.name} is being synced by someone right now; skipped.")
            continue
        if status:
            print(f"{cal.name} has been synced{' (not modified)' if status == 'not_modified' else ''}!")
            continue
        print(f"An error ocurred syncing {cal.name}")
        if not was_failing:  # once per failure streak, not every run
            notify(cal.owner, f"Couldn't sync {cal.name}",
                   "The calendar's source didn't respond or returned an error. Its events weren't updated.",
                   source="Calendar", url="/calendar", priority=Priority.HIGH)
