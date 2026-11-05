# Upgrading the server to `improve/phase-1`

Same setup as the last guide: code in `/opt/Comptech`, venv `/opt/Comptech/CT_env`, tmux session `Comptech` started by `Comptech.sh` (window 0 Daphne via `make`, window 2 Celery worker, window 3 Celery beat), nginx in front, Postgres DB `Comptech`. Time needed: about 30 minutes, plus 10 for the rehearsal (step 0, strongly recommended: everything was tested on SQLite, not yet on Postgres).

## What changed for deployment

| Thing | Action needed |
|---|---|
| New Python packages `django-ninja` (V2 API) and `icalendar` (replaces `ics`, which ignored repeating events) | `pip install -r requirements.txt` (step 4); `pip uninstall ics` is optional |
| Bootstrap 5.3.3 and Leaflet.markercluster 1.5.3 added to `vendor.lock`; old Bootstrap 5.0-beta and 5.1.3 removed | Run `fetch_vendor.sh`, then delete the old folders (step 5) |
| New apps: `tasks`, `apikeys`, `feeds`, `analytics`, `habits`, `contacts` | Nothing extra; they come with migrations (step 6) |
| Migrations: notifications 0003–0004, scheduler 0032–0038, tasks 0001, photos 0024–0027, map 0004–0005, users 0005, apikeys 0001, feeds 0001, analytics 0001, habits and contacts 0001 | `migrate` (step 6) |
| **Calendar schema overhaul** (scheduler 0034–0038) | Converts every event: kind, all-day dates, your categories (from the old numbers), sync windows, visibility; old priority/completed values are kept in each event's metadata; ownership inconsistencies fixed. Check with `calendar_migration_report` afterwards (step 6) |
| **Materialized views now live in migrations** (photos 0025–0027) | 0025 drops your hand-made `photos_photo_location_cache` and recreates it (hidden photos left out, plus a unique index); 0026 adds `photos_photo_daily`; 0027 sets the plane cut-off to 2000 m. Runs as your DB user, which owns the view. Nothing manual any more |
| `users 0005` removes the `dark_mode` column | None (dark mode is per device now) |
| Celery beat schedules (reminders, notification clean-up, habits, contacts) | Restart beat (step 9); the schedules register themselves |
| New URLs `/api/v2/`, `/tasks/`, `/habits/`, `/contacts/`, `/settings/api-keys/`, `/feeds/…ics`, `/analytics/`, `/app/` | None if nginx proxies everything to Daphne (it does). API keys use the `Authorization` header, which nginx passes through by default |
| New React interface at `/app/` | Optional: build locally and copy the folder (step 8). Until then `/app/` shows "isn't built on this server yet" |
| Email delivery for notifications (optional) | Set `EMAIL_HOST`/`EMAIL_HOST_USER` in settings and put the password in `Comptech/email_password.txt` |
| `SITE_URL` (links in notifications and feeds) | Already `https://app.example.com`; change it if your domain differs |

### Behaviour changes users will notice
- **Deleting photos** (and deleting originals) and **setting photo locations** in the location-entry tool now need owner or editor access to the library; viewers could do both before.
- **Dark mode** is chosen per device from the user menu (the old per-account switch is gone).
- **Calendar categories** are now named, per-owner categories made from the old numbers; repeating events from ICS/Google feeds keep their rules.
- **Heatmaps** leave out photos taken at 2000 m and up (was over 1000 m).
- **Places in the new interface** start with every group hidden; each person turns on the groups they want (like calendars). Owners can archive groups.
- **Logging in as before**; new apps (Tasks, Habits, Contacts) and the new interface at `/app/` appear in the app launcher.

## Step by step

### 0. Rehearse on a copy of production (recommended)
The migrations were tested on SQLite only. This runs them on a throwaway copy of your real database first; the live `Comptech` DB isn't touched.
```bash
cd /opt/Comptech
pg_dump -h 127.0.0.1 -U postgres Comptech > ~/comptech-rehearsal.sql
createdb -h 127.0.0.1 -U postgres Comptech_rehearsal
psql -h 127.0.0.1 -U postgres -q Comptech_rehearsal < ~/comptech-rehearsal.sql
git fetch && git checkout improve/phase-1       # or master after the merge
source CT_env/bin/activate && pip install -r requirements.txt
COMPTECH_DB_NAME=Comptech_rehearsal python manage.py migrate
COMPTECH_DB_NAME=Comptech_rehearsal python manage.py calendar_migration_report   # expect "No inconsistencies found"
dropdb -h 127.0.0.1 -U postgres Comptech_rehearsal && rm ~/comptech-rehearsal.sql
git checkout -                                   # back to what was running
```
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

### 7. Static files and the one-off thumbnail fix
```bash
make cs                               # collectstatic into /www/static
python manage.py fix_orientation --dry-run    # shows what would change
python manage.py fix_orientation              # fixes sideways photo/video thumbnails (once)
```

### 8. The new interface (optional)
On your computer, in the repo:
```bash
frontend/build.sh                     # builds into static_files/static/app/
rsync -av --delete static_files/static/app/ server:/opt/Comptech/static_files/static/app/
```
On the server, run `make cs` again so it's copied into `/www/static/app/`.

### 9. Start everything
```bash
tmux kill-session -t Comptech
/opt/Comptech/Comptech.sh
tmux attach -t Comptech               # window 0: "Listening on TCP address 0.0.0.0:8000"; windows 2 and 3: Celery up
```

### 10. Check it (and note the optional hardening below)
- Sign in, then open Home, Calendar, Tasks, Habits, Contacts, Photos, Places and Notifications. Toggle dark mode in the user menu.
- Notifications → add a channel (e.g. ntfy) → **Send test**.
- Settings → API keys: create a key with Tasks read access, then
  `curl -H "Authorization: Bearer <key>" https://app.example.com/api/v2/tasks/overview` should return JSON; revoke the key afterwards.
- Photos upload page works again (it was broken by a script clash).
- Within a minute, Celery beat's log should show the reminder tasks running.

## Optional hardening (only if the site is always reached over HTTPS)
Django's deploy check suggests these; they're not on by default because a plain-HTTP LAN visit would then fail to log in:
```python
SESSION_COOKIE_SECURE = True
CSRF_COOKIE_SECURE = True
SECURE_HSTS_SECONDS = 31536000   # only once you're sure HTTPS works everywhere; browsers remember it
```

## Updating only the new interface later
Build on your computer (`frontend/build.sh`), then `rsync -av --delete static_files/static/app/ server:/opt/Comptech/static_files/static/app/` and `make cs` on the server. No restart needed.

## Rolling back
```bash
tmux kill-session -t Comptech
git checkout "$(cat ~/comptech-previous-commit)"
psql -h 127.0.0.1 -U postgres -c 'DROP DATABASE "Comptech"' && psql -h 127.0.0.1 -U postgres -c 'CREATE DATABASE "Comptech"'
psql -h 127.0.0.1 -U postgres Comptech < ~/comptech-backup-<date>.sql
static_files/fetch_vendor.sh && make cs
/opt/Comptech/Comptech.sh
```
