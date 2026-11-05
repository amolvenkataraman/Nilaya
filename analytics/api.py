"""/api/v2/analytics/: staff-only usage summary (browser session only)."""

import datetime

from django.db.models import Count, Sum
from django.utils import timezone
from ninja import Router
from ninja.errors import HttpError
from ninja.security import django_auth

from .models import Usage

router = Router(tags=["analytics"], auth=django_auth)


@router.get("/summary", summary="Usage per person, app and day over the last N days (staff)")
def summary(request, days: int = 30):
    if not request.user.is_staff:
        raise HttpError(403, "Staff only")
    days = max(1, min(days, 365))
    qs = Usage.objects.filter(day__gt=timezone.localdate() - datetime.timedelta(days=days))
    totals = lambda q: q.annotate(views=Sum("page_views"), calls=Sum("api_calls"))
    return {
        "days": days,
        "per_day": [{**r, "day": r["day"].isoformat()} for r in
                    totals(qs.values("day")).annotate(people=Count("user", distinct=True)).order_by("day")],
        "apps": list(totals(qs.values("app")).annotate(people=Count("user", distinct=True)).order_by("-views", "-calls")),
        "people": [{"user": r["user__username"], "name": f"{r['user__first_name']} {r['user__last_name']}".strip() or r["user__username"],
                    "views": r["views"], "calls": r["calls"], "active_days": r["active_days"]}
                   for r in totals(qs.values("user__username", "user__first_name", "user__last_name"))
                   .annotate(active_days=Count("day", distinct=True)).order_by("-views")],
        "matrix": list(totals(qs.values("user__username", "app")).order_by("user__username", "-views")),
    }
