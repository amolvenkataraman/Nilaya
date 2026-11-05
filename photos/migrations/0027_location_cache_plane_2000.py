"""Location cache views: "on a plane" now means altitude 2000 m and up (was over 1000 m).

Recreates the Postgres materialized view (with its unique index) and the SQLite view.
The threshold matches photos.models.PLANE_ALTITUDE_M."""

import importlib

from django.db import migrations

from Comptech.db_compat import PostgresOnly

_pg = importlib.import_module("photos.migrations.0025_matview_location_cache")
_lite = importlib.import_module("photos.migrations.0024_photo_hidden")

PG_FORWARD = _pg.FORWARD.replace("altitude > 1000::double precision", "altitude >= 2000::double precision")
PG_BACKWARD = _pg.FORWARD
SQLITE_NEW = _lite.SQLITE_VIEW.replace("altitude > 1000", "altitude >= 2000")


def sqlite_swap(new_sql):
    def run(apps, schema_editor):
        if schema_editor.connection.vendor == "sqlite":
            schema_editor.execute("DROP VIEW IF EXISTS photos_photo_location_cache")
            schema_editor.execute(new_sql)
    return run


class Migration(migrations.Migration):
    dependencies = [("photos", "0026_matview_photo_daily")]
    operations = [
        PostgresOnly(migrations.RunSQL(PG_FORWARD, PG_BACKWARD)),
        migrations.RunPython(sqlite_swap(SQLITE_NEW), sqlite_swap(_lite.SQLITE_VIEW)),
    ]
