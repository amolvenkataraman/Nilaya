"""Photo.hidden. SQLite (local testing): the plain location view is dropped around the table
rebuild and recreated leaving hidden photos out. The Postgres materialized view is managed
by its own migration (0025_matview_location_cache)."""

import importlib

from django.db import migrations, models

_view = importlib.import_module("photos.migrations.0022_location_cache_sqlite_view")
SQLITE_VIEW = _view.SQLITE_VIEW.replace("WHERE latitude IS NOT NULL", "WHERE NOT hidden AND latitude IS NOT NULL")



def sqlite_create(apps, schema_editor):
    if schema_editor.connection.vendor == "sqlite":
        schema_editor.execute(SQLITE_VIEW)


class Migration(migrations.Migration):
    dependencies = [("photos", "0023_jsonfield_default_dict")]

    operations = [
        migrations.RunPython(_view.drop, _view.create),
        migrations.AddField(
            model_name="photo",
            name="hidden",
            field=models.BooleanField(db_index=True, default=False,
                                      help_text="Hidden from everyone; the owner sees it only in show-hidden mode"),
        ),
        migrations.RunPython(sqlite_create, _view.drop),
    ]
