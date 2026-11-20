"""Camera details (exposure, f-number, ISO, shutter speed, aperture, flash, focal length) move from seven columns
into one JSON field, photo_exif_tags, keyed by EXIF tag name, which new ingests fill with every plain EXIF tag.
The migration copies each photo's values over before the columns go, and copies them back if reversed."""

from django.db import migrations, models

FIELDS = {
    "exposure": "ExposureTime", "fnumber": "FNumber", "isospeed": "ISOSpeedRatings", "shutterspeed": "ShutterSpeedValue",
    "aperture": "ApertureValue", "flash": "Flash", "focallength": "FocalLength",
}
BATCH = 2000


def _batches(Photo, query):
    ids = list(query.order_by("id").values_list("id", flat=True))
    for start in range(0, len(ids), BATCH):
        yield list(Photo.objects.filter(id__in=ids[start:start + BATCH]))


def add_column(apps, schema_editor):
    """Postgres: Django's own add_field. SQLite: a plain ADD COLUMN (Django would rebuild the table, which the
    local photo views from migration 0022 don't survive)."""
    Photo = apps.get_model("photos", "Photo")
    field = models.JSONField(blank=True, default=dict)  # not in this state yet: the state op adds it
    field.set_attributes_from_name("photo_exif_tags")
    field.model = Photo
    if schema_editor.connection.vendor == "sqlite":
        schema_editor.execute("ALTER TABLE photos_photo ADD COLUMN photo_exif_tags text NOT NULL DEFAULT '{}' "
                              "CHECK (JSON_VALID(photo_exif_tags) OR photo_exif_tags IS NULL)")
    else:
        schema_editor.add_field(Photo, field)


def drop_column(apps, schema_editor):
    schema_editor.execute("ALTER TABLE photos_photo DROP COLUMN photo_exif_tags")


def forward(apps, schema_editor):
    Photo = apps.get_model("photos", "Photo")
    has_any = models.Q()
    for column in FIELDS:
        has_any |= models.Q(**{f"{column}__isnull": False})
    for batch in _batches(Photo, Photo.objects.filter(has_any)):
        for p in batch:
            p.photo_exif_tags = {tag: getattr(p, column) for column, tag in FIELDS.items() if getattr(p, column)}
        Photo.objects.bulk_update(batch, ["photo_exif_tags"], batch_size=500)


def backward(apps, schema_editor):
    Photo = apps.get_model("photos", "Photo")
    for batch in _batches(Photo, Photo.objects.exclude(photo_exif_tags={})):
        for p in batch:
            for column, tag in FIELDS.items():
                value = (p.photo_exif_tags or {}).get(tag)
                setattr(p, column, str(value)[:32] if value is not None else None)
        Photo.objects.bulk_update(batch, list(FIELDS), batch_size=500)


class Migration(migrations.Migration):
    dependencies = [("photos", "0034_location_admin1")]

    operations = [
        migrations.SeparateDatabaseAndState(
            state_operations=[migrations.AddField("photo", "photo_exif_tags", models.JSONField(blank=True, default=dict))],
            database_operations=[migrations.RunPython(add_column, drop_column)],
        ),
        migrations.RunPython(forward, backward),
        # A plain DROP COLUMN (Postgres; SQLite 3.35+) instead of Django's table rebuild on SQLite.
        migrations.SeparateDatabaseAndState(
            database_operations=[
                migrations.RunSQL(f"ALTER TABLE photos_photo DROP COLUMN {column};",
                                  f"ALTER TABLE photos_photo ADD COLUMN {column} varchar(32) NULL;")
                for column in FIELDS
            ],
            state_operations=[migrations.RemoveField("photo", column) for column in FIELDS],
        ),
    ]
