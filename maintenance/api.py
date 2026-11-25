"""/api/v2/maintenance/: staff-only maintenance jobs (Settings › Maintenance) and the state of the services
they depend on. Browser session only."""

import datetime
import uuid
from typing import Literal, Optional

from django.shortcuts import get_object_or_404
from ninja import Router, Schema
from ninja.errors import HttpError
from ninja.security import django_auth

from .jobs import JOBS
from .models import Run

router = Router(tags=["maintenance"], auth=django_auth)
STALE_AFTER = datetime.timedelta(hours=6)  # a queued/running run older than this is taken as dead


def _staff(request):
    if not request.user.is_staff:
        raise HttpError(403, "Staff only")


class RunOut(Schema):
    id: uuid.UUID
    job: str
    options: dict
    status: Literal["queued", "running", "done", "failed"]
    done: int
    total: Optional[int]
    summary: str
    result: dict
    log: str
    started_by: Optional[str]
    created_on: datetime.datetime
    started_on: Optional[datetime.datetime]
    finished_on: Optional[datetime.datetime]

    @staticmethod
    def resolve_started_by(obj):
        return obj.started_by.username if obj.started_by else None


class RunIn(Schema):
    options: dict = {}


def _placewise():
    from geo import service

    try:
        return {"ok": True, **service.health()}
    except service.Unavailable as exc:
        return {"ok": False, "error": str(exc)}


@router.get("/jobs", summary="Maintenance jobs with each one's latest runs, and service status (staff)")
def jobs(request):
    _staff(request)
    runs = {}
    for run in Run.objects.select_related("started_by").filter(job__in=JOBS)[:200]:
        runs.setdefault(run.job, []).append(run)
    return {
        "services": {"placewise": _placewise()},
        "jobs": [{"key": j.key, "title": j.title, "description": j.description, "group": j.group,
                  "options": [{"key": o.key, "label": o.label, "default": o.default} for o in j.options],
                  "runs": [RunOut.from_orm(r).dict() for r in runs.get(j.key, [])[:5]]}
                 for j in JOBS.values()],
    }


@router.post("/jobs/{key}/run", response={202: RunOut}, summary="Start a maintenance job (staff)")
def start(request, key: str, payload: RunIn):
    _staff(request)
    job = JOBS.get(key)
    if job is None:
        raise HttpError(404, "No such job")
    from django.utils import timezone

    busy = Run.objects.filter(job=key, status__in=(Run.QUEUED, Run.RUNNING),
                              created_on__gt=timezone.now() - STALE_AFTER).exists()
    if busy:
        raise HttpError(409, f"{job.title} is already running")
    options = {o.key: bool(payload.options.get(o.key, o.default)) for o in job.options}
    run = Run.objects.create(job=key, options=options, started_by=request.user)
    from .tasks import run_job

    run_job.delay(str(run.id))
    run.refresh_from_db()
    return 202, run


@router.get("/runs/{uuid:run_id}", response=RunOut, summary="One run's progress and outcome (staff)")
def get_run(request, run_id: uuid.UUID):
    _staff(request)
    return get_object_or_404(Run.objects.select_related("started_by"), id=run_id)
