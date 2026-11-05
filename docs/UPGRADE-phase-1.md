# Upgrading the server to `improve/phase-1`

Same setup as the last guide: code in `/opt/Comptech`, venv `/opt/Comptech/CT_env`, tmux session `Comptech` started by `Comptech.sh` (window 0 Daphne via `make`, window 2 Celery worker, window 3 Celery beat), nginx in front, Postgres DB `Comptech`. Time needed: about 20 minutes.

## What changed for deployment

| Thing | Action needed |
|---|---|
| New Python package `django-ninja` (V2 API) | `pip install -r requirements.txt` (step 4) |
| Bootstrap 5.3.3 and Leaflet.markercluster 1.5.3 added to `vendor.lock`; old Bootstrap 5.0-beta and 5.1.3 removed | Run `fetch_vendor.sh`, then delete the old folders (step 5) |
| New apps: `tasks`, `apikeys`, `feeds`, `analytics`, `habits`, `contacts` | Nothing extra; they come with migrations (step 6) |
| Migrations: notifications 0003–0004, scheduler 0032–0037, tasks 0001, photos 0024–0026, map 0004, users 0005, apikeys 0001, feeds 0001, analytics 0001, habits and contacts 0001 | `migrate` (step 6) |
| **Calendar schema overhaul** (scheduler 0034–0037) | Converts every event: kind, all-day dates, your categories (from the old numbers), sync windows, visibility; old priority/completed values are kept in each event's metadata; ownership inconsistencies fixed. Check with `calendar_migration_report` afterwards (step 6) |
| **Materialized views now live in migrations** (photos 0025, 0026) | 0025 drops your hand-made `photos_photo_location_cache` and recreates it (hidden photos left out, plus a unique index); 0026 adds `photos_photo_daily`. Runs as your DB user, which owns the view. Nothing manual any more |
| `users 0005` removes the `dark_mode` column | None (dark mode is per device now) |
| Celery beat schedules (reminders, notification clean-up, habits, contacts) | Restart beat (step 9); the schedules register themselves |
| New URLs `/api/v2/`, `/tasks/`, `/habits/`, `/contacts/`, `/settings/api-keys/`, `/feeds/…ics`, `/analytics/`, `/app/` | None if nginx proxies everything to Daphne (it does). API keys use the `Authorization` header, which nginx passes through by default |
| New React interface at `/app/` | Optional: build locally and copy the folder (step 8). Until then `/app/` shows "isn't built on this server yet" |
| Email delivery for notifications (optional) | Set `EMAIL_HOST`/`EMAIL_HOST_USER` in settings and put the password in `Comptech/email_password.txt` |
| `SITE_URL` (links in notifications and feeds) | Already `https://app.example.com`; change it if your domain differs |

## Step by step

### 1. Back up
```bash
cd /opt/Comptech
pg_dump -h 127.0.0.1 -U postgres Comptech > ~/comptech-backup-$(date +%F).sql
ls -lh ~/comptech-backup-*.sql            # should be non-empty
git rev-parse HEAD > ~/comptech-previous-commit
```

### 2. Stop the app
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
python manage.py calendar_migration_report   # read-only: events by kind/category, fixes applied; every event should have a category
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
rsync -av static_files/static/app/ server:/opt/Comptech/static_files/static/app/
```
On the server, run `make cs` again so it's copied into `/www/static/app/`.

### 9. Start everything
```bash
tmux kill-session -t Comptech
/opt/Comptech/Comptech.sh
tmux attach -t Comptech               # window 0: "Listening on TCP address 0.0.0.0:8000"; windows 2 and 3: Celery up
```

### 10. Check it
- Sign in, then open Home, Calendar, Tasks, Habits, Contacts, Photos, Places and Notifications. Toggle dark mode in the user menu.
- Notifications → add a channel (e.g. ntfy) → **Send test**.
- Settings → API keys: create a key with Tasks read access, then
  `curl -H "Authorization: Bearer <key>" https://app.example.com/api/v2/tasks/overview` should return JSON; revoke the key afterwards.
- Photos upload page works again (it was broken by a script clash).
- Within a minute, Celery beat's log should show the reminder tasks running.

## Rolling back
```bash
tmux kill-session -t Comptech
git checkout "$(cat ~/comptech-previous-commit)"
psql -h 127.0.0.1 -U postgres -c 'DROP DATABASE "Comptech"' && psql -h 127.0.0.1 -U postgres -c 'CREATE DATABASE "Comptech"'
psql -h 127.0.0.1 -U postgres Comptech < ~/comptech-backup-<date>.sql
static_files/fetch_vendor.sh && make cs
/opt/Comptech/Comptech.sh
```
