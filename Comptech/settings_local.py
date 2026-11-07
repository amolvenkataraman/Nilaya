"""Local testing settings: SQLite, no Redis, no nginx, everything under localdev/data/.

Use with:  DJANGO_SETTINGS_MODULE=Comptech.settings_local
(localdev/run.sh and localdev/setup.sh set it for you). Never used on the server.
"""

import os
from pathlib import Path

_DATA = Path(__file__).resolve().parent.parent / "localdev" / "data"
os.environ.setdefault("COMPTECH_SECRETS_DIR", str(_DATA / "secrets"))

from .settings import *  # noqa: E402,F401,F403

LOCAL = True
DEBUG = True
ONLINE_MODE = False  # no calendar sync / Nominatim calls from a test instance
ALLOWED_HOSTS = ["localhost", "127.0.0.1", "[::1]"]
CSRF_TRUSTED_ORIGINS = ["http://localhost:8000", "http://127.0.0.1:8000"]
INTERNAL_IPS = ["127.0.0.1"]

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": _DATA / "db.sqlite3",
        "OPTIONS": {"transaction_mode": "IMMEDIATE", "timeout": 20},
    }
}

# Redis → in-memory. Celery tasks run inline (no worker, no broker).
CHANNEL_LAYERS = {"default": {"BACKEND": "channels.layers.InMemoryChannelLayer"}}
CACHES = {"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}}
# Plain static names locally (runserver serves from the apps; no collectstatic needed).
STORAGES = {"default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
            "staticfiles": {"BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"}}
CELERY_TASK_ALWAYS_EAGER = True
CELERY_TASK_EAGER_PROPAGATES = True
CELERY_BROKER_URL = "memory://"
CELERY_RESULT_BACKEND = "cache+memory://"

# Filesystem: all under localdev/data (gitignored)
PHOTOS_ROOT = str(_DATA / "photos") + "/"
PRIVATE_ROOT = str(_DATA / "private") + "/"
THUMBNAIL_DIR = PRIVATE_ROOT + "photo_cache/thumbnail/"
STATIC_ROOT = str(_DATA / "static")
MEDIA_ROOT = str(_DATA / "media")
SERVE_FILES_WITH_DJANGO = True  # /private/ and /photo_cdn/ served by Django, same signed URLs
PHOTOS_INGEST_HARDLINK = True  # ingest links files instead of copying (originals never modified)
PHOTOS_AI_INDEX_ON_INGEST = False  # ultralytics/torch not installed locally
SITE_URL = "http://127.0.0.1:8000"
# Notification emails are written to files instead of being sent.
EMAIL_BACKEND = "django.core.mail.backends.filebased.EmailBackend"
EMAIL_FILE_PATH = str(_DATA / "emails")
