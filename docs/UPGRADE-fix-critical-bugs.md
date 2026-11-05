# Upgrading the server to `fix/critical-bugs`

Step-by-step, assuming the usual setup: code in `/opt/Comptech`, venv in
`/opt/Comptech/CT_env`, started by `Comptech.sh` in a tmux session `Comptech`
(window 0 Daphne via `make`, window 2 Celery worker, window 3 Celery beat),
nginx in front, Postgres DB `Comptech`. Time needed: ~20 minutes plus
any API key rotation.

## What changed for deployment (old → new)

| Thing | Before | After | Action needed |
|---|---|---|---|
| Google / UWaterloo API keys | Hardcoded in `Comptech/api.py` | Read from `Comptech/google_api_key.txt` and `Comptech/uwaterloo_api_key.txt` (untracked) | **Create both files** (step 4); rotate the keys (old ones are in git history) |
| `secret.txt`, `db_password.txt`, `salt.txt` | `Comptech/` | Same place (optionally a folder set by env `COMPTECH_SECRETS_DIR`) | None (but see "rotate SECRET_KEY") |
| Third-party JS/CSS (jQuery, Bootstrap, Leaflet, Chart.js, …) | Committed in `static_files/static/` | **Not in git.** Downloaded + checksum-verified by `static_files/fetch_vendor.sh` from `static_files/vendor.lock` | **Run the script** before `collectstatic` (step 6). Needs internet |
| CDN `<script>` tags (photo map, Places map, stats) | Loaded from jsDelivr/cdnjs in the browser | Served by you from `/static/` | None (covered by step 6) |
| `ALLOWED_HOSTS` | `'*'` (any Host header) | The hosts in `CSRF_TRUSTED_ORIGINS` + `localhost`, `127.0.0.1` | If you use any other hostname/IP, add it to `CSRF_TRUSTED_ORIGINS` (step 5) |
| Clickjacking header | None | `X-Frame-Options: SAMEORIGIN` | None |
| Celery serializer | JSON **or pickle** | JSON only | Let queued tasks finish before upgrading (step 2) |
| Python packages | — | `requirements.txt` adds `pytz`, `python-dateutil`, `ultralytics`; drops `imagehash`, `pybktree` | `pip install -r requirements.txt` (step 7). No upgrades of existing packages |
| Migrations | up to photos `0021`, scheduler `0030` | photos `0022` (no-op on Postgres), `0023`, scheduler `0031` (field defaults only, no SQL) | `migrate` (step 8) |
| Chat app | Folder present, not installed | Removed | Optional: drop old `chat_*` tables (step 11) |
| `Comptech/routing.py` | Only commented-out chat websocket routes | Deleted; `asgi.py` serves HTTP only | None |
| Settings for local testing | — | `Comptech/settings_local.py`, `localdev/` | None. Only used if `DJANGO_SETTINGS_MODULE=Comptech.settings_local`; the server keeps using `Comptech.settings` |
| Hardcoded paths (`/mnt/data/Photos/`, `/www/private/...`) | Literals in code | Settings `PHOTOS_ROOT`, `PRIVATE_ROOT`, `THUMBNAIL_DIR`, `UPLOADS_DIR` with **the same values as defaults** | None |
| nginx config | — | Unchanged | None |

### Behaviour changes users will notice
- **Logging out** is a button that POSTs. A bookmark or link to `/accounts/logout/` now just goes home without logging out.
- **Profiles** (`/accounts/profile/...`) and profile pictures need you to be logged in.
- **Ingest** can only be started by album **owners/editors**, and only ingests their own/edited albums.
- **Ingest now scans `Ingest/` at every depth**, including files placed directly in `Ingest/` (these used to be ignored). **Check each album's `Ingest/` folder before the first ingest** (step 10).
- **Calendar settings** only show the subscriber list and invite codes to owners/admins; other subscribers see only the owner's name.
- Invite codes, subscribe/unsubscribe, the public calendar page, place ratings/notes, and the home greeting now work.

---

## Step by step

### 0. Before you start: test locally (optional, recommended)
On your dev machine: `localdev/setup.sh --photos`, then `localdev/run.sh`, then
open <http://127.0.0.1:8000> (login `amol` / `localdev`) and click around.
`.venv/bin/python localdev/smoke.py` checks every page.

### 1. Back up the database
```bash
cd /opt/Comptech
PGPASSWORD="$(cat Comptech/db_password.txt)" pg_dump -h 127.0.0.1 -U postgres Comptech \
  > ~/comptech-backup-$(date +%F).sql
ls -lh ~/comptech-backup-*.sql        # should be non-empty
```
Note the current commit so you can roll back: `git rev-parse HEAD > ~/comptech-previous-commit`.

### 2. Stop the app (let Celery finish first)
```bash
tmux attach -t Comptech
```
- Window 3 (beat): `Ctrl+C`, so no new scheduled tasks get queued.
- Window 2 (worker): wait until it's idle (no "Task ... received" activity
  for a minute, or `CT_env/bin/celery -A Comptech inspect active` shows nothing),
  then `Ctrl+C`. The new code only accepts JSON tasks, so anything still
  queued in the old pickle format would be rejected.
- Window 0 (Daphne): `Ctrl+C`.
- Detach with `Ctrl+B` then `D`.

### 3. Get the new code
```bash
cd /opt/Comptech
git status                 # must show no local changes you care about; if it does: git stash
git fetch origin
git checkout fix/critical-bugs     # or `git checkout master && git pull` once the PR is merged
git log --oneline -1               # confirm you're on the new commit
```
`git` will delete the old committed library files under `static_files/static/`;
step 6 downloads them back.

### 4. Put the API keys in their new files (and rotate them)
The old keys are still visible in git history, so generate new ones:
- **Google:** Google Cloud Console → APIs & Services → Credentials → create a
  new API key, restrict it to the **Google Calendar API**, then delete the old key.
- **UWaterloo:** UW Open Data API portal → generate a new key, revoke the old one.

```bash
cd /opt/Comptech
printf '%s' 'NEW_GOOGLE_KEY'    > Comptech/google_api_key.txt
printf '%s' 'NEW_UWATERLOO_KEY' > Comptech/uwaterloo_api_key.txt
chmod 600 Comptech/google_api_key.txt Comptech/uwaterloo_api_key.txt
git status --short Comptech/        # these files must NOT appear (they're gitignored)
```
If a file is missing, the app still starts; only that calendar sync fails.

**Rotate `SECRET_KEY` too** (it's also in git history):
```bash
CT_env/bin/python -c "import secrets; print(secrets.token_urlsafe(50))" > Comptech/secret.txt
chmod 600 Comptech/secret.txt
```
This logs everyone out once. **Do not change `salt.txt`.** It must match
`secure_link_secret` in nginx, or every photo/thumbnail link breaks.

### 5. Check your hostnames
Open `Comptech/settings.py` and find `CSRF_TRUSTED_ORIGINS`. Every hostname or IP
you open the site with must be in it (scheme + host, no port, e.g.
`'http://192.168.50.11'`). Anything else now gets **400 Bad Request**.
Currently allowed: `192.168.50.11`, `app.home.lan`, `app.example.com`,
`lab.example.com`, `localhost`, `127.0.0.1`.

### 6. Download the front-end libraries, then collect static files
```bash
cd /opt/Comptech
static_files/fetch_vendor.sh      # deletes old copies, downloads, verifies SHA-256
```
It must end with **"All vendored files downloaded and verified."** If any line
says `FAIL`, re-run it (network blip); don't continue until it passes.
```bash
source CT_env/bin/activate
make cs                            # = python manage.py collectstatic --noinput
```

### 7. Install new Python packages
```bash
source CT_env/bin/activate
pip show ultralytics > /dev/null && echo "ultralytics already installed" \
  || echo "ultralytics will be installed: it pulls in PyTorch (large download)"
pip install -r requirements.txt    # installs only what's missing; doesn't upgrade Django etc.
```
Don't add `-U`: requirements aren't pinned and `-U` would upgrade Django
and everything else.

### 8. Check, then migrate
```bash
python manage.py check             # warnings are OK; it must not show any ERRORS
python manage.py showmigrations photos scheduler | tail -6   # 0022/0023 and 0031 unapplied
make mi                            # = python manage.py migrate
```
The migrations only change field defaults; nothing is rewritten. photos `0022` does nothing on Postgres.

### 9. Start everything again
```bash
tmux kill-session -t Comptech      # clear the old windows
./Comptech.sh                      # starts Daphne, the Celery worker and beat as before
tmux attach -t Comptech            # check window 0 says "Listening on TCP address 0.0.0.0:8000"
```
Look at windows 2 and 3 for errors, then detach (`Ctrl+B`, `D`).

### 10. Before the first ingest: check `Ingest/` folders
Ingest now also picks up files sitting directly in `<album>/Ingest/` (and in
deeper subfolders). Those were ignored before, so old files could suddenly be
imported. For each album location:
```bash
find /mnt/data/Photos/<Album>/Ingest -maxdepth 1 -type f | head
```
Move anything you don't want imported out of `Ingest/` before pressing Ingest.

### 11. Smoke test (5 minutes)
In a browser (hard refresh: `Ctrl+Shift+R`):
- [ ] Log in, home page greeting + upcoming events/todos show
- [ ] Calendar: month/week/day load; create, edit and delete a test event; open
      "photos for this event" (popup shows photos)
- [ ] Calendar settings: create an invite code, toggle it, subscribe from another
      account with it, unsubscribe
- [ ] A public calendar page shows its events
- [ ] Photos: timeline thumbnails + full-size open; photo map heatmap; stats charts
- [ ] Places: map loads; edit a place's rating, notes are still there afterwards
- [ ] Profile page; log out button logs you out
- [ ] Browser dev tools → Console: no red errors; Network: no requests to
      `cdn.jsdelivr.net` / `cdnjs.cloudflare.com`

Optional clean-up: the chat app's old tables can be dropped
(`psql ... -c '\dt chat_*'` to see them; `DROP TABLE` them only if you're sure).
Optional hardening: in `Makefile`, change `daphne -b 0.0.0.0` to `-b 127.0.0.1`
so Django is only reachable through nginx (skip this if you use
`http://<server>:8000` directly on the LAN).

## If something goes wrong: roll back
```bash
cd /opt/Comptech
tmux kill-session -t Comptech
git checkout "$(cat ~/comptech-previous-commit)"   # old code, including the old library files
./Comptech.sh
```
No database rollback is needed: the new migrations only changed defaults and
the old code ignores them. Only if you need to, restore the backup from step 1 with
`psql -h 127.0.0.1 -U postgres Comptech < ~/comptech-backup-<date>.sql` (into an empty DB).
The key files from step 4 are harmless for the old code. If you rotated the
API keys, the old code (keys hardcoded) will fail calendar syncs until you upgrade again.
