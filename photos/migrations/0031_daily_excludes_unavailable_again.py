"""photos_photo_daily: leave out photos whose file is gone (file_not_available) again.

0030 included them on a wrong assumption; this restores 0026's definition (Postgres materialized
view with its unique index, and the SQLite view)."""

import importlib

from django.db import migrations

from Comptech.db_compat import PostgresOnly

_orig = importlib.import_module("photos.migrations.0026_matview_photo_daily")
_prev = importlib.import_module("photos.migrations.0030_daily_includes_unavailable_flag")


class Migration(migrations.Migration):
    dependencies = [("photos", "0030_daily_includes_unavailable_flag")]
    operations = [
        PostgresOnly(migrations.RunSQL(_orig.PG_FORWARD, _prev.PG_FORWARD)),
        migrations.RunPython(_prev.sqlite_swap(_orig.SQLITE_VIEW), _prev.sqlite_swap(_prev.SQLITE_NEW)),
    ]
