import datetime

from celery import shared_task
from django.utils import timezone

from .models import Daily, Event


def _pct(values, p):
    if not values:
        return 0
    values = sorted(values)
    return values[min(len(values) - 1, int(round(p * (len(values) - 1))))]


@shared_task
def rollup(day=None):
    """Summarise one day (default: yesterday) into Daily rows, then drop raw events older than 90 days."""
    day = datetime.date.fromisoformat(day) if day else timezone.localdate() - datetime.timedelta(days=1)
    tz = timezone.get_current_timezone()
    start = datetime.datetime.combine(day, datetime.time(), tzinfo=tz)
    qs = Event.objects.filter(ts__gte=start, ts__lt=start + datetime.timedelta(days=1))
    groups = {}
    for e in qs.values("app", "name", "client", "device", "user_id", "status", "ms").iterator():
        key = (e["app"], e["name"], e["client"], e["device"])
        g = groups.setdefault(key, {"ms": [], "users": set(), "errors": 0})
        g["ms"].append(e["ms"])
        g["users"].add(e["user_id"])
        g["errors"] += e["status"] >= 500
    Daily.objects.filter(day=day).delete()
    Daily.objects.bulk_create([
        Daily(day=day, app=k[0], name=k[1], client=k[2], device=k[3], events=len(g["ms"]),
              users=len(g["users"] - {None}), errors=g["errors"], p50_ms=_pct(g["ms"], 0.5), p95_ms=_pct(g["ms"], 0.95))
        for k, g in groups.items()])
    Event.objects.filter(ts__lt=timezone.now() - datetime.timedelta(days=90)).delete()
    return len(groups)
