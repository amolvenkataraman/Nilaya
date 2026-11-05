"""/api/v2/analytics/: staff-only usage summary (browser session only)."""

import datetime

from django.db.models import Count, Q
from django.db.models.functions import TruncDate
from django.utils import timezone
from ninja import Router
from ninja.errors import HttpError
from ninja.security import django_auth

from django.db.models import Sum

from .models import ApiDaily, Event

router = Router(tags=["analytics"], auth=django_auth)


@router.get("/summary", summary="Usage over the last N days (staff)")
def summary(request, days: int = 30):
    if not request.user.is_staff:
        raise HttpError(403, "Staff only")
    days = max(1, min(days, 90))
    since = timezone.now() - datetime.timedelta(days=days)
    qs = Event.objects.filter(ts__gte=since)
    per_day = list(qs.annotate(day=TruncDate("ts")).values("day")
                   .annotate(events=Count("id"), users=Count("user", distinct=True)).order_by("day"))
    api = ApiDaily.objects.filter(day__gte=since.date())
    api_days = {r["day"]: r["calls"] for r in api.values("day").annotate(calls=Sum("calls"))}
    for d in per_day:
        d["api"] = api_days.get(d["day"], 0)
    top = lambda field, n=10: list(qs.values(field).annotate(events=Count("id"), users=Count("user", distinct=True))
                                   .order_by("-events")[:n])
    routes = list(qs.values("app", "name").annotate(events=Count("id"), users=Count("user", distinct=True),
                                                            errors=Count("id", filter=Q(status__gte=500))).order_by("-events")[:25])
    return {"days": days, "total": qs.count(), "users": qs.values("user").distinct().count(),
            "per_day": [{**d, "day": d["day"].isoformat()} for d in per_day],
            "apps": top("app", 15), "devices": top("device"), "routes": routes,
            "api_apps": list(api.values("app").annotate(calls=Sum("calls"), errors=Sum("errors"),
                                                         users=Count("user", distinct=True)).order_by("-calls")),
            "api_clients": list(api.values("client").annotate(calls=Sum("calls")).order_by("-calls")),
            "hours": [qs.filter(ts__hour=h).count() for h in range(24)]}
