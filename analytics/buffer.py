"""In-process buffer: page views are appended, API calls are summed per (day, user, app,
client); both are written in batches so a request pays almost nothing. A few unflushed
counts may be lost on restart; that's acceptable for analytics."""

import threading
import time

from django.conf import settings
from django.db.models import F

_lock = threading.Lock()
_events = []
_api = {}
_pending = 0
_last_flush = time.monotonic()


def _maybe_flush():
    global _pending
    _pending += 1
    due = _pending >= getattr(settings, "ANALYTICS_FLUSH_EVERY", 50) or time.monotonic() - _last_flush > 30
    return due


def add(event):
    with _lock:
        _events.append(event)
        due = _maybe_flush()
    if due:
        flush()


def count_api(day, user_id, app, client, error):
    with _lock:
        key = (day, user_id, app, client)
        calls, errors = _api.get(key, (0, 0))
        _api[key] = (calls + 1, errors + int(error))
        due = _maybe_flush()
    if due:
        flush()


def flush():
    global _last_flush, _pending
    from .models import ApiDaily, Event

    with _lock:
        events, _events[:] = list(_events), []
        api, counts = dict(_api), _api.clear()
        _pending = 0
        _last_flush = time.monotonic()
    try:
        if events:
            Event.objects.bulk_create([Event(**e) for e in events])
        for (day, user_id, app, client), (calls, errors) in api.items():
            row = dict(day=day, user_id=user_id, app=app, client=client)
            if not ApiDaily.objects.filter(**row).update(calls=F("calls") + calls, errors=F("errors") + errors):
                ApiDaily.objects.create(**row, calls=calls, errors=errors)
    except Exception:  # analytics must never break a request
        pass
