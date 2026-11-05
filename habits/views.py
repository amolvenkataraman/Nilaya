from django.contrib.auth.decorators import login_required
from django.shortcuts import render

from . import service
from .api import TodayOut


@login_required
def index(request):
    """The Habits app: one page driven by /api/v2/habits/ (habits/static/habits/habits.js).
    Today's checklist is embedded so the first paint needs no extra request."""
    user = request.user
    boot = {"me": {"username": user.username, "timezone": user.timezone},
            "today": TodayOut.model_validate(service.today_summary(user)).model_dump(mode="json")}
    return render(request, "habits/index.html", {"boot": boot})
