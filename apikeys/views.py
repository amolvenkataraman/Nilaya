from django.contrib.auth.decorators import login_required
from django.shortcuts import render

from .models import APPS


@login_required
def index(request):
    return render(request, "apikeys/index.html", {"apps": [{"key": k, "label": v} for k, v in APPS.items()]})
