"""Serves the new React UI (frontend/, built into static_files/static/app/) at /app/..."""

from pathlib import Path

from django.conf import settings
from django.contrib.auth.decorators import login_required
from django.http import HttpResponse

INDEX = Path(settings.BASE_DIR) / "static_files" / "static" / "app" / "index.html"

# The SPA is fully bundled (no inline scripts, no CDNs): only same-origin code may run. Styles allow
# 'unsafe-inline' for React/Leaflet style attributes; images also come from OpenStreetMap tiles.
CSP = "; ".join([
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://*.tile.openstreetmap.org",
    "media-src 'self' blob:",
    "connect-src 'self'",
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'self'",
])


@login_required
def index(request):
    if not INDEX.exists():
        return HttpResponse("The new interface isn't built on this server yet: run frontend/build.sh.",
                            status=503, content_type="text/plain")
    response = HttpResponse(INDEX.read_text(), content_type="text/html")
    # index.html names the hashed bundles: never cache it, so a deploy is picked up on the next load.
    response["Cache-Control"] = "no-cache"
    response["Content-Security-Policy"] = CSP
    return response
