"""Smoke test of the local instance: public pages signed out, sign-in, every app route, old-URL
redirects, key API endpoints and the signed file URLs.

    .venv/bin/python localdev/smoke.py      (server must be running: localdev/run.sh; app built: frontend/build.sh)
"""

import sys

import requests

BASE = "http://127.0.0.1:8000"
failed = 0


def check(ok, label):
    global failed
    failed += not ok
    print(f"{'ok ' if ok else 'ERR'} {label}")


s = requests.Session()

# Signed out: public pages load, private ones go to the sign-in page, the API says 401.
PUBLIC = ["/login", "/register", "/photos/upload", "/calendar/availability/amol", "/api/v2/photos/public/upload"]
for path in PUBLIC:
    r = s.get(BASE + path, allow_redirects=False)
    check(r.status_code == 200, f"{r.status_code} {path} (signed out)")
for path in ("/", "/tasks?view=today", "/photos/albums"):
    r = s.get(BASE + path, allow_redirects=False)
    check(r.status_code == 302 and r.headers["Location"].startswith("/login?next="), f"{r.status_code} {path} -> {r.headers.get('Location')}")
check(s.get(BASE + "/api/v2/me").status_code == 401, "401 /api/v2/me (signed out)")

# Sign in through the API, like the app's /login page.
r = s.post(f"{BASE}/api/v2/auth/login", json={"username": "amol", "password": "localdev", "next": "/tasks"},
           headers={"X-CSRFToken": s.cookies["csrftoken"], "Referer": BASE})
check(r.status_code == 200 and r.json().get("next") == "/tasks" and "sessionid" in s.cookies, f"{r.status_code} sign in")
if "sessionid" not in s.cookies:
    sys.exit(1)

ROUTES = [
    "/", "/calendar", "/calendar/availability/alex", "/tasks", "/habits", "/habits/progress", "/contacts", "/places",
    "/photos", "/photos/albums", "/photos/map", "/photos/stats", "/photos/storage", "/photos/superlatives",
    "/photos/browse", "/photos/geoguessr", "/photos/locate", "/photos/upload", "/notifications", "/settings",
    "/settings/usage", "/users/alex",
]
for path in ROUTES:
    r = s.get(BASE + path, allow_redirects=False)
    check(r.status_code == 200 and 'name="avn-session" content="1"' in r.text, f"{r.status_code} {path}")

REDIRECTS = {
    "/app/": "/", "/app/tasks?view=today": "/tasks?view=today", "/accounts/login/": "/login", "/map/": "/places",
    "/settings/api-keys/": "/settings#set-api", "/analytics/": "/settings/usage", "/photos/map_new/": "/photos/map",
    "/photos/day/2026/1/2/": "/photos/day/2026-01-02", "/accounts/profile/alex/": "/users/alex",
}
for old, new in REDIRECTS.items():
    r = s.get(BASE + old, allow_redirects=False)
    check(r.status_code == 301 and r.headers.get("Location") == new, f"{r.status_code} {old} -> {r.headers.get('Location')}")

API = [
    "/api/v2/me", "/api/v2/tasks/overview", "/api/v2/habits/today", "/api/v2/calendar/agenda?days=7",
    "/api/v2/calendar/calendars", "/api/v2/photos/summary", "/api/v2/photos/superlatives/biggest-files?limit=20",
    "/api/v2/places/", "/api/v2/notifications/unread-count", "/api/v2/tasks/guide.md", "/api/v2/contacts/stats",
    "/api/v2/calendar/availability/alex?date=2026-11-09",
]
for path in API:
    r = s.get(BASE + path)
    check(r.status_code == 200, f"{r.status_code} {path}")

# Public calendar and shared album pages for whatever exists locally.
pub = [c for c in s.get(f"{BASE}/api/v2/calendar/calendars").json() if c.get("public")]
if pub:
    check(s.get(f"{BASE}/api/v2/calendar/public/calendars/{pub[0]['id']}").status_code == 200, "public calendar API")
albums = [a for a in s.get(f"{BASE}/api/v2/photos/albums").json() if a["public"]]
if albums:
    check(requests.get(f"{BASE}/api/v2/photos/public/albums/{albums[0]['id']}").status_code == 200, "public album API (signed out)")

# A thumbnail + full-size file through the signed URLs (Django serving, no nginx).
items = s.get(f"{BASE}/api/v2/photos/timeline?limit=5").json()["items"]
if items:
    p = items[0]
    for url, expect_ok in ((p["thumb_url"], True), (p["url"], True),
                           ("/photo_cdn/" + "0" * 32 + "/" + p["url"].split("/", 3)[3], False)):
        r = s.get(BASE + url)
        check((r.status_code == 200) == expect_ok, f"{r.status_code} {url[:60]}… ({len(r.content)} bytes)")
else:
    print("(no photos yet: skipped file checks)")

r = s.post(f"{BASE}/api/v2/auth/logout", headers={"X-CSRFToken": s.cookies["csrftoken"], "Referer": BASE})
check(r.status_code == 204 and s.get(BASE + "/api/v2/me").status_code == 401, f"{r.status_code} sign out")
sys.exit(1 if failed else 0)
