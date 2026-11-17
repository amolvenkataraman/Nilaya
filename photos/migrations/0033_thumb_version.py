"""Photo.thumb_version: bumped when a thumbnail is made again, so thumb_url changes (?v=) and can be cached
forever. Postgres adds the column in place (its materialized views are unaffected). SQLite (local testing)
rebuilds the table, so its two plain views are dropped around the rebuild and recreated as they were."""

import importlib

from django.db import migrations, models

_location = importlib.import_module("photos.migrations.0029_location_cache_broken_gps")
_daily = importlib.import_module("photos.migrations.0030_daily_includes_unavailable_flag")
VIEWS = ((_location.SQLITE_NEW, "photos_photo_location_cache"), (_daily.SQLITE_NEW, "photos_photo_daily"))


def sqlite_drop(apps, schema_editor):
    if schema_editor.connection.vendor == "sqlite":
        for _, name in VIEWS:
            schema_editor.execute(f"DROP VIEW IF EXISTS {name}")


def sqlite_create(apps, schema_editor):
    if schema_editor.connection.vendor == "sqlite":
        for sql, _ in VIEWS:
            schema_editor.execute(sql)


class Migration(migrations.Migration):
    dependencies = [("photos", "0032_daily_includes_flagged_files")]

    operations = [
        migrations.RunPython(sqlite_drop, sqlite_create),
        migrations.AddField(model_name="photo", name="thumb_version", field=models.PositiveIntegerField(default=0)),
        migrations.RunPython(sqlite_create, sqlite_drop),
    ]
