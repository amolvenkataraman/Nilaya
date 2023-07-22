from django.http import HttpResponse, HttpResponseBadRequest, HttpResponseForbidden, JsonResponse
from django.contrib import messages
from django.shortcuts import redirect, render
from django.contrib.auth.decorators import login_required
from django.utils import timezone
from scheduler.views import get_recent
import datetime
import random

# Create your views here.
@login_required
def home(request):
    return render(request, 'mainsite/home.html')

@login_required
def get_recent_events(request):
    return JsonResponse(get_recent(request.user))

@login_required
def apps(request):
    return render(request, 'mainsite/apps.html', {})

def basev2(request):
    return render(request, 'base_v2.html', {"left_sidebar": True, "right_sidebar": True})
