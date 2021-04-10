from django.http import HttpResponse, HttpResponseBadRequest, HttpResponseForbidden, JsonResponse
from django.contrib import messages
from django.shortcuts import redirect, render
from django.contrib.auth.decorators import login_required
from Comptech.settings import GREETINGS, LINKS
from scheduler.views import get_recent
import datetime
import random

# Create your views here.
@login_required
def home(request):
    if random.randrange(2) == 0:
        greeting = random.choice(GREETINGS)
    else:
        hour = datetime.datetime.now().hour
        if hour > 0 and hour <= 11:
            greeting = "Good Morning"
        elif hour > 11 and hour <= 14:
            greeting = "Good Afternoon"
        elif hour > 14 and hour <= 18:
            greeting = "Good Evening"
        elif hour > 18 and hour <= 22:
            greeting = "Good Night"
        else:
            greeting = "Good Midnight"

    return render(request, 'mainsite/home.html', {"greeting": greeting, "links": LINKS})

@login_required
def get_recent_events(request):
    return JsonResponse(get_recent(request.user))

@login_required
def apps(request):
    return render(request, 'mainsite/apps.html', {})
