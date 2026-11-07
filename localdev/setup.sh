#!/usr/bin/env bash
# One-time local test setup: venv, secrets, SQLite DB, dummy data.
# Everything it creates lives in .venv/ and localdev/data/ (both gitignored).
#   localdev/setup.sh            # venv + DB + users/calendars/todos/places
#   localdev/setup.sh --photos   # ... plus photos from ~/Desktop/26Projects/Compress/{3,7} (hardlinked)
set -euo pipefail
cd "$(dirname "$0")/.."
DATA=localdev/data

mkdir -p "$DATA"/{secrets,photos,private/photo_cache/thumbnail,static,media/users/profile_pictures}

# 1. venv (Python 3.12, Django 5.1 like the server; no torch/ultralytics, no psycopg)
[ -d .venv ] || uv venv -q --python 3.12 .venv
grep -vE '^\s*(ultralytics|psycopg|django)\s*($|[<>=~!#])' requirements.txt > "$DATA/requirements.txt"
uv pip install -q --python .venv -r "$DATA/requirements.txt" "django>=5.1,<5.2" "psycopg[binary]"

# 2. generated secrets (never the server's)
for f in secret.txt salt.txt; do
  [ -s "$DATA/secrets/$f" ] || .venv/bin/python -c "import secrets; print(secrets.token_urlsafe(48))" > "$DATA/secrets/$f"
done
chmod 700 "$DATA/secrets"; chmod 600 "$DATA/secrets"/*

# 3. DB + dummy data
export DJANGO_SETTINGS_MODULE=Comptech.settings_local
.venv/bin/python manage.py migrate -v0
.venv/bin/python manage.py seed_local "$@"
echo "Done. Build the app (frontend/build.sh), then start it with: localdev/run.sh"
