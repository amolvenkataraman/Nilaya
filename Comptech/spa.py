"""Serves the React app (frontend/, built into static_files/static/app/) for every page URL.

Comptech/urls.py sends every path outside the reserved prefixes (API, admin, files, feeds) here.
This view also:
- redirects /app/<path> (where the app used to live) and the old server-rendered pages' URLs to
  their routes (301, query string kept), so bookmarks and old notification links keep working;
- sends signed-out visitors of private routes to /login?next=<path> (public routes: sign-in,
  public calendars, countdowns, availability and public shared albums);
- answers 404 for the removed upload portal (/photos/upload), signed in or not;
- sets the CSRF cookie (the sign-in form posts with it) and a strict Content-Security-Policy.
"""

import re
from pathlib import Path
from urllib.parse import quote

from django.conf import settings
from django.http import HttpResponse, HttpResponseNotFound, HttpResponsePermanentRedirect, HttpResponseRedirect
from django.middleware.csrf import get_token

INDEX = Path(settings.BASE_DIR) / "static_files" / "static" / "app" / "index.html"

# Never served by the app (Comptech/urls.py keeps them out of the catch-all): unknown paths there 404.
RESERVED = ("api", "admin", "static", "media", "private", "photo_cdn", "feeds", ".well-known", "dav")

# Removed pages: a plain 404 rather than the app (or, signed out, the sign-in page).
GONE = re.compile(r"^/photos/upload/?$")

# Routes signed-out visitors may open; everything else goes to the sign-in page first.
PUBLIC = re.compile(r"^/(?:(?:login|register)/?$|calendar/(?:public|countdown|availability)/|shared/)")

# The app is fully bundled (no inline scripts, no CDNs): only same-origin code may run. Styles allow
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

# Old server-rendered pages whose new route has a different path (same-path pages such as /tasks/
# or /calendar/public/<id>/ need nothing: the app's router ignores the trailing slash).
LEGACY = {
    "/accounts/login/": "/login",
    "/accounts/register/": "/register",
    "/accounts/logout/": "/",
    "/accounts/profile/": "/settings",
    "/accounts/change_password/": "/settings#set-password",
    "/apps/": "/",
    "/map/": "/places",
    "/settings/api-keys/": "/settings#set-api",
    "/analytics/": "/settings/usage",
    "/photos/map_new/": "/photos/map",
    "/photos/search/": "/photos/browse",
    "/photos/geoguessr_ent/": "/photos/locate",
}
LEGACY_PATTERNS = [
    (re.compile(r"^/accounts/profile/([\w.@+-]+)/$"), lambda m, q: f"/users/{m[1]}"),
    (re.compile(r"^/photos/superlatives/([\w-]+)/$"), lambda m, q: f"/photos/superlatives?cat={m[1]}"),
    (re.compile(r"^/photos/search/(cities|countries|cameras|objects)/$"), lambda m, q: f"/photos/browse?by={m[1]}"),
    (re.compile(r"^/photos/day/(\d{4})/(\d{1,2})/(\d{1,2})/$"),
     lambda m, q: f"/photos/day/{int(m[1]):04d}-{int(m[2]):02d}-{int(m[3]):02d}"),
    (re.compile(r"^/photos/view-photo/([0-9a-fA-F-]{36})/$"), lambda m, q: f"/photos?photo={m[1]}"),
    # Old notification links: a contact (/contacts/?id=<id>).
    (re.compile(r"^/contacts/$"), lambda m, q: f"/contacts?person={q['id']}" if re.fullmatch(r"[0-9a-fA-F-]{36}", q.get("id", "")) else None),
    # A shared album's old link (/photos/?album=<id>) opens its public page (members can open it too).
    (re.compile(r"^/photos/$"), lambda m, q: f"/shared/albums/{q['album']}" if re.fullmatch(r"[0-9a-fA-F-]{36}", q.get("album", "")) else None),
]


def _with_query(target, request, drop=()):
    """Append the request's query string (minus `drop`) to target, before any #fragment."""
    params = request.GET.copy()
    for key in drop:
        params.pop(key, None)
    qs = params.urlencode()
    if not qs:
        return target
    path, hash_, frag = target.partition("#")
    return path + ("&" if "?" in path else "?") + qs + hash_ + frag


def legacy_target(request):
    """The new URL for an old one, or None."""
    path = request.path
    if path == "/app" or path.startswith("/app/"):
        return _with_query(path[4:] or "/", request)
    if path in LEGACY:
        return _with_query(LEGACY[path], request)
    for pattern, build in LEGACY_PATTERNS:
        m = pattern.match(path)
        if m:
            target = build(m, request.GET)
            if target:
                return _with_query(target, request, drop=("album", "id") if "?" in target or "/shared/" in target else ())
    return None


_cache = {"mtime": None, "html": ""}


def _index_html():
    """index.html, re-read only when a deploy changed it."""
    mtime = INDEX.stat().st_mtime
    if _cache["mtime"] != mtime:
        _cache["html"], _cache["mtime"] = INDEX.read_text(), mtime
    return _cache["html"]


def index(request):
    target = legacy_target(request)
    if target:
        return HttpResponsePermanentRedirect(target)
    if GONE.match(request.path):
        return HttpResponseNotFound("This page no longer exists.", content_type="text/plain")
    signed_in = request.user.is_authenticated
    if not signed_in and not PUBLIC.match(request.path):
        return HttpResponseRedirect("/login?next=" + quote(request.get_full_path(), safe="/"))
    if not INDEX.exists():
        return HttpResponse("The interface isn't built on this server yet: run frontend/build.sh.",
                            status=503, content_type="text/plain")
    get_token(request)  # the CSRF cookie, for the sign-in form and every later write
    # The app reads this to pick its routes before any request (no inline script needed).
    html = _index_html().replace("<head>", f'<head><meta name="nilaya-session" content="{int(signed_in)}">', 1)
    response = HttpResponse(html, content_type="text/html")
    # index.html names the hashed bundles: never cache it, so a deploy is picked up on the next load.
    response["Cache-Control"] = "no-cache"
    response["Content-Security-Policy"] = CSP
    return response


def favicon(request):
    return HttpResponsePermanentRedirect(settings.STATIC_URL + "app/favicon.ico")
