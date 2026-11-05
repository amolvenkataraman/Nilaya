from django.contrib.auth.decorators import login_required
from django.shortcuts import render


@login_required
def index(request):
    """The Tasks app: a single page driven by /api/v2/tasks/ (tasks/static/tasks/tasks.js)."""
    user = request.user
    boot = {"me": {"id": str(user.id), "username": user.username, "name": user.get_full_name() or user.username,
                   "timezone": user.timezone}}
    return render(request, "tasks/index.html", {"left_sidebar": True, "boot": boot})
