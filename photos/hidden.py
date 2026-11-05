"""Hidden photos. A hidden photo is left out of every listing, count, map and album for
everyone. Its owner can reveal their own hidden photos by turning on show-hidden mode,
which lives only in the browser session and switches itself off after WINDOW (and on
logout). API keys can't turn it on.

Use `visible(qs, request)` on any Photo queryset that's shown to a user.
"""

import datetime

from django.db.models import Q
from django.utils import timezone

SESSION_KEY = "photos_hidden_until"
WINDOW = datetime.timedelta(minutes=30)


def show_hidden(request):
    if request is None or not getattr(request, "user", None) or not request.user.is_authenticated:
        return False
    if not hasattr(request, "session"):
        return False
    until = request.session.get(SESSION_KEY)
    if until and until > timezone.now().timestamp():
        return True
    request.session.pop(SESSION_KEY, None)
    return False


def set_show_hidden(request, on):
    if on:
        request.session[SESSION_KEY] = (timezone.now() + WINDOW).timestamp()
    else:
        request.session.pop(SESSION_KEY, None)
    return show_hidden(request)


def visible(qs, request=None, prefix=""):
    """Filter a queryset (of Photo, or related through `prefix`, e.g. "photo__") to what this request may see."""
    hidden, owner = f"{prefix}hidden", f"{prefix}owner"
    if show_hidden(request):
        return qs.filter(Q(**{hidden: False}) | Q(**{owner: request.user}))
    return qs.filter(**{hidden: False})
