"""Repair orientation data for photos/videos ingested before the fix.

    python manage.py fix_orientation --dry-run   # report only
    python manage.py fix_orientation             # repair

- Photos with EXIF orientation 5-8 (rotated 90 degrees) had width/height stored
  as the raw sensor size, so portrait photos were recorded as landscape. Swap them.
- Video thumbnails could be rotated twice (newer OpenCV auto-rotates) and video
  width/height were swapped. Regenerate every video's thumbnail and size.
Files on disk are never modified; only DB fields and thumbnail cache files.
"""

from django.core.management.base import BaseCommand
from PIL import Image

from photos.models import Photo


class Command(BaseCommand):
    help = "Fix stored size of EXIF-rotated photos and regenerate video thumbnails."

    def add_arguments(self, parser):
        parser.add_argument("--dry-run", action="store_true", help="report what would change")
        parser.add_argument("--skip-videos", action="store_true", help="only fix photo sizes")

    def handle(self, *args, dry_run, skip_videos, **options):
        swapped = unreadable = 0
        to_save = []
        photos = Photo.objects.filter(video=False).select_related("album").only(
            "id", "filepath", "width", "height", "album__location")
        for p in photos.iterator(chunk_size=500):
            try:
                with Image.open(p.get_filepath()) as img:  # reads the header only
                    rotated = (img.getexif() or {}).get(0x0112, 1) in (5, 6, 7, 8)
                    raw_w, raw_h = img.size
            except Exception:
                unreadable += 1  # offline/missing file: leave untouched
                continue
            if rotated and (p.width, p.height) == (raw_w, raw_h) and raw_w != raw_h:
                p.width, p.height = raw_h, raw_w
                to_save.append(p)
                swapped += 1
        if not dry_run and to_save:
            Photo.objects.bulk_update(to_save, ["width", "height"], batch_size=500)
        self.stdout.write(f"Photos: {swapped} rotated photo sizes {'would be ' if dry_run else ''}fixed"
                          f" ({unreadable} files unreadable, skipped)")

        if skip_videos:
            return
        videos = Photo.objects.filter(video=True).select_related("album")
        done = failed = 0
        for v in videos.iterator(chunk_size=100):
            if dry_run:
                done += 1
                continue
            before = (v.thumbnail_width, v.thumbnail_height)
            v.gen_thumbnail()  # rewrites the cached thumbnail + width/height/main colour
            v.refresh_from_db(fields=["thumbnail_width", "thumbnail_height"])
            if (v.thumbnail_width, v.thumbnail_height) == before and before == (None, None):
                failed += 1
            else:
                done += 1
        self.stdout.write(f"Videos: {done} thumbnails {'would be ' if dry_run else ''}regenerated"
                          f"{f', {failed} failed (file offline/unreadable)' if failed else ''}")
