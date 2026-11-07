"""/api/v2/auth/: browser sign-in and sign-out for the React app (session cookie + CSRF).

These operations run without authentication (auth=None), so Ninja's session auth doesn't check CSRF
for them: each one checks it itself. API keys never sign in here; they're sent on every request.
"""

from django.contrib.auth import authenticate, login, logout
from django.core.cache import cache
from django.utils.http import url_has_allowed_host_and_scheme
from ninja import Field, Router, Schema
from ninja.errors import HttpError
from ninja.utils import check_csrf

router = Router(tags=["auth"])

# Failed sign-ins per username: after 10 within 15 minutes, that name is refused until the window ends.
FAIL_LIMIT, FAIL_WINDOW = 10, 15 * 60


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


class LoginIn(Schema):
    username: str = Field(..., max_length=150)
    password: str = Field(..., max_length=4096)
    next: str = Field("", max_length=2048)


class LoginOut(Schema):
    next: str


@router.post("/login", auth=None, response=LoginOut, summary="Sign in with a username and password (browser session)")
def sign_in(request, payload: LoginIn):
    _csrf(request)
    key = _fail_key(payload.username)
    try:
        failures = cache.get(key, 0)
    except Exception:  # cache down: the limit is a safety net, never a lock-out
        failures = 0
    if failures >= FAIL_LIMIT:
        raise HttpError(429, "Too many failed attempts. Try again in 15 minutes.")
    user = authenticate(request, username=payload.username, password=payload.password)
    if user is None:
        try:
            cache.set(key, failures + 1, FAIL_WINDOW)
        except Exception:
            pass
        raise HttpError(400, "Please enter a correct username and password. Both are case-sensitive.")
    try:
        cache.delete(key)
    except Exception:
        pass
    login(request, user)  # new session id and CSRF token
    return {"next": safe_next(request, payload.next)}


@router.post("/logout", auth=None, response={204: None}, summary="Sign out of this browser")
def sign_out(request):
    _csrf(request)
    logout(request)
    return 204, None
