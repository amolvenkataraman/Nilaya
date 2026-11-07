# Upgrade: new UI only, served at `/`

The React app moves from `/app/` to the site root and becomes the only interface. The classic
Django-template pages, their JS/CSS, the vendored third-party files and the legacy JSON endpoints are
gone. Same setup as [UPGRADE-phase-1.md](UPGRADE-phase-1.md): code in `/opt/Comptech`, venv
`CT_env`, tmux session `Comptech` (Daphne, Celery worker, Celery beat), nginx, Postgres `Comptech`.
Time needed: about 15 minutes. **No database migrations**, so rolling back is just code.

## What changed for deployment

| Thing | Action needed |
|---|---|
| Every page URL is the React app (`Comptech/spa.py`); Django answers only `/api/`, `/admin/`, `/feeds/` (and `/static/`, `/media/`, `/private/`, `/photo_cdn/`, `/.well-known/`, `/dav/` are never the app) | None: nginx already proxies `location /` to Daphne |
| The app's build (`static_files/static/app/`) is now required for every page, including sign-in. Without it every page answers 503 "isn't built on this server yet" | Build and rsync it **before** restarting (step 3) |
| Sign-in is the app's `/login` page on `POST /api/v2/auth/login`; `LOGIN_URL` is `/login` | None. Django admin keeps its own sign-in at `/admin/login/` |
| Old URLs (`/app/…`, `/accounts/login/`, `/map/`, `/settings/api-keys/`, `/analytics/`, `/photos/day/y/m/d/`, `/photos/?album=<id>`, `/contacts/?id=<id>`, …) answer **301** to the new routes, query string kept | None. Bookmarks and old notification links keep working |
| Third-party front-end files (`static_files/vendor.lock`, `fetch_vendor.sh`) are gone: nothing uses Bootstrap, jQuery, moment, Handlebars, croppie, Chart.js or the old Leaflet copies | Delete the downloaded folders (step 4); `fetch_vendor.sh` no longer exists |
| Python packages no longer used: `dateparser`, `whitenoise`, `piexif`, `django-import-export`, `django-crispy-forms`, `crispy-bootstrap4` | `pip install -r requirements.txt` adds nothing; uninstalling the old ones is optional (step 2) |
| nginx | **No changes needed.** The three `location /static/…` blocks stay: `/static/app/assets/` (hashed, cached forever), `/static/app/` (theme.js and favicon, revalidated) and `/static/` (admin). `index.html` is served by Django with `Cache-Control: no-cache`, so a deploy is picked up on the next page load |
| Celery tasks send notification links to the new routes (`/tasks?task=…`, `/contacts?person=…`, `/photos/albums/<id>`, `/settings#set-api`) | Restart the worker and beat with Daphne (step 5) |
| ICS feeds (`/feeds/f_….ics`), API keys, signed photo URLs | Unchanged |

### Behaviour changes people will notice
- **Signing in** happens on the app's own page (`/login`), with the same accounts and passwords. After 10 wrong passwords for a username within 15 minutes, that username is refused until the window ends (Redis keeps the count; if Redis is down, there's no limit).
- **Public pages work without signing in**, as they did on the classic site: a public calendar (`/calendar/public/<id>`, with a Subscribe button when signed in), a countdown (`/calendar/countdown/<id>/start` or `/end`), someone's availability (`/calendar/availability/<username>`), a public shared album (`/shared/albums/<id>`, the new share link) and the upload portal (`/photos/upload`). Private events still show only as "Busy", and hidden photos never show.
- **The upload portal** is the same: open to anyone with the link while `ALLOW_PHOTO_UPLOADS = True`, files land untouched in `UPLOADS_DIR`, and the recipient name comes from `upload_recipient_name` in `site.json`. Nothing is imported automatically and no notification is sent (as before).
- **Superlatives** has all 11 rankings in the app (longest videos, original videos, highest resolution, largest photos, overhead gap, RAW files, most video time in a day were classic-only), with a Top 20/50/100/200 picker and bulk delete.
- **Photos filters** gain "In this map area" (from Photos › Map and Places), camera make, sharpness and oldest first; heat maps gain "every year up to", an altitude ceiling and a library filter.
- **Usernames** can be changed in Settings › Profile again.
- **`/calendar/block/?user=` is gone.** It told anyone, signed out, the categories of a person's current events, ignoring their busy-sharing settings and private events. Use the availability endpoint instead (below).
- Usage analytics now counts page loads per app route (`tasks`, `places`, `settings`, …) instead of one `app` bucket, and no longer counts redirects.

## Step by step

### 1. Back up and note the current commit
```bash
cd /opt/Comptech
pg_dump -h 127.0.0.1 -U postgres Comptech > ~/comptech-backup-$(date +%F).sql   # nothing migrates, but be safe
git rev-parse HEAD > ~/comptech-previous-commit
```

### 2. Get the code and packages
```bash
git fetch && git checkout master && git pull
source CT_env/bin/activate
pip install -r requirements.txt
pip uninstall -y dateparser whitenoise piexif django-import-export django-crispy-forms crispy-bootstrap4   # optional
python manage.py check          # must not show mainsite.W001
python manage.py migrate        # "No migrations to apply"
```
Don't restart yet: the running Daphne still serves the old code until step 5, and the new code needs the new build.

### 3. Build the app and copy it to the server
On your computer, in the repo at the same commit (Node 20.19+, 22 recommended):
```bash
frontend/build.sh
rsync -av --delete static_files/static/app/ server:/opt/Comptech/static_files/static/app/
```

### 4. Static files
```bash
cd /opt/Comptech
rm -rf static_files/static/css static_files/static/js static_files/static/vendor static_files/static/images static_files/static/sound
python manage.py collectstatic --noinput --clear   # --clear drops the classic files from /www/static; admin and the app are copied again
ls /www/static/app/index.html /www/static/app/assets | head -3
```

### 5. Restart Daphne, the Celery worker and beat
```bash
tmux kill-session -t Comptech
/opt/Comptech/Comptech.sh
tmux attach -t Comptech        # window 0: "Listening on TCP address 127.0.0.1:8000"; windows 2 and 3: Celery up
```

### 6. Check it
Signed out, in a private window:
- `https://<your-site>/` goes to `/login?next=/`; a wrong password shows an error; signing in lands on Home.
- `https://<your-site>/tasks?view=today` signed out goes to `/login?next=…` and, after signing in, back to Today.
- `https://<your-site>/app/` and `/accounts/login/` redirect to `/` and `/login`.
- A public calendar (`/calendar/public/<id>`), a countdown (from an event on it: Event → Countdown to start), a public album (Photos › Albums › a public album › Copy link) and `/photos/upload` open without signing in.

Signed in:
- Open every app from the launcher; toggle dark mode; open the bell and click a notification from before the upgrade (old links redirect).
- Settings › Developer: `curl -H "Authorization: Bearer <key>" https://<your-site>/api/v2/tasks/overview` still answers JSON.
- `https://<your-site>/admin/` signs in with Django's own page.
- Photos › Superlatives › Longest videos loads; Photos › Map › "Photos in this area" opens a filtered timeline.
- Log out from the account menu; the next page is `/login`.

On the server: `tail` Daphne's window for 500s while you click around, and check nginx's error log.

## Removed endpoints and their V2 replacements (for Planner and other scripts)

All V2 endpoints live under `/api/v2/`, take an API key (`Authorization: Bearer avn_…`, created in
Settings › Developer with read or write access per app) or the browser session plus `X-CSRFToken`, and
answer JSON with ISO 8601 datetimes. Each app's full reference is at `/api/v2/<app>/guide.md` and
`/api/v2/docs`. Old endpoints that a script calls now get the app's HTML (a 302 to `/login` when signed
out) or a 301, never their old JSON, so check every call.

**Signing in from a script:** use an API key. (A browser-style session still works: `GET /login` for the
`csrftoken` cookie, then `POST /api/v2/auth/login` with JSON `{"username", "password"}` and the
`X-CSRFToken` header; `POST /api/v2/auth/logout` to end it.)

### Calendar (`/calendar/…`)
| Removed | Replacement |
|---|---|
| `GET /calendar/api/events/?month=&year=` | `GET /api/v2/calendar/events?start=<ISO>&end=<ISO>` (repeating events expanded; optional `calendar=<id>`, `q=`, `tag=`) + `GET /api/v2/calendar/calendars` (colours, roles) + `GET /api/v2/contacts/birthdays?start=&end=` + `GET /api/v2/tasks/?view=upcoming` + `GET /api/v2/photos/counts?start=&end=` |
| `GET /calendar/api/calendarevents/?calendar=&timespan=&time=` | Subscribers: `GET /api/v2/calendar/events?calendar=<id>&start=&end=`. Anyone, public calendars: `GET /api/v2/calendar/public/calendars/<id>/events?start=&end=` (≤ 100 days) |
| `GET/POST /calendar/api/calendar/` | `GET/PATCH /api/v2/calendar/calendars/<id>` (`{"active": …}`), `POST /api/v2/calendar/calendars`, `GET /api/v2/calendar/calendars/<id>/subscribers`, `…/invites` |
| `GET /calendar/api/availability/<user>/?date=` | `GET /api/v2/calendar/availability/<user>?date=YYYY-MM-DD` (no sign-in needed) → `{"username", "name", "date", "busy": [{"start", "end"}]}` (was `[[start, end]]`; days are cut in that person's time zone) |
| `GET /calendar/block/?user=` | None (privacy leak). Use the availability endpoint |
| `POST /calendar/api/sync/` | `POST /api/v2/calendar/calendars/<id>/sync` |
| `POST /calendar/api/visibility/` | `PATCH /api/v2/calendar/calendars/<id>` `{"visible": …}` |
| `POST /calendar/api/create/` | `POST /api/v2/calendar/events`; edit: `PATCH /api/v2/calendar/events/<id>?scope=this\|following\|all` |
| `POST /calendar/api/duplicate/` | `POST /api/v2/calendar/events/<id>/duplicate?days=` |
| `POST /calendar/api/delete/` | `DELETE /api/v2/calendar/events/<id>?scope=` |
| `POST /calendar/api/todo/<cmd>/` | `/api/v2/tasks/`: `POST /`, `PATCH /<id>`, `POST /<id>/done`, `DELETE /<id>` |
| `GET/POST /calendar/api/subscribe/?code=` | `POST /api/v2/calendar/subscribe?code=` (no preview step); a public calendar by id: `POST /api/v2/calendar/public/calendars/<id>/subscribe` |
| `POST /calendar/api/unsubscribe/` | `DELETE /api/v2/calendar/calendars/<id>/subscription` |
| `POST /calendar/api/invite/` | `POST /api/v2/calendar/calendars/<id>/invites`, `PATCH`/`DELETE …/invites/<invite_id>` |
| `GET /recent_events` | `GET /api/v2/calendar/agenda?days=7` + `GET /api/v2/tasks/overview` |
| Countdown page data | `GET /api/v2/calendar/public/countdown/<event_id>?which=start\|end` |

### Photos (`/photos/…`)
| Removed | Replacement |
|---|---|
| `GET /photos/date/?date=&nphotos=&ndays=&…` | `GET /api/v2/photos/timeline?before=<ISO>&limit=` (newest first, keyset pages: pass `next_before` and `next_before_id` back). Filters: `video`, `country`, `city`, `camera` (model), `camera_make`, `objects`, `q`, `north/south/east/west` (was `bounds`), `min_blur/max_blur`, `after`, `order=oldest` (was `forward=1`). Per-day totals: `GET /api/v2/photos/days?start=&end=`. Free-text search: `GET /api/v2/photos/search?q=` |
| `GET /photos/?album=<id>`, `/photos/date/?album=` | Members: `GET /api/v2/photos/albums/<id>/photos`. Anyone, public albums: `GET /api/v2/photos/public/albums/<id>` and `…/<id>/photos` |
| `GET /photos/photo/<id>/info/` | `GET /api/v2/photos/<id>` or `…/<id>/details` (EXIF, objects) |
| `GET /photos/photo/<id>/thumbnail/` | The `thumb_url` in any photo object (signed `/private/…` URL, served by nginx) |
| `GET /photos/albums/json-list/` | `GET /api/v2/photos/albums` |
| `POST /photos/albums/create/`, `…/<id>/edit/`, `…/<id>/set-cover/` | `POST /api/v2/photos/albums`, `PATCH /api/v2/photos/albums/<id>` (`name`, `description`, `public`, `cover_photo_id`), `DELETE …/<id>` |
| `GET/POST /photos/albums/<id>/subscribers/` | `GET/POST /api/v2/photos/albums/<id>/members`, `PATCH`/`DELETE …/members/<member_id>` |
| `POST /photos/albums/add/`, `…/remove/` | `POST`/`DELETE /api/v2/photos/albums/<id>/photos` `{"ids": […]}` |
| `POST /photos/albums/toggle-visibility/<id>/`, `…/display-only/<id>/` | `PATCH /api/v2/photos/libraries/<id>` `{"visible": …}`, `POST /api/v2/photos/libraries/<id>/only` |
| `GET /photos/map/?vals=1&year=…`, `/photos/map_new/?vals=1` | `GET /api/v2/photos/points?south=&west=&north=&east=&year=&until_year=&max_alt=&library_id=&include_planes=` → `[{"lat", "lng", "count"}]` |
| Stats, storage, superlatives, search pages | `GET /api/v2/photos/stats`, `…/storage`, `…/superlatives/<category>?limit=`, `…/browse/<cities\|countries\|cameras\|objects>` |
| `POST /photos/ingest/` | `POST /api/v2/photos/ingest` |
| `POST /photos/delete/<id>/` | `POST /api/v2/photos/delete` `{"ids": […]}` (browser session only) |
| `POST /photos/delete-original/<id>/` | `POST /api/v2/photos/<id>/delete-original` (browser session only) |
| `POST /photos/upload/` | `POST /api/v2/photos/public/upload` (multipart field `files`, CSRF token; `GET` for the recipient and allowed types) |

### Places (`/map/…`)
| Removed | Replacement |
|---|---|
| `GET /map/location-groups/`, `POST …/add/` | `GET`/`POST /api/v2/places/groups`, `PATCH`/`DELETE …/groups/<id>` |
| `GET /map/locations/?group=` | `GET /api/v2/places/?group=<id>` (also `q`, `category`, `status`, map box); light map pins: `GET /api/v2/places/pins` |
| `POST /map/locations/add/`, `…/<id>/edit/`, `…/<id>/delete/` | `POST /api/v2/places/`, `PATCH`/`DELETE /api/v2/places/<uuid>` |
| `GET /map/nominatim/search/?q=` | `GET /api/v2/places/geocode?q=` |

### Accounts (`/accounts/…`)
| Removed | Replacement |
|---|---|
| `POST /accounts/login/`, `/accounts/logout/` | `POST /api/v2/auth/login`, `POST /api/v2/auth/logout` (browser), or an API key |
| `GET /accounts/get_user_info/` | `GET /api/v2/me` |
| `POST /accounts/profile/` | `PATCH /api/v2/me` (`username`, `first_name`, `last_name`, `description`, `birthday`, `timezone`) |
| `GET /accounts/profile/<user>/` | `GET /api/v2/users/<username or id>` |
| `GET/POST /accounts/profile_picture/` | `profile_picture` in `/api/v2/me` and `/api/v2/users/<u>` (a media URL); `POST /api/v2/me/picture` `{"data_url"}` |
| `POST /accounts/change_password/` | `POST /api/v2/me/password` `{"old", "new"}` (browser session only) |

## Rolling back
Nothing in the database changed, so only the code and the build go back:
```bash
tmux kill-session -t Comptech
cd /opt/Comptech && git checkout "$(cat ~/comptech-previous-commit)"
pip install -r requirements.txt          # puts back crispy-forms etc.
static_files/fetch_vendor.sh             # the old commit still has it
```
Rebuild the old app on your computer at that commit (`frontend/build.sh`, rsync as in step 3), then
`python manage.py collectstatic --noinput` and `/opt/Comptech/Comptech.sh`.
