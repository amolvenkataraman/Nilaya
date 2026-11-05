"""photos_photo_daily: stop leaving out photos flagged file_not_available.

Old scripts set that flag whenever a thumbnail failed (most older videos), and the classic pages
always counted those items, so the new interface showed ~3,000 fewer videos than the old one.
Recreates the Postgres materialized view (with its unique index) and the SQLite view."""

import importlib

from django.db import migrations

from Comptech.db_compat import PostgresOnly

_prev = importlib.import_module("photos.migrations.0026_matview_photo_daily")

OLD = "WHERE NOT hidden AND NOT file_not_available AND date_taken IS NOT NULL"
NEW = "WHERE NOT hidden AND date_taken IS NOT NULL"
PG_FORWARD = _prev.PG_FORWARD.replace(OLD, NEW)
SQLITE_NEW = _prev.SQLITE_VIEW.replace(OLD, NEW)
assert PG_FORWARD != _prev.PG_FORWARD and SQLITE_NEW != _prev.SQLITE_VIEW


def sqlite_swap(sql):
    def run(apps, schema_editor):
        if schema_editor.connection.vendor == "sqlite":
            schema_editor.execute("DROP VIEW IF EXISTS photos_photo_daily")
            schema_editor.execute(sql)
    return run


class Migration(migrations.Migration):
    dependencies = [("photos", "0029_location_cache_broken_gps")]
    operations = [
        PostgresOnly(migrations.RunSQL(PG_FORWARD, _prev.PG_FORWARD)),
        migrations.RunPython(sqlite_swap(SQLITE_NEW), sqlite_swap(_prev.SQLITE_VIEW)),
    ]
