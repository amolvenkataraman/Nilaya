"""Ninja auth: an API key in `Authorization: Bearer avn_...` or `X-API-Key: avn_...`.

The app is taken from the URL (/api/v2/<app>/...) and the access level from the method
(GET/HEAD/OPTIONS = read). Keys never work for /api/v2/keys/ (no key can mint keys)."""

import datetime

from django.utils import timezone
from ninja.errors import HttpError
from ninja.security import APIKeyHeader, HttpBearer

from .models import APPS, ApiKey

SAFE = {"GET", "HEAD", "OPTIONS"}


def _authenticate(request, token):
    key = ApiKey.from_token(token)
    if key is None:
        return None
    parts = request.path.split("/api/v2/", 1)[-1].strip("/").split("/")
    app = parts[0] if parts and parts[0] in APPS else None
    if app is None:
        return None  # key management, docs, or unknown: session only
    write = request.method not in SAFE
    if not key.allows(app, write):
        raise HttpError(403, f"This API key doesn't have {app}:{'write' if write else 'read'} access")
    request.user = key.user
    now = timezone.now()
    if key.last_used_on is None or now - key.last_used_on > datetime.timedelta(minutes=1):
        ip = request.META.get("REMOTE_ADDR")
        if ip in ("127.0.0.1", "::1"):  # behind nginx: its X-Real-IP is the client
            ip = request.META.get("HTTP_X_REAL_IP") or ip
        ApiKey.objects.filter(pk=key.pk).update(last_used_on=now, last_used_ip=ip)
    return key


def require_also(request, app, write=False):
    """For endpoints that hand out another app's data (e.g. photo links from Places): an API key
    also needs that app's access. Signed-in browsers are unaffected."""
    key = getattr(request, "auth", None)
    if isinstance(key, ApiKey) and not key.allows(app, write):
        raise HttpError(403, f"This API key also needs {app}:{'write' if write else 'read'} access")


class BearerKey(HttpBearer):
    def authenticate(self, request, token):
        return _authenticate(request, token)


class HeaderKey(APIKeyHeader):
    param_name = "X-API-Key"

    def authenticate(self, request, key):
        return _authenticate(request, key)
