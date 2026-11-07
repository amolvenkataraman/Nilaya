"""V2 API: typed, documented JSON API for every app, mounted at /api/v2/.

Usable from any platform:
- Browser: the login session cookie; unsafe methods need the CSRF token (X-CSRFToken).
- Scripts, phones, other servers: a personal API key, scoped per app and access level
  (Settings -> API keys), sent as `Authorization: Bearer avn_...` or `X-API-Key: avn_...`.
  No cookies or CSRF involved. Keys can't manage keys.
- JSON in and out, ISO 8601 datetimes with offsets, UUID ids, errors as {"detail": ...}.
- OpenAPI schema: /api/v2/openapi.json, interactive docs: /api/v2/docs (signed-in users).
- Rate limit: 600 requests/minute per key or user.
"""

import logging

from django.contrib.auth.decorators import login_required
from ninja import NinjaAPI
from ninja.security import django_auth
from ninja.throttling import AuthRateThrottle

from apikeys.auth import BearerKey, HeaderKey

log = logging.getLogger(__name__)


class PerPrincipalThrottle(AuthRateThrottle):
    """600 requests/minute per API key or signed-in user, keyed by primary key (not a display string).
    The counts live in the cache (Redis); if it's down, requests are allowed rather than failing."""

    def allow_request(self, request):
        try:
            return super().allow_request(request)
        except Exception:  # cache unreachable: fail open, the limit is a safety net
            log.warning("Rate limit skipped: cache unavailable")
            return True

    def get_cache_key(self, request):
        auth = getattr(request, "auth", None)
        if auth is None:
            return super().get_cache_key(request)
        return self.cache_format % {"scope": self.scope, "ident": f"{auth.__class__.__name__}:{auth.pk}"}


api = NinjaAPI(
    title="AVNet Superapp API",
    version="2.0",
    urls_namespace="api-v2",
    auth=[BearerKey(), HeaderKey(), django_auth],
    throttle=[PerPrincipalThrottle("600/m")],
    docs_url="/docs",
    docs_decorator=login_required,
)

api.add_router("/notifications/", "notifications.api.router")
api.add_router("/auth/", "users.auth_api.router")
api.add_router("/me", "users.api_v2.router")
api.add_router("/users/", "users.api_v2.people")
api.add_router("/calendar/public/", "scheduler.api_public.router")
api.add_router("/calendar/", "scheduler.api_v2.router")
api.add_router("/photos/", "photos.api_v2.router")
api.add_router("/photos/locate/", "photos.api_presets.router")
api.add_router("/photos/search", "photos.api_search.router")
api.add_router("/photos/public/", "photos.api_public.router")
api.add_router("/photos/", "photos.api_insights.router")
api.add_router("/places/", "map.api_v2.router")
api.add_router("/tasks/", "tasks.api.router")
api.add_router("/contacts/", "contacts.api.router")
api.add_router("/habits/", "habits.api.router")
api.add_router("/keys/", "apikeys.api.router")
api.add_router("/analytics/", "analytics.api.router")
api.add_router("/feeds/", "feeds.api.router")

# /api/v2/<app>/guide.md: Markdown guides generated from this schema (see Comptech/api_guides.py).
from apikeys.models import APPS as _APPS  # noqa: E402
from Comptech.api_guides import register as _register_guides  # noqa: E402

_register_guides(api, _APPS)
