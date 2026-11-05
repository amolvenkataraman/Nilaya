"""SQLite (local testing) gets a plain view in place of the Postgres materialized view.

On PostgreSQL this does nothing: production's materialized view is created
from photos/sql/photo_location_cache.sql and refreshed after ingest.
"""

from django.db import migrations

SQLITE_VIEW = """
CREATE VIEW IF NOT EXISTS photos_photo_location_cache AS
SELECT album_id,
       ROUND(latitude, 5) AS lat,
       ROUND(longitude, 5) AS lng,
       altitude > 1000 AS on_plane,
       CAST(strftime('%Y', date_taken) AS INTEGER) AS dt_year,
       COUNT(*) AS cnt
FROM photos_photo
WHERE latitude IS NOT NULL AND longitude IS NOT NULL
GROUP BY album_id, ROUND(latitude, 5), ROUND(longitude, 5),
         CAST(strftime('%Y', date_taken) AS INTEGER), altitude > 1000
HAVING ROUND(latitude, 5) <> 0 OR ROUND(longitude, 5) <> 0
"""


def create(apps, schema_editor):
    if schema_editor.connection.vendor == "sqlite":
        schema_editor.execute(SQLITE_VIEW)


def drop(apps, schema_editor):
    if schema_editor.connection.vendor == "sqlite":
        schema_editor.execute("DROP VIEW IF EXISTS photos_photo_location_cache")


class Migration(migrations.Migration):
    dependencies = [("photos", "0021_album_parent_album")]
    operations = [migrations.RunPython(create, drop)]
