# Local testing

A self-contained copy of Comptech that runs on this machine with **SQLite,
no Redis, no nginx and no Celery worker**, filled with dummy data. Nothing
here is used on the server.

```bash
localdev/setup.sh            # venv (.venv), secrets, SQLite DB, dummy users/calendars/todos/places
localdev/setup.sh --photos   # ... plus photos from ~/Desktop/26Projects/Compress/{3,7}
frontend/build.sh            # builds the app into static_files/static/app/ (Node 20.19+)
localdev/run.sh              # http://127.0.0.1:8000   (login: amol / localdev; also alex, sam)
.venv/bin/python localdev/smoke.py   # signs in, checks every route, redirect, public page and signed file URL
.venv/bin/python localdev/screens.py /calendar /login   # screenshots, light + dark, desktop + phone
```

Reseed from scratch: `DJANGO_SETTINGS_MODULE=Comptech.settings_local .venv/bin/python manage.py seed_local --fresh [--photos] [--limit 100]`

## What's different from the server

| Server | Local (`Comptech/settings_local.py`) |
|---|---|
| Postgres | SQLite (`localdev/data/db.sqlite3`); Postgres-only migrations are skipped via `Comptech.db_compat.PostgresOnly`, and the photo-location materialized view is a plain SQLite view (migration `photos 0022`) |
| Redis (Celery broker, Channels) | In-memory; Celery tasks run inline (`CELERY_TASK_ALWAYS_EAGER`) |
| nginx `secure_link` for `/private/` and `/photo_cdn/` | Django serves them (`Comptech/localfiles.py`), checking the **same** md5 signature, so the app's URLs are unchanged |
| `/mnt/data/Photos/`, `/www/private/`, `/www/static`, `/www/media` | All under `localdev/data/` (settings `PHOTOS_ROOT`, `PRIVATE_ROOT`, `THUMBNAIL_DIR`, `UPLOADS_DIR`, `STATIC_ROOT`, `MEDIA_ROOT`) |
| Secrets in `Comptech/*.txt` | Generated in `localdev/data/secrets/` (`COMPTECH_SECRETS_DIR`) |
| Ingest copies files | Ingest **hardlinks** (`PHOTOS_INGEST_HARDLINK`): no extra disk, and the originals are never modified (no app code writes library files in place; video compression writes a new `_cmp.mp4`). |
| AI indexing (ultralytics/torch) | Off, and not installed |
| `ONLINE_MODE = True` | `False` (no calendar sync or Nominatim calls) |

`localdev/data/` and `.venv/` are gitignored.
