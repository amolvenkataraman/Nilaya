#!/usr/bin/env bash
# Run the local test instance at http://127.0.0.1:8000 (Ctrl+C to stop).
set -euo pipefail
cd "$(dirname "$0")/.."
export DJANGO_SETTINGS_MODULE=Comptech.settings_local
# placewise (place names and search) on 8771 unless one is already answering there; stopped with the server.
PLACEWISE_PORT="${PLACEWISE_PORT:-8771}"
if ! curl -sf "http://127.0.0.1:$PLACEWISE_PORT/v1/health" >/dev/null 2>&1; then
  .venv/bin/placewise --offline serve --host 127.0.0.1 --port "$PLACEWISE_PORT" &
  trap 'kill $! 2>/dev/null' EXIT
fi
.venv/bin/python manage.py runserver 127.0.0.1:8000 "$@"
