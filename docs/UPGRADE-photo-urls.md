# Upgrade: encoded photo URLs, cacheable thumbnails, read-only phone Photos keys

Same setup as [UPGRADE-new-ui-only.md](UPGRADE-new-ui-only.md): code in `/opt/Comptech`, venv `CT_env`, tmux session
`Comptech` (Daphne, Celery worker, Celery beat), nginx, Postgres `Comptech`. Time needed: about 10 minutes.
Two small migrations (`photos.0033`, `apikeys.0003`), both reversible.

**Order matters: update nginx (step 2) before the new code goes live (step 4).** The new code adds `?v=` to thumbnails
that were ever regenerated and percent-encodes file names; the old nginx rules answer 404 for both.

## What changed for deployment

| Thing | Action needed |
|---|---|
| Signed photo URLs (`/private/…`, `/photo_cdn/…`) are percent-encoded and signed over exactly what the browser sends, including `?v=` (`photos/signed.py`). nginx's `secure_link_secret` already hashes the raw request URI, so the check is unchanged; the file is now found through the decoded path. Files with a space, `#`, `?`, `%` or accents in their names load (before, a space already broke them) | Replace the two signed-media `location` blocks and the two internal ones in your live config with the repo's (step 2) |
| Thumbnails carry `?v=N` once regenerated (`Photo.thumb_version`, bumped by `gen_thumbnail` when a thumbnail already exists), so signed media is served with `Cache-Control: public, max-age=31536000, immutable` | Part of step 2. Browsers stop revalidating thumbnails and originals |
| Phone Photos keys are read-only: new ones get `photos:read` + `me:read`, and `apikeys.0003` swaps `photos:write` for `photos:read` on keys already issued to a device. Keys made in Settings › Developers are untouched. `POST /api/v2/photos/have` counts as a read | `migrate` (step 3) |
| `POST /api/v2/devices/sign-out` (device token in the body) removes the device and every key on it; the Photos app calls it when you sign out | None |
| The web app's build changed (Tailwind, Base UI dialogs and menus, fixes) | Build and copy it as usual (step 4) |

## Step by step

### 1. Back up and note the current commit
```bash
cd /opt/Comptech
pg_dump -h 127.0.0.1 -U postgres Comptech > ~/comptech-backup-$(date +%F).sql
git rev-parse HEAD > ~/comptech-previous-commit
```

### 2. nginx first
In the repo's `nginx.conf`, copy the comment and the four blocks `location /private/`, `location /photo_cdn/`,
`location /secure_privmedia/` and `location /secure_photocdn/` over the same blocks in your live config. Keep your real
`secure_link_secret` value and your real `alias` paths. The new blocks still serve every URL the old code makes, so this
is safe to do while the old code runs.
```bash
sudo nginx -t && sudo systemctl reload nginx
```
Check that a photo page still shows thumbnails and opens an original.

### 3. Get the code and migrate
```bash
git fetch && git checkout master && git pull
source CT_env/bin/activate
python manage.py migrate        # photos.0033 (adds a column), apikeys.0003 (narrows phone Photos keys)
```

### 4. Build the app, copy it, restart
Build with `frontend/build.sh` on your computer and copy `static_files/static/app/` as in the previous guide, then
`make cs` and restart Daphne, the Celery worker and beat.

### 5. Check it
- Photos: thumbnails and originals load; a file whose name has a space opens.
- In the browser's network panel a thumbnail answers with `Cache-Control: public, max-age=31536000, immutable`.
- Settings › Developers still lists your devices; a phone signed in before the upgrade still browses Photos.

## Rolling back
```bash
python manage.py migrate apikeys 0002 && python manage.py migrate photos 0032
git checkout "$(cat ~/comptech-previous-commit)"
```
then rebuild and restart. The new nginx blocks can stay: they serve the old URLs too.
