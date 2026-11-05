"""Location cache views: leave out photos with a coordinate of exactly 0 (broken GPS).

Some phones write the right latitude with a longitude of exactly 0.0 (or the reverse), which put
Waterloo photos in southern France on the heat map. Only 0,0 was left out before. A real photo
exactly on the equator or the Greenwich meridian (a ~10 cm strip at 6 decimals) is vanishingly
rare; these photos show up in the location-entry tool's "0,0" filter to be fixed instead.

Recreates the Postgres materialized view (with its unique index) and the SQLite view."""

import importlib

from django.db import migrations

from Comptech.db_compat import PostgresOnly

_prev = importlib.import_module("photos.migrations.0027_location_cache_plane_2000")

PG_WHERE = "photos_photo.latitude IS NOT NULL AND photos_photo.longitude IS NOT NULL"
PG_FORWARD = _prev.PG_FORWARD.replace(PG_WHERE, PG_WHERE + " AND photos_photo.latitude <> 0 AND photos_photo.longitude <> 0")
LITE_WHERE = "latitude IS NOT NULL AND longitude IS NOT NULL"
SQLITE_NEW = _prev.SQLITE_NEW.replace(LITE_WHERE, LITE_WHERE + " AND latitude <> 0 AND longitude <> 0")
assert PG_FORWARD != _prev.PG_FORWARD and SQLITE_NEW != _prev.SQLITE_NEW


class Migration(migrations.Migration):
    dependencies = [("photos", "0028_photo_date_and_location_indexes")]
    operations = [
        PostgresOnly(migrations.RunSQL(PG_FORWARD, _prev.PG_FORWARD)),
        migrations.RunPython(_prev.sqlite_swap(SQLITE_NEW), _prev.sqlite_swap(_prev.SQLITE_NEW)),
    ]
