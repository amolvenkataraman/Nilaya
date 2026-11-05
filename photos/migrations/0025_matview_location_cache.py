"""Materialized view: photos_photo_location_cache (Photos heat map / map clusters).

Production's view used to be created by hand from photos/sql/photo_location_cache.sql; this
migration owns it now. It's idempotent: drops whatever exists and recreates it (leaving hidden
photos out), with a unique index so it can be refreshed CONCURRENTLY (reads aren't blocked).
PostgreSQL only; SQLite (local testing) uses the plain view from 0022/0024.
"""

from django.db import migrations

from Comptech.db_compat import PostgresOnly

SELECT = """
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

FORWARD = f"""
DROP MATERIALIZED VIEW IF EXISTS photos_photo_location_cache;
CREATE MATERIALIZED VIEW photos_photo_location_cache AS {SELECT.format(where="NOT photos_photo.hidden AND")} WITH DATA;
CREATE UNIQUE INDEX photos_location_cache_uniq
    ON photos_photo_location_cache (album_id, lat, lng, on_plane, dt_year);
"""

BACKWARD = f"""
DROP MATERIALIZED VIEW IF EXISTS photos_photo_location_cache;
CREATE MATERIALIZED VIEW photos_photo_location_cache AS {SELECT.format(where="")} WITH DATA;
"""


class Migration(migrations.Migration):
    dependencies = [("photos", "0024_photo_hidden")]
    operations = [PostgresOnly(migrations.RunSQL(FORWARD, BACKWARD))]
