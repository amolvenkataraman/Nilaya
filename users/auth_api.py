"""/api/v2/auth/: browser sign-in and sign-out for the React app (session cookie + CSRF).

These operations run without authentication (auth=None), so Ninja's session auth doesn't check CSRF
for them: each one checks it itself. API keys never sign in here; they're sent on every request.
"""

import functools
import ipaddress
import logging
import math
import time

from django.contrib.auth import authenticate, login, logout
from django.core.cache import cache
from django.http import JsonResponse
from django.utils.http import url_has_allowed_host_and_scheme
from ninja import Field, Router, Schema
from ninja.errors import HttpError
from ninja.utils import check_csrf

router = Router(tags=["auth"])
log = logging.getLogger(__name__)

# Failed sign-ins per username: after 10 within 15 minutes, that name is refused until the window ends.
FAIL_LIMIT, FAIL_WINDOW = 10, 15 * 60
# Failed sign-ins per client IP, across all usernames, so a few passwords tried on many names (password
# spraying) also hit a limit. Fixed 15-minute windows; a household behind one address never gets close.
IP_FAIL_LIMIT, IP_FAIL_WINDOW = 20, 15 * 60
_cache_down = False  # so a cache outage is logged once, not on every sign-in


class TooManyAttempts(HttpError):
    """429 with a Retry-After (seconds); views decorated with @retry_after send the header."""

    def __init__(self, message, retry_after):
        super().__init__(429, message)
        self.retry_after = retry_after


def retry_after(view):
    """Turns TooManyAttempts into a 429 that carries Retry-After (Ninja's error handler drops headers)."""
    @functools.wraps(view)
    def wrapper(request, *args, **kwargs):
        try:
            return view(request, *args, **kwargs)
        except TooManyAttempts as exc:
            return JsonResponse({"detail": exc.message}, status=429, headers={"Retry-After": str(exc.retry_after)})
    return wrapper


def client_ip(request):
    """The caller's address. Behind nginx REMOTE_ADDR is loopback and nginx sets X-Real-IP to the real one
    (overwriting anything the client sent); a direct caller's X-Real-IP is never trusted."""
    ip = request.META.get("REMOTE_ADDR")
    if ip in ("127.0.0.1", "::1"):
        ip = request.META.get("HTTP_X_REAL_IP") or ip
    return ip


def safe_next(request, url):
    """Where to go after signing in: a path on this site, else "/" ("//evil", "https://evil" and
    "javascript:" never pass)."""
    url = (url or "").strip()
    if url.startswith("/") and url_has_allowed_host_and_scheme(url, allowed_hosts={request.get_host()},
                                                              require_https=request.is_secure()):
        return url
    return "/"


def _csrf(request):
    if check_csrf(request) is not None:
        raise HttpError(403, "Your session expired. Reload the page and try again.")


def _fail_key(username):
    return "login-fail:" + username.strip().lower()[:150]


def _ip_fail_key(request, now):
    """The current window's failure counter for this client. An IPv6 client usually owns a whole /64, so
    that's the unit; the window number in the key makes old windows expire on their own."""
    ip = client_ip(request) or ""
    try:
        if ipaddress.ip_address(ip).version == 6:
            ip = str(ipaddress.ip_network(f"{ip}/64", strict=False).network_address)
    except ValueError:
        pass
    return f"login-fail-ip:{ip}:{int(now // IP_FAIL_WINDOW)}"


def _cache_failed():
    # The limits are a safety net, never a lock-out: with the cache down, sign-in goes on unlimited.
    global _cache_down
    if not _cache_down:
        _cache_down = True
        log.warning("Sign-in failure limits skipped: cache unavailable")


class LoginIn(Schema):
    username: str = Field(..., max_length=150)
    password: str = Field(..., max_length=4096)
    next: str = Field("", max_length=2048)


class LoginOut(Schema):
    next: str


def check_credentials(request, username, password):
    """The user for a username and password. Raises 429 once that name, or this client's address, has
    failed too often, 400 if they're wrong. Only failures count. Shared by the browser sign-in and the
    phone sign-in (apikeys/devices.py); their views need @retry_after."""
    global _cache_down
    key, now = _fail_key(username), time.time()
    ip_key = _ip_fail_key(request, now)
    try:
        failures, ip_failures = cache.get(key, 0), cache.get(ip_key, 0)
        _cache_down = False
    except Exception:
        _cache_failed()
        failures = ip_failures = 0
    if ip_failures >= IP_FAIL_LIMIT:
        wait = int(IP_FAIL_WINDOW - now % IP_FAIL_WINDOW) + 1  # until this window ends
        raise TooManyAttempts(f"Too many failed attempts from this network. Try again in {math.ceil(wait / 60)} minutes.", wait)
    if failures >= FAIL_LIMIT:
        raise HttpError(429, "Too many failed attempts. Try again in 15 minutes.")
    user = authenticate(request, username=username, password=password)
    if user is None:
        try:
            cache.set(key, failures + 1, FAIL_WINDOW)
            # add + incr is atomic, so parallel guesses can't slip past the per-address count.
            cache.add(ip_key, 0, IP_FAIL_WINDOW)
            cache.incr(ip_key)
        except Exception:
            _cache_failed()
        raise HttpError(400, "Please enter a correct username and password. Both are case-sensitive.")
    try:
        cache.delete(key)  # the per-address count stays: one good account mustn't wipe a spray's tally
    except Exception:
        pass
    return user


@router.post("/login", auth=None, response=LoginOut, summary="Sign in with a username and password (browser session)")
@retry_after
def sign_in(request, payload: LoginIn):
    _csrf(request)
    user = check_credentials(request, payload.username, payload.password)
    login(request, user)  # new session id and CSRF token
    return {"next": safe_next(request, payload.next)}


@router.post("/logout", auth=None, response={204: None}, summary="Sign out of this browser")
def sign_out(request):
    _csrf(request)
    logout(request)
    return 204, None
