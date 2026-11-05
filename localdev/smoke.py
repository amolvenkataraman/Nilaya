"""Log in to the local instance and hit every page + key JSON endpoints.

    .venv/bin/python localdev/smoke.py      (server must be running: localdev/run.sh)
"""

import datetime as dt
import sys

import requests

BASE = "http://127.0.0.1:8000"
s = requests.Session()
s.get(f"{BASE}/accounts/login/")
r = s.post(f"{BASE}/accounts/login/", data={"username": "amol", "password": "localdev",
           "csrfmiddlewaretoken": s.cookies["csrftoken"]}, headers={"Referer": BASE})
assert "sessionid" in s.cookies, f"login failed ({r.status_code})"

PAGES = [
    "/", "/apps/", "/recent_events", "/accounts/profile/", "/accounts/profile/alex/",
    "/accounts/get_user_info/", "/calendar/", "/calendar/availability/amol/",
    f"/calendar/api/availability/amol/?date={dt.date.today()}", "/calendar/block/?user=amol",
    "/photos/", "/photos/albums/", "/photos/albums/json-list/", "/photos/map/", "/photos/map_new/",
    "/photos/stats/", "/photos/storage/", "/photos/superlatives/", "/photos/search/",
    "/photos/search/cameras/", "/photos/geoguessr/", "/photos/geoguessr_ent/",
    "/photos/date/?date=2026-12-31&nphotos=20", "/map/", "/map/location-groups/", "/map/locations/?group=1",
    "/tasks/", "/habits/", "/contacts/", "/notifications/", "/settings/api-keys/", "/analytics/",
    "/api/v2/me", "/api/v2/tasks/overview", "/api/v2/habits/today", "/api/v2/calendar/agenda?days=7",
    "/api/v2/photos/summary", "/api/v2/places/", "/api/v2/notifications/unread-count", "/api/v2/tasks/guide.md", "/api/v2/contacts/stats",
]
failed = 0
for path in PAGES:
    r = s.get(BASE + path)
    ok = r.status_code < 400
    failed += not ok
    print(f"{'ok ' if ok else 'ERR'} {r.status_code} {path}")

# A thumbnail + full-size file through the signed URLs (Django serving, no nginx)
r = s.get(f"{BASE}/photos/date/?date=2026-12-31&nphotos=5").json()
photos = [p for day in r.get("photos", []) for p in day["photos"]]
if photos:
    p = photos[0]
    for url in (f"/private/{p['thumbnail_hash']}/photo_cache/thumbnail/{p['id']}.webp",
                f"/photo_cdn/{p['photo_hash']}/{p['path']}",
                f"/photo_cdn/{'0' * 32}/{p['path']}"):
        r = s.get(BASE + url)
        expect_ok = "0" * 32 not in url
        ok = (r.status_code == 200) == expect_ok
        failed += not ok
        print(f"{'ok ' if ok else 'ERR'} {r.status_code} {url[:60]}… ({len(r.content)} bytes)")
else:
    print("(no photos yet: skipped file checks)")
sys.exit(1 if failed else 0)
