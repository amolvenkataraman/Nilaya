from celery import shared_task


@shared_task
def send_habit_reminders():
    """Every minute (beat): per-habit reminders at their local time, and the optional evening nudge."""
    from .reminders import run

    return run()
