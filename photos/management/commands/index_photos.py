"""
management command: python manage.py index_photos

Runs the AI indexing pipeline on photos. All features are resumable —
already-indexed photos are skipped unless --force is passed.

Features
--------
  duplicates   MD5 hash + pHash (perceptual hash). Lightweight, fast. Works on
               all media types. Enables duplicate detection and similar-photo search.

  quality      Laplacian-variance blur score. Images only (skips video). Fast.
               Score guide: < 30 = blurry, 30–80 = soft, > 80 = acceptable.

  objects      YOLO object detection (YOLOv11). GPU-accelerated when available,
               CPU otherwise. Slower — plan ~1–5 s/photo on CPU. Images + video.

Usage examples
--------------
  python manage.py index_photos                        # all features
  python manage.py index_photos --feature=objects      # objects only
  python manage.py index_photos --feature=duplicates --sleep=0
  python manage.py index_photos --feature=quality --force
  python manage.py index_photos --feature=all --sleep=0.05

Run in a tmux session for long batches so SSH disconnects don't interrupt:
  tmux new -s index
  python manage.py index_photos --feature=all
"""

from django.core.management.base import BaseCommand

from photos.models import Photo


class Command(BaseCommand):
    help = "Run AI indexing pipeline (duplicates, quality, objects) on photos."

    def add_arguments(self, parser):
        parser.add_argument(
            "--feature",
            default="all",
            choices=["all", "duplicates", "quality", "objects"],
            help=(
                "Which indexer to run (default: all).\n"
                "  duplicates  MD5 + pHash for duplicate/similar detection (fast)\n"
                "  quality     Laplacian blur score — images only (fast)\n"
                "  objects     YOLO object detection — slow, GPU recommended"
            ),
        )
        parser.add_argument(
            "--sleep",
            type=float,
            default=0.1,
            help="Seconds to sleep between photos to cap CPU/GPU usage (default: 0.1). Set 0 for full speed.",
        )
        parser.add_argument(
            "--force",
            action="store_true",
            default=False,
            help="Re-index photos that have already been indexed.",
        )

    def handle(self, *args, **options):
        feat  = options["feature"]
        sleep = options["sleep"]
        force = options["force"]

        # ------------------------------------------------------------------
        # duplicates — MD5 hash + pHash
        # ------------------------------------------------------------------
        if feat in ("all", "duplicates"):
            from photos.AI import duplicates

            qs = Photo.objects.all() if force else Photo.objects.filter(md5_hash__isnull=True)
            count = qs.count()
            self.stdout.write(f"Indexing duplicates (MD5 + pHash) for {count} photo(s)...")
            duplicates.run(qs.iterator(chunk_size=500), force_reindex=force, delay=sleep)
            self.stdout.write(self.style.SUCCESS("  ✓ Duplicates done."))

        # ------------------------------------------------------------------
        # quality — Laplacian blur score
        # ------------------------------------------------------------------
        if feat in ("all", "quality"):
            from photos.AI import quality

            if force:
                qs = Photo.objects.filter(video=False)
            else:
                qs = Photo.objects.filter(video=False).exclude(
                    ai_index_info__has_key="blur_score"
                )

            count = qs.count()
            self.stdout.write(f"Indexing blur scores for {count} photo(s)...")
            quality.run(qs.iterator(chunk_size=500), force_reindex=force, delay=sleep)
            self.stdout.write(self.style.SUCCESS("  ✓ Quality done."))

        # ------------------------------------------------------------------
        # objects — YOLO object detection (most compute-intensive, runs last)
        # ------------------------------------------------------------------
        if feat in ("all", "objects"):
            from photos.AI import objects as ai_objects

            if force:
                qs = Photo.objects.all()
            else:
                # Skip photos that already have a non-empty objects list
                qs = Photo.objects.exclude(
                    ai_index_info__objects__isnull=False
                )

            count = qs.count()
            self.stdout.write(
                f"Running YOLO object detection on {count} photo(s)...\n"
                f"  (tip: this is slow on CPU — ~1–5 s/photo; use a GPU if available)"
            )
            ai_objects.run(list(qs.iterator(chunk_size=200)), force_reindex=force, delay=sleep)
            self.stdout.write(self.style.SUCCESS("  ✓ Objects done."))

        self.stdout.write(self.style.SUCCESS("\nAll done."))
