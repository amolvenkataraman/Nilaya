from django.db import connection, transaction
from django.db.models import F
from django.utils import timezone

from .models import Usage

ALIASES = {"": "home", "recent_events": "home", "apps": "home", "map": "places", "me": "profile",
           "accounts": "profile", "calendar": "calendar", "scheduler": "calendar"}
SKIP = ("/static/", "/media/", "/private/", "/photo_cdn/", "/favicon", "/admin/jsi18n", "/api/v2/analytics/")


class AnalyticsMiddleware:
    """Count page views and API calls per signed-in person, app and day."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        response = self.get_response(request)
        try:
            self.count(request, response)
        except Exception:  # never break a request over analytics
            pass
        return response

    @staticmethod
    def count(request, response):
        if response.status_code >= 400 or request.path.startswith(SKIP):  # before touching the session/user
            return
        user = getattr(request, "user", None)
        if user is None or not user.is_authenticated:
            return
        parts = request.path.strip("/").split("/")
        is_api = request.path.startswith("/api/v2/")
        segment = parts[2] if is_api and len(parts) > 2 else parts[0]
        app = ALIASES.get(segment, segment)[:24]
        is_page = not is_api and response.get("Content-Type", "").startswith("text/html")
        field = "page_views" if is_page else "api_calls"  # in-page JSON fetches count as API calls
        row = {"day": timezone.localdate(), "user_id": user.pk, "app": app}
        with transaction.atomic():
            if connection.vendor == "postgresql":
                # A usage counter isn't worth a WAL flush per request: commit without waiting for the
                # disk (a crash can lose the last fraction of a second of counts, nothing else). It also
                # keeps the row lock short when a page fires several API calls at once (same row).
                with connection.cursor() as cursor:
                    cursor.execute("SET LOCAL synchronous_commit TO OFF")
            if not Usage.objects.filter(**row).update(**{field: F(field) + 1}):
                Usage.objects.get_or_create(**row, defaults={field: 1})
