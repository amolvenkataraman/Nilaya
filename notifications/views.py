from django.contrib.auth.decorators import login_required
from django.shortcuts import render


@login_required
def index(request):
    """Inbox + delivery channels (the page talks to /api/v2/notifications/)."""
    return render(request, "notifications/index.html")
