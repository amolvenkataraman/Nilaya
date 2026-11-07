"""photos_photo_daily: include photos flagged file_not_available (a stale flag; the files exist).

Same definition as 0030 (the classic pages count these items). Recreates the Postgres materialized
view with its unique index, and the SQLite view."""

import importlib

from django.db import migrations

from Comptech.db_compat import PostgresOnly

_orig = importlib.import_module("photos.migrations.0026_matview_photo_daily")
_incl = importlib.import_module("photos.migrations.0030_daily_includes_unavailable_flag")


class Migration(migrations.Migration):
    dependencies = [("photos", "0031_daily_excludes_unavailable_again")]
    operations = [
        PostgresOnly(migrations.RunSQL(_incl.PG_FORWARD, _orig.PG_FORWARD)),
        migrations.RunPython(_incl.sqlite_swap(_incl.SQLITE_NEW), _incl.sqlite_swap(_orig.SQLITE_VIEW)),
    ]
