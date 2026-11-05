from django.contrib.auth.decorators import login_required
from django.shortcuts import render

from .api import meta


@login_required
def index(request):
    user = request.user
    boot = {"me": {"username": user.username, "name": user.get_full_name() or user.username}, **meta()}
    return render(request, "contacts/index.html", {"left_sidebar": True, "boot": boot})
