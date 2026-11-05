"""Materialized view: photos_photo_daily, one row per library album and local day (settings.TIME_ZONE)
with photo/video counts, sizes and video length, leaving hidden and unavailable files out.

It makes calendar photo badges, stats by month and storage by year cheap on large libraries.
PostgreSQL: a materialized view with a unique index (refreshed CONCURRENTLY after ingest and
when photos are hidden; see photos.models.refresh_photo_matviews). SQLite (local testing): a
plain view, always current.
"""

from django.conf import settings
from django.db import migrations, models

from Comptech.db_compat import PostgresOnly

TZ = settings.TIME_ZONE.replace("'", "")

PG_FORWARD = f"""
DROP MATERIALIZED VIEW IF EXISTS photos_photo_daily;
CREATE MATERIALIZED VIEW photos_photo_daily AS
SELECT album_id::text || '-' || (date_taken AT TIME ZONE '{TZ}')::date::text AS id,
       album_id,
       (date_taken AT TIME ZONE '{TZ}')::date AS day,
       count(*) FILTER (WHERE NOT video) AS photos,
       count(*) FILTER (WHERE video) AS videos,
       coalesce(sum(size), 0) AS size_kb,
       coalesce(sum(size_total), 0) AS size_total_kb,
       coalesce(sum(length) FILTER (WHERE video), 0) AS length_s
FROM photos_photo
WHERE NOT hidden AND NOT file_not_available AND date_taken IS NOT NULL
GROUP BY album_id, (date_taken AT TIME ZONE '{TZ}')::date
WITH DATA;
CREATE UNIQUE INDEX photos_photo_daily_uniq ON photos_photo_daily (album_id, day);
"""
PG_BACKWARD = "DROP MATERIALIZED VIEW IF EXISTS photos_photo_daily;"

SQLITE_VIEW = """
CREATE VIEW IF NOT EXISTS photos_photo_daily AS
SELECT album_id || '-' || date(date_taken, 'localtime') AS id,
       album_id,
       date(date_taken, 'localtime') AS day,
       sum(CASE WHEN video THEN 0 ELSE 1 END) AS photos,
       sum(CASE WHEN video THEN 1 ELSE 0 END) AS videos,
       coalesce(sum(size), 0) AS size_kb,
       coalesce(sum(size_total), 0) AS size_total_kb,
       coalesce(sum(CASE WHEN video THEN length ELSE 0 END), 0) AS length_s
FROM photos_photo
WHERE NOT hidden AND NOT file_not_available AND date_taken IS NOT NULL
GROUP BY album_id, date(date_taken, 'localtime')
"""


def sqlite_create(apps, schema_editor):
    if schema_editor.connection.vendor == "sqlite":
        schema_editor.execute(SQLITE_VIEW)


def sqlite_drop(apps, schema_editor):
    if schema_editor.connection.vendor == "sqlite":
        schema_editor.execute("DROP VIEW IF EXISTS photos_photo_daily")


class Migration(migrations.Migration):
    dependencies = [("photos", "0025_matview_location_cache")]
    operations = [
        PostgresOnly(migrations.RunSQL(PG_FORWARD, PG_BACKWARD)),
        migrations.RunPython(sqlite_create, sqlite_drop),
        migrations.CreateModel(
            name="PhotoDaily",
            fields=[
                ("id", models.CharField(max_length=40, primary_key=True, serialize=False)),
                ("album_id", models.IntegerField()),
                ("day", models.DateField()),
                ("photos", models.IntegerField()),
                ("videos", models.IntegerField()),
                ("size_kb", models.BigIntegerField()),
                ("size_total_kb", models.BigIntegerField()),
                ("length_s", models.BigIntegerField()),
            ],
            options={"db_table": "photos_photo_daily", "managed": False},
        ),
    ]
