"""Hidden photos. A hidden photo is left out of every listing, count, map and album for
everyone. Whoever controls it (see `controls`) can hide and unhide it, and reveal it by
turning on show-hidden mode, which lives only in the browser session and switches itself
off after WINDOW (and on logout). API keys can't turn it on.

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


def controls(user, prefix=""):
    """Photos this user may hide, unhide and reveal: the ones they imported (Photo.owner) and every
    photo in a library they own (Album.owner), so an editor's ingest never locks the owner out."""
    return Q(**{f"{prefix}owner": user}) | Q(**{f"{prefix}album__owner": user})


def can_control(photo, user):
    return user is not None and user.is_authenticated and user.id in (photo.owner_id, photo.album.owner_id)


def visible(qs, request=None, prefix=""):
    """Filter a queryset (of Photo, or related through `prefix`, e.g. "photo__") to what this request may see."""
    hidden = f"{prefix}hidden"
    if show_hidden(request):
        return qs.filter(Q(**{hidden: False}) | controls(request.user, prefix))
    return qs.filter(**{hidden: False})
