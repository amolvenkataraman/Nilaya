"""Caching for the heavy photo aggregates, and coalesced refreshes of the photo materialized views.

summary, stats, storage and browse each scan the whole library (seconds on hundreds of thousands
of photos). Their results are cached per user in the shared cache (Redis in production) under a
"generation" number that goes up whenever photos change: any Photo save or delete (signals in
apps.py), and every view refresh (ingest, hiding, deletes, location entry). Bulk .update() calls that skip
both are covered by the 15-minute expiry. The cache is never required: if it's down, the value
is computed as before.
"""

import hashlib
import logging

from django.core.cache import cache
from django.db import connection

log = logging.getLogger(__name__)

GEN_KEY = "photos:gen"
TTL = 15 * 60
REFRESH_DELAY_S = 15  # a burst of location saves or hides refreshes the views once


def bump():
    """Invalidate every cached photo aggregate (cheap: one Redis INCR)."""
    try:
        if cache.add(GEN_KEY, 1, None):
            return
        cache.incr(GEN_KEY)
    except Exception:  # missing key raced with an eviction, or the cache is down
        try:
            cache.set(GEN_KEY, 1, None)
        except Exception:
            pass


def cached(request, name, compute, *params):
    """compute() cached per user, their visible libraries, time zone and params.
    Show-hidden mode is never cached (it's rare and the owner expects to see changes at once)."""
    from . import hidden as hidden_mode
    from .models import Album_Subscriber
    if hidden_mode.show_hidden(request):
        return compute()
    try:
        gen = cache.get(GEN_KEY) or 0
    except Exception:
        return compute()
    libs = sorted(Album_Subscriber.objects.filter(user=request.user, visible=True).values_list("album_id", flat=True))
    scope = hashlib.blake2s(repr((libs, request.user.timezone, params)).encode(), digest_size=8).hexdigest()
    key = f"photos:{name}:{gen}:{request.user.pk}:{scope}"
    try:
        value = cache.get(key)
    except Exception:
        value = None
    if value is None:
        value = compute()
        try:
            cache.set(key, value, TTL)
        except Exception:
            pass
    return value


def schedule_matview_refresh(views=None):
    """Refresh the photo views soon, in a Celery worker, at most once per burst of changes.
    Falls back to refreshing right away when the queue isn't reachable."""
    from .models import MATVIEWS, refresh_photo_matviews
    views = tuple(views or MATVIEWS)
    bump()
    if connection.vendor != "postgresql":
        return  # SQLite: plain views, always current
    key = "photos:refresh:" + ",".join(views)
    try:
        if not cache.add(key, 1, REFRESH_DELAY_S * 8):
            return  # one is already queued; it will include this change
        from .tasks import refresh_photo_views
        refresh_photo_views.apply_async(args=[list(views)], countdown=REFRESH_DELAY_S)
    except Exception:
        log.warning("Couldn't queue the photo view refresh; refreshing now", exc_info=True)
        try:
            cache.delete(key)
        except Exception:
            pass
        refresh_photo_matviews(views)


def run_scheduled_refresh(views):
    """The Celery side: clear the queued flag first, so changes made during the refresh queue another."""
    from .models import refresh_photo_matviews
    views = tuple(views)
    try:
        cache.delete("photos:refresh:" + ",".join(views))
    except Exception:
        pass
    refresh_photo_matviews(views)
