import time

from celery import shared_task
from celery.utils.log import get_task_logger
from django.utils import timezone

from .jobs import JOBS
from .models import Run

log = get_task_logger(__name__)  # shows in the worker log (Comptech.sh window 2)
PROGRESS_EVERY_S = 1.0  # how often progress is saved for the page
LOG_EVERY_S = 15.0  # and written to the worker's log


@shared_task(ignore_result=True)
def run_job(run_id):
    run = Run.objects.get(id=run_id)
    job = JOBS[run.job]
    run.status, run.started_on = Run.RUNNING, timezone.now()
    run.save(update_fields=["status", "started_on"])
    log.info("maintenance %s started (run %s, options %s, by %s)", run.job, run.id, run.options, run.started_by)
    last, logged = [0.0], [time.monotonic()]

    def progress(done, total):
        run.done, run.total = done, total
        now = time.monotonic()
        if now - last[0] >= PROGRESS_EVERY_S or done == total:
            last[0] = now
            Run.objects.filter(id=run.id).update(done=done, total=total)
        if now - logged[0] >= LOG_EVERY_S:
            logged[0] = now
            log.info("maintenance %s: %s of %s", run.job, f"{done:,}", f"{total:,}")

    run.progress = progress
    try:
        run.summary, run.result = job.run(run, run.options)
        run.status = Run.DONE
    except Exception as exc:  # shown on the page; the traceback goes to the worker log
        log.exception("maintenance job %s failed", run.job)
        run.status, run.summary = Run.FAILED, f"{type(exc).__name__}: {exc}"[:300]
    run.finished_on = timezone.now()
    run.save()
    log.info("maintenance %s %s in %.0f s: %s", run.job, run.status, (run.finished_on - run.started_on).total_seconds(),
             run.summary)
