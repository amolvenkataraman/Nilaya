#!/usr/bin/env bash
# Run the local test instance at http://127.0.0.1:8000 (Ctrl+C to stop).
set -euo pipefail
cd "$(dirname "$0")/.."
export DJANGO_SETTINGS_MODULE=Comptech.settings_local
exec .venv/bin/python manage.py runserver 127.0.0.1:8000 "$@"
