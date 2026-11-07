> **Newer upgrade:** after this one, follow [UPGRADE-new-ui-only.md](UPGRADE-new-ui-only.md) (the app moves to `/`, the classic pages and `fetch_vendor.sh` go away). The `/app/` paths and vendor steps below are as of phase 1.

# Upgrading the server to `improve/phase-1`

Same setup as the last guide: code in `/opt/Comptech`, venv `/opt/Comptech/CT_env`, tmux session `Comptech` started by `Comptech.sh` (window 0 Daphne via `make`, window 2 Celery worker, window 3 Celery beat), nginx in front, Postgres DB `Comptech`. Time needed: about 30 minutes, plus 10 for the rehearsal (step 0, strongly recommended: everything was tested on SQLite, not yet on Postgres).

## What changed for deployment

| Thing | Action needed |
|---|---|
| New Python packages `django-ninja` (V2 API) and `icalendar` (replaces `ics`, which ignored repeating events); `psycopg[pool]` (database connection pool) and `redis` (shared cache) | `pip install -r requirements.txt` (step 4); `pip uninstall ics` is optional |
| **Database connection pool**: requests reuse open Postgres connections instead of connecting and authenticating each time | None. If anything looks wrong with database connections, start with `COMPTECH_DB_POOL=0` to turn it off |
| **Shared cache in Redis** (database 2 of the Redis you already run for Celery and channels): slow photo stats/summary/storage pages are cached and cleared whenever photos change | None; Redis must be running, as it already must be |
| **Static files get content hashes in their names** (`styles.4f1c2a9b.css`). nginx caches `/static/` forever, so before this, browsers kept old CSS/JS after an upgrade | None beyond `make cs` (step 7), which now also writes `staticfiles.json`. Old cached copies are simply no longer used |
| **nginx**: gzip for static files, HTTP/2, and cache rules for the new interface | Copy the changes from the repo's `nginx.conf` into your live config (step 8) |
| Bootstrap 5.3.3 and Leaflet.markercluster 1.5.3 added to `vendor.lock`; old Bootstrap 5.0-beta and 5.1.3 removed | Run `fetch_vendor.sh`, then delete the old folders (step 5) |
| New apps: `tasks`, `apikeys`, `feeds`, `analytics`, `habits`, `contacts` | Nothing extra; they come with migrations (step 6) |
| Migrations: notifications 0003–0004, scheduler 0032–0038, tasks 0001, photos 0024–0029, map 0004–0005, users 0005, apikeys 0001, feeds 0001, analytics 0001, habits and contacts 0001 | `migrate` (step 6) |
| **Calendar schema overhaul** (scheduler 0034–0038) | Converts every event: kind, all-day dates, your categories (from the old numbers), sync windows, visibility; old priority/completed values are kept in each event's metadata; ownership inconsistencies fixed. Check with `calendar_migration_report` afterwards (step 6) |
| **Materialized views now live in migrations** (photos 0025–0027) | 0025 drops your hand-made `photos_photo_location_cache` and recreates it (hidden photos left out, plus a unique index); 0026 adds `photos_photo_daily`; 0027 sets the plane cut-off to 2000 m. Runs as your DB user, which owns the view. Nothing manual any more |
| `photos 0029` leaves photos with a coordinate of exactly 0 out of the heat map (broken phone GPS: the right latitude with longitude 0.0 put Waterloo photos in France) | None (recreates the view in a second or two) |
| `photos 0028` adds two photo indexes (taken date for the timeline, latitude/longitude for photos near a place) | None. Each builds in about a second on ~300k photos and blocks writes (ingest) only while it runs, so don't run an ingest during `migrate` |
| `users 0005` removes the `dark_mode` column | None (dark mode is per device now) |
| Celery beat schedules (reminders, notification clean-up, habits, contacts, **calendar auto-sync every 30 minutes**) | Restart beat (step 9); the schedules register themselves. If you once added a calendar sync task by hand in Django admin → Periodic tasks (`scheduler.tasks.autosync_calendars` under another name), delete it, or calendars sync twice |
| New URLs `/api/v2/`, `/tasks/`, `/habits/`, `/contacts/`, `/settings/api-keys/`, `/feeds/…ics`, `/analytics/`, `/app/` | None if nginx proxies everything to Daphne (it does). API keys use the `Authorization` header, which nginx passes through by default |
| New React interface at `/app/` | Built on your computer and copied with rsync (step 7). Until then `/app/` shows "isn't built on this server yet" |
| Email delivery for notifications (optional) | Set `EMAIL_HOST`/`EMAIL_HOST_USER` in settings and put the password in `Comptech/email_password.txt` |
| **Site settings moved out of the code**: `SITE_URL` (links in notifications and feeds), the hostnames/IPs the site answers to (`CSRF_TRUSTED_ORIGINS`, which also sets `ALLOWED_HOSTS`), `INTERNAL_IPS` and the email From address now come from an untracked `Comptech/site.json`. Without it the code falls back to `example.com` | **Create `Comptech/site.json` before starting the app (step 4)**, or every page answers **400 Bad Request**. `python manage.py check` warns (`mainsite.W001`) while it's missing |
| **Daphne listens on `127.0.0.1:8000`** (was `0.0.0.0:8000`), so Django is reachable only through nginx | None if you always go through nginx. If you open `http://<server>:8000` directly from the LAN, see step 9 |
| The classic Geoguessr and location-entry pages are gone; `/photos/geoguessr/` and `/photos/geoguessr_ent/` redirect to the new interface (`/app/photos/geoguessr`, `/app/photos/locate`) | None |

### Behaviour changes users will notice
- **Deleting photos** (and deleting originals) and **setting photo locations** in the location-entry tool now need owner or editor access to the library; viewers could do both before.
- **Dark mode** is chosen per device from the user menu (the old per-account switch is gone).
- **Calendar categories** are now named, per-owner categories made from the old numbers; repeating events from ICS/Google feeds keep their rules.
- **Heatmaps** leave out photos taken at 2000 m and up (was over 1000 m), and photos whose GPS has a coordinate of exactly 0 (broken fix). Those show "Add location" in the new viewer and are listed by the location tool's "Only broken GPS" filter.
- **Location saves and hiding** update the heat map within about 15 seconds (queued in Celery, once per burst) instead of during the request.
- **Places in the new interface** start with every existing group hidden; each person turns on the groups they want (like calendars). A group you create is shown on your map. Owners can archive groups.
- **Calendar sync** can be set up from the new interface (New calendar → Sync from a link, or a calendar's settings → Sync), with a preview, V1's range sync ("Sync a range…", with the term presets and a Google access token) and auto-sync every 30 minutes. `webcal://` links now work. Links pointing at the server itself (localhost) or link-local addresses are refused; LAN addresses (e.g. Nextcloud) still work.
- **Privacy fixes**: other people's private events show only as "Busy" in your ICS feed, in tasks made from events, and in insights' top locations.
- **Calendar invites** that grant admin can only be changed or deleted by the calendar's owner.
- **Tasks**: someone made read-only in (or removed from) a project can no longer edit the tasks they created there; undoing a repeating task's completion moves its dates back; priority 0 shows as "None".
- **Places**: everyone's map looks empty at first (existing groups start hidden); tell the family to switch on their groups.
- **Tasks**: assignees must be members of the task's project; view-only members can't add comments, subtasks or links; an assignee can unassign themselves.
- **Logging in as before**; new apps (Tasks, Habits, Contacts) and the new interface at `/app/` appear in the app launcher.

## Step by step

### 0. Rehearse on a copy of production (recommended)
The migrations were tested on SQLite only. This runs them on a throwaway copy of your real database first; the live `Comptech` DB isn't touched. The new code goes into a separate folder (a git worktree), not `/opt/Comptech`: the running app reads templates and lazily imported code from its own folder, so switching branches there would mix old and new code while it runs.
```bash
cd /opt/Comptech
pg_dump -h 127.0.0.1 -U postgres Comptech > ~/comptech-rehearsal.sql
createdb -h 127.0.0.1 -U postgres Comptech_rehearsal
psql -h 127.0.0.1 -U postgres -q Comptech_rehearsal < ~/comptech-rehearsal.sql
git fetch && git worktree add ~/comptech-rehearsal origin/improve/phase-1   # or origin/master after the merge
export COMPTECH_SECRETS_DIR=/opt/Comptech/Comptech   # read secret.txt etc. from the live folder (no copies)
source CT_env/bin/activate && pip install -r ~/comptech-rehearsal/requirements.txt   # only adds packages; the running app keeps working
cd ~/comptech-rehearsal
COMPTECH_DB_NAME=Comptech_rehearsal python manage.py migrate
COMPTECH_DB_NAME=Comptech_rehearsal python manage.py calendar_migration_report   # expect "No inconsistencies found"
cd /opt/Comptech
dropdb -h 127.0.0.1 -U postgres Comptech_rehearsal && rm ~/comptech-rehearsal.sql
git worktree remove --force ~/comptech-rehearsal && unset COMPTECH_SECRETS_DIR
```
Also check, while the copy exists:
```bash
psql -h 127.0.0.1 -U postgres Comptech_rehearsal -c "SELECT count(*) FROM scheduler_event WHERE repeat_every IS NOT NULL;"
```
V1 never used `repeat_every` (no screen set it, and those events always showed once), but the migration turns such rows into real "every N days" series. If this finds rows that weren't meant to repeat, clear the field on the live database before step 6 (`UPDATE scheduler_event SET repeat_every = NULL WHERE …`), or afterwards set `rrule = ''` on them (the original values stay in `custom_info.legacy_repeat`).

If `migrate` fails here, stop and send me the error; production is unaffected.

### 1. Back up
```bash
cd /opt/Comptech
pg_dump -h 127.0.0.1 -U postgres Comptech > ~/comptech-backup-$(date +%F).sql
ls -lh ~/comptech-backup-*.sql            # should be non-empty
git rev-parse HEAD > ~/comptech-previous-commit
```

### 2. Stop the app (including Celery worker and beat, so no sync runs mid-migration)
```bash
tmux attach -t Comptech        # Ctrl-C in windows 0, 2 and 3, then detach (Ctrl-b d)
```

### 3. Get the code
```bash
cd /opt/Comptech
git fetch && git checkout master && git pull     # after the PR is merged
```

### 4. Python packages
```bash
source CT_env/bin/activate
pip install -r requirements.txt
python -c "import django, celery; print(django.get_version(), celery.__version__)"   # Django must be 5.1.x or 5.2.x
```
Django is pinned to `>=5.1,<6` (the connection pool needs 5.1+; 6.0 won't start). If Celery is older than 5.3, or anything looks off with database connections, run with `COMPTECH_DB_POOL=0`.

**Postgres setting (recommended):** turn off query JIT, which can spend far longer compiling than running small queries:
```bash
psql -h 127.0.0.1 -U postgres -c "ALTER SYSTEM SET jit = off;" -c "SELECT pg_reload_conf();"
```

**Site settings (required):** create `Comptech/site.json` (same folder as `secret.txt`, untracked) with your real values. To keep production exactly as it was, copy them from the old `Comptech/settings.py`:
```bash
git show "$(cat ~/comptech-previous-commit)":Comptech/settings.py | grep -E "SITE_URL|CSRF_TRUSTED_ORIGINS|INTERNAL_IPS|DEFAULT_FROM_EMAIL"
```
```json
{
  "site_url": "https://app.example.com",
  "csrf_trusted_origins": ["https://app.example.com", "https://lab.example.com",
                           "http://app.home.lan", "https://app.home.lan",
                           "http://192.168.50.10", "https://192.168.50.10"],
  "internal_ips": ["127.0.0.1", "192.168.50.10"],
  "default_from_email": "AVNet Superapp <noreply@example.com>"
}
```
- `csrf_trusted_origins`: every address people open the site with, as `scheme://host` (no port, no path). `ALLOWED_HOSTS` is built from these plus `localhost` and `127.0.0.1`; any other Host gets 400.
- `upload_recipient_name` and `preferred_library_keyword` (in earlier versions of this guide) are no longer used: the upload page and the `photos/importables.py` shell helpers were removed. Delete them from `site.json` if you have them.
- Every key is optional; a missing key uses the `example.com` default. A JSON syntax error stops the app at start-up with the file name, instead of running with the wrong hosts.
```bash
chmod 600 Comptech/site.json
python manage.py check                # must not show mainsite.W001
python -c "import django,os;os.environ['DJANGO_SETTINGS_MODULE']='Comptech.settings';django.setup();from django.conf import settings as s;print(s.SITE_URL, s.ALLOWED_HOSTS)"
```

**Location-entry spots (optional):** your one-click save buttons and map focus buttons now live in an untracked file, `Comptech/photos_locate.json` (same folder as `secret.txt`), not in the code:
```json
{"presets": [{"label": "Home", "lat": 0.0, "lng": 0.0}],
 "focus":   [{"label": "City", "lat": 0.0, "lng": 0.0, "zoom": 15}]}
```

### 5. Front-end libraries
```bash
static_files/fetch_vendor.sh          # every line must say "ok"
rm -rf static_files/static/css/bootstrap static_files/static/js/bootstrap static_files/static/vendor/bootstrap-5.1.3
```

### 6. Database
```bash
python manage.py migrate
python manage.py calendar_migration_report --json > ~/calendar-migration-report.json   # keep it: it records original values
python manage.py calendar_migration_report   # read-only summary: look for "No inconsistencies found" and the normalisation counts
```

### 7. The new interface, static files and the one-off thumbnail fix
On your computer, in the repo at the same commit (Node 20.19+; `build.sh` uses nvm if you have it):
```bash
frontend/build.sh                     # npm ci, tests, build into static_files/static/app/ (+ .gz copies for nginx)
rsync -av --delete static_files/static/app/ server:/opt/Comptech/static_files/static/app/
```
Then on the server:
```bash
make cs                               # collectstatic into /www/static (hashed names + staticfiles.json, includes /app/)
python manage.py fix_orientation --dry-run    # shows what would change
python manage.py fix_orientation              # fixes sideways photo/video thumbnails (once)
```

### 8. nginx
The repo's `nginx.conf` is a template with `example.com` placeholders (see its header). Copy the `gzip …`, `listen 443 ssl http2;` and the three `location /static/…` blocks from it into your live config (keep your real `server_name`, certificate paths and `secure_link_secret`), then:
```bash
sudo nginx -t && sudo systemctl reload nginx
```

### 9. Start everything
```bash
tmux kill-session -t Comptech
/opt/Comptech/Comptech.sh
tmux attach -t Comptech               # window 0: "Listening on TCP address 127.0.0.1:8000"; windows 2 and 3: Celery up
```
Daphne now listens only on `127.0.0.1` (nginx's `proxy_pass http://127.0.0.1:8000` is unchanged). If you, or anything on the LAN, used `http://<server>:8000` directly, either switch to the nginx address, or keep the old behaviour by changing window 0's command in `Comptech.sh` from `make` to `make DAPHNE_BIND=0.0.0.0`.

### 10. Check it (and note the optional hardening below)
- Sign in, then open Home, Calendar, Tasks, Habits, Contacts, Photos, Places and Notifications. Toggle dark mode in the user menu.
- Notifications → add a channel (e.g. ntfy) → **Send test**.
- Settings → API keys: create a key with Tasks read access, then
  `curl -H "Authorization: Bearer <key>" https://<your-site>/api/v2/tasks/overview` should return JSON; revoke the key afterwards.
- Within a minute, Celery beat's log should show the reminder tasks running; within 30 minutes, `autosync_calendars`.
- A synced calendar → settings → Sync → **Sync now** shows "Synced" (or the feed's error).
- Photos → Map shows the heat map; Photos → Stats loads (the second visit is instant: cached).

## Optional hardening (only if the site is always reached over HTTPS)
Django's deploy check suggests these; they're not on by default because a plain-HTTP LAN visit would then fail to log in:
```python
SESSION_COOKIE_SECURE = True
CSRF_COOKIE_SECURE = True
SECURE_HSTS_SECONDS = 31536000   # only once you're sure HTTPS works everywhere; browsers remember it
```

## Recommended hardening: a dedicated database role
The app connects as `postgres`, a superuser, so a bug in the app could do anything to every database on the server. A role that owns only the `Comptech` database is enough for the app, including migrations and the materialized-view refreshes:
```bash
psql -h 127.0.0.1 -U postgres <<'SQL'
CREATE ROLE comptech LOGIN PASSWORD 'choose-a-long-random-password';
ALTER DATABASE "Comptech" OWNER TO comptech;
\c Comptech
ALTER SCHEMA public OWNER TO comptech;
-- Hand over the tables (their sequences and indexes follow), views and materialized views.
DO $$DECLARE r record; BEGIN
  FOR r IN SELECT format('ALTER %s public.%I OWNER TO comptech',
                         CASE c.relkind WHEN 'v' THEN 'VIEW' WHEN 'm' THEN 'MATERIALIZED VIEW' ELSE 'TABLE' END, c.relname) AS q
           FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm')
  LOOP EXECUTE r.q; END LOOP;
END$$;
SQL
```
Then put that password in `Comptech/db_password.txt`, change `'USER': 'postgres'` to `'comptech'` in `DATABASES` (`Comptech/settings.py`), restart, and keep using `postgres` only for backups and admin. Do it in a quiet window and test the rollback steps first; nothing in this upgrade depends on it.

## Updating only the new interface later
Build on your computer (`frontend/build.sh`), then `rsync -av --delete static_files/static/app/ server:/opt/Comptech/static_files/static/app/` and `make cs` on the server. No restart needed.

## Rolling back
Rolling back means restoring the backup, which loses anything created after the deploy, so decide go/no-go quickly.
```bash
tmux kill-session -t Comptech
git checkout "$(cat ~/comptech-previous-commit)"
pip install -r requirements.txt       # puts back anything the old code needs (e.g. ics, if you uninstalled it)
psql -h 127.0.0.1 -U postgres -c 'DROP DATABASE "Comptech"' && psql -h 127.0.0.1 -U postgres -c 'CREATE DATABASE "Comptech"'
psql -h 127.0.0.1 -U postgres Comptech < ~/comptech-backup-<date>.sql
static_files/fetch_vendor.sh && make cs
/opt/Comptech/Comptech.sh
```
