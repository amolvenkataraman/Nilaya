"""Photo indexes for the V2 timeline and places.

- (date_taken, id): the timeline and album pages order newest first and keyset-page on
  (date_taken, id); without it every page sorted the whole library (measured on 300k photos,
  SQLite: 152 ms -> 4 ms per page). Also serves date-range counts (stats periods, counts).
- (latitude, longitude): "photos near a place" is a bounding-box query (75 ms -> 1 ms).

On ~300k rows each index builds in about a second; CREATE INDEX blocks writes (ingest),
not reads, while it runs. ANALYZE afterwards so the planner uses them right away.
"""

from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('photos', '0027_location_cache_plane_2000'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AddIndex(
            model_name='photo',
            index=models.Index(fields=['date_taken', 'id'], name='photo_date_taken_idx'),
        ),
        migrations.AddIndex(
            model_name='photo',
            index=models.Index(fields=['latitude', 'longitude'], name='photo_lat_lng_idx'),
        ),
        migrations.RunSQL("ANALYZE photos_photo", migrations.RunSQL.noop),
    ]
