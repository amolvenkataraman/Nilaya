import re
import time

from django.utils import timezone

from . import buffer

SKIP = ("/static/", "/media/", "/private/", "/photo_cdn/", "/favicon", "/admin/jsi18n", "/api/v2/analytics/")
MOBILE = re.compile(r"Mobi|Android.+Mobile|iPhone|iPod", re.I)
TABLET = re.compile(r"iPad|Tablet|Android(?!.*Mobile)", re.I)


def _device(ua):
    if not ua:
        return "other"
    if TABLET.search(ua):
        return "tablet"
    if MOBILE.search(ua):
        return "mobile"
    return "desktop"


class AnalyticsMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        start = time.monotonic()
        response = self.get_response(request)
        try:
            self.record(request, response, start)
        except Exception:
            pass
        return response

    def record(self, request, response, start):
        path = request.path
        if path.startswith(SKIP) or request.META.get("HTTP_DNT") == "1" or request.META.get("HTTP_SEC_GPC") == "1":
            return
        match = getattr(request, "resolver_match", None)
        if match is None:
            return  # 404s from unknown URLs: nothing useful (and could be scanners)
        is_api = path.startswith("/api/v2/")
        parts = path.strip("/").split("/")
        app = (parts[2] if is_api and len(parts) > 2 else parts[0]) or "home"
        auth = getattr(request, "auth", None)
        client = "apikey" if auth is not None and auth.__class__.__name__ == "ApiKey" else (
            "newui" if path.startswith("/app") or "/app/" in request.META.get("HTTP_REFERER", "") else "web")
        user = getattr(request, "user", None)
        user_id = user.pk if user is not None and user.is_authenticated else None
        if is_api:
            buffer.count_api(timezone.localdate(), user_id, app[:24], client, response.status_code >= 500)
            return
        buffer.add({
            "ts": timezone.now(), "user_id": user_id, "app": app[:24], "name": (match.route or match.view_name or "")[:160],
            "client": client, "device": _device(request.META.get("HTTP_USER_AGENT", "")),
            "status": response.status_code, "ms": int((time.monotonic() - start) * 1000),
        })
