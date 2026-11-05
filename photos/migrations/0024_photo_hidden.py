"""Photo.hidden, and the location cache views now leave hidden photos out.

PostgreSQL: the materialized view (created by hand from photos/sql/photo_location_cache.sql)
is recreated with the hidden filter. SQLite (local testing): the plain view is dropped
around the table rebuild and recreated with the filter.
"""

import importlib

from django.db import migrations, models

from Comptech.db_compat import PostgresOnly

_view = importlib.import_module("photos.migrations.0022_location_cache_sqlite_view")
SQLITE_VIEW = _view.SQLITE_VIEW.replace("WHERE latitude IS NOT NULL", "WHERE NOT hidden AND latitude IS NOT NULL")

PG_SELECT = """
SELECT photos_photo.album_id,
    round(photos_photo.latitude::numeric, 5) AS lat,
    round(photos_photo.longitude::numeric, 5) AS lng,
    photos_photo.altitude > 1000::double precision AS on_plane,
    EXTRACT(year FROM photos_photo.date_taken) AS dt_year,
    count(*) AS cnt
FROM photos_photo
WHERE {where} photos_photo.latitude IS NOT NULL AND photos_photo.longitude IS NOT NULL
GROUP BY photos_photo.album_id, (round(photos_photo.latitude::numeric, 5)), (round(photos_photo.longitude::numeric, 5)),
         (EXTRACT(year FROM photos_photo.date_taken)), (photos_photo.altitude > 1000::double precision)
HAVING round(photos_photo.latitude::numeric, 5) <> 0::numeric OR round(photos_photo.longitude::numeric, 5) <> 0::numeric
"""
PG_FORWARD = ("DROP MATERIALIZED VIEW IF EXISTS photos_photo_location_cache; "
              "CREATE MATERIALIZED VIEW photos_photo_location_cache AS " + PG_SELECT.format(where="NOT photos_photo.hidden AND") + " WITH DATA;")
PG_BACKWARD = ("DROP MATERIALIZED VIEW IF EXISTS photos_photo_location_cache; "
               "CREATE MATERIALIZED VIEW photos_photo_location_cache AS " + PG_SELECT.format(where="") + " WITH DATA;")


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
        PostgresOnly(migrations.RunSQL(PG_FORWARD, PG_BACKWARD)),
    ]
