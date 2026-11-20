"""One run of a maintenance job (maintenance/jobs.py): who started it, its options, progress and outcome."""

import uuid

from django.conf import settings
from django.db import models


class Run(models.Model):
    QUEUED, RUNNING, DONE, FAILED = "queued", "running", "done", "failed"
    STATUSES = [(s, s) for s in (QUEUED, RUNNING, DONE, FAILED)]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    job = models.CharField(max_length=40, db_index=True)
    options = models.JSONField(default=dict, blank=True)
    status = models.CharField(max_length=10, choices=STATUSES, default=QUEUED)
    done = models.PositiveIntegerField(default=0)
    total = models.PositiveIntegerField(null=True, blank=True)
    summary = models.CharField(max_length=300, blank=True)  # one line for the list
    result = models.JSONField(default=dict, blank=True)  # job-specific detail (e.g. sample changes)
    log = models.TextField(blank=True)  # a command's output, trimmed
    started_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+")
    created_on = models.DateTimeField(auto_now_add=True)
    started_on = models.DateTimeField(null=True, blank=True)
    finished_on = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_on"]

    def __str__(self):
        return f"{self.job} ({self.status})"
