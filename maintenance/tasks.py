import logging
import time

from celery import shared_task
from django.utils import timezone

from .jobs import JOBS
from .models import Run

log = logging.getLogger(__name__)
PROGRESS_EVERY_S = 1.0


@shared_task(ignore_result=True)
def run_job(run_id):
    run = Run.objects.get(id=run_id)
    job = JOBS[run.job]
    run.status, run.started_on = Run.RUNNING, timezone.now()
    run.save(update_fields=["status", "started_on"])
    last = [0.0]

    def progress(done, total):
        run.done, run.total = done, total
        if time.monotonic() - last[0] >= PROGRESS_EVERY_S or done == total:
            last[0] = time.monotonic()
            Run.objects.filter(id=run.id).update(done=done, total=total)

    run.progress = progress
    try:
        run.summary, run.result = job.run(run, run.options)
        run.status = Run.DONE
    except Exception as exc:  # shown on the page; the traceback goes to the worker log
        log.exception("maintenance job %s failed", run.job)
        run.status, run.summary = Run.FAILED, f"{type(exc).__name__}: {exc}"[:300]
    run.finished_on = timezone.now()
    run.save()
