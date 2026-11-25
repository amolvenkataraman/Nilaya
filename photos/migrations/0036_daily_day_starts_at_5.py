"""photos_photo_daily: days begin at 5 am (the default day start in users.preferences), so a 1:30 am photo counts
on the day before, as the photo pages group it. PhotoDaily.DAY_OFFSET names the shift; users with another day
start or time zone read the live table (photos.api_common.daily).

Same definition as 0032 otherwise. Recreates the Postgres materialized view with its unique index (so
REFRESH ... CONCURRENTLY keeps working), and the SQLite view."""

import importlib

from django.db import migrations

from Comptech.db_compat import PostgresOnly

_orig = importlib.import_module("photos.migrations.0026_matview_photo_daily")
_prev = importlib.import_module("photos.migrations.0030_daily_includes_unavailable_flag")  # what 0032 applies

PG_OLD = f"(date_taken AT TIME ZONE '{_orig.TZ}')::date"
PG_NEW = f"((date_taken AT TIME ZONE '{_orig.TZ}') - interval '5 hours')::date"
SQLITE_OLD = "date(date_taken, 'localtime')"
SQLITE_NEW_DAY = "date(date_taken, 'localtime', '-5 hours')"
PG_FORWARD = _prev.PG_FORWARD.replace(PG_OLD, PG_NEW)
SQLITE_NEW = _prev.SQLITE_NEW.replace(SQLITE_OLD, SQLITE_NEW_DAY)
assert _prev.PG_FORWARD.count(PG_OLD) == 3 and _prev.SQLITE_NEW.count(SQLITE_OLD) == 3  # id, day, GROUP BY


class Migration(migrations.Migration):
    dependencies = [("photos", "0035_photo_exif_tags")]
    operations = [
        PostgresOnly(migrations.RunSQL(PG_FORWARD, _prev.PG_FORWARD)),
        migrations.RunPython(_prev.sqlite_swap(SQLITE_NEW), _prev.sqlite_swap(_prev.SQLITE_NEW)),
    ]
