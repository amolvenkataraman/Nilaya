"""Self-hosted usage analytics, to learn which features matter before V2.

- Page views: one row per view with the URL route pattern (never raw paths, ids or query
  strings), device class, status and duration. Kept 90 days, then only daily rollups.
- API: just a counter per user, per day, per app and client (calls, errors). Finer
  detail, if ever needed, comes from the nginx logs.
- No IP addresses or user agents; skipped for Do-Not-Track / Global Privacy Control.
  Dashboards are staff-only.
"""

from django.conf import settings
from django.db import models


class Event(models.Model):
    ts = models.DateTimeField(db_index=True)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    app = models.CharField(max_length=24)        # calendar, tasks, photos, ...
    name = models.CharField(max_length=160)      # URL route pattern, e.g. day/<int:year>/<int:month>/<int:day>/
    client = models.CharField(max_length=8)      # web | newui
    device = models.CharField(max_length=8)      # desktop | mobile | tablet | other
    status = models.PositiveSmallIntegerField()
    ms = models.PositiveIntegerField()


class Daily(models.Model):
    """Page-view rollup (raw Events are dropped after 90 days)."""
    day = models.DateField(db_index=True)
    app = models.CharField(max_length=24)
    name = models.CharField(max_length=160)
    client = models.CharField(max_length=8)
    device = models.CharField(max_length=8)
    events = models.PositiveIntegerField()
    users = models.PositiveIntegerField()
    errors = models.PositiveIntegerField()
    p50_ms = models.PositiveIntegerField()
    p95_ms = models.PositiveIntegerField()

    class Meta:
        unique_together = [("day", "app", "name", "client", "device")]


class ApiDaily(models.Model):
    """API calls per user per day per app (client: web | newui | apikey)."""
    day = models.DateField(db_index=True)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.CASCADE, related_name="+")
    app = models.CharField(max_length=24)
    client = models.CharField(max_length=8)
    calls = models.PositiveIntegerField(default=0)
    errors = models.PositiveIntegerField(default=0)

    class Meta:
        unique_together = [("day", "user", "app", "client")]
