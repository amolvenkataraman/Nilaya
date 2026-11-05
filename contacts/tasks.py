from celery import shared_task


@shared_task
def send_contact_reminders():
    """Daily (beat): birthday and keep-in-touch notifications; each is sent once."""
    from .reminders import run

    return run()
