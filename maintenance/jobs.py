"""The maintenance jobs staff can run from Settings › Maintenance. Each is a function run(run, options)
that reports progress with run.progress(done, total) and returns (summary line, result dict).

Long jobs run in Celery (maintenance.tasks.run_job); one run of a job at a time."""

import io
from contextlib import redirect_stderr, redirect_stdout
from dataclasses import dataclass, field

from django.core.management import call_command

LOG_LIMIT = 20_000  # characters of command output kept on a run


@dataclass(frozen=True)
class Option:
    key: str
    label: str
    default: bool = False


@dataclass(frozen=True)
class Job:
    key: str
    title: str
    description: str
    group: str
    run: callable
    options: tuple = field(default_factory=tuple)


def _geotagged():
    from photos.models import BROKEN_GPS, Photo

    return Photo.objects.filter(latitude__isnull=False, longitude__isnull=False).exclude(BROKEN_GPS)


def photo_places(run, options):
    from geo.naming import name_photos
    from photos.models import refresh_photo_matviews

    photos = _geotagged()
    if options.get("missing_only"):
        photos = photos.filter(location_city__isnull=True)
    found = name_photos(photos, dry_run=bool(options.get("preview")), progress=run.progress)
    if not options.get("preview") and found["changed"]:
        refresh_photo_matviews()  # browse lists and stats are cached
    verb = "would change" if options.get("preview") else "changed"
    return f"{found['total']:,} photos checked, {found['changed']:,} {verb}", found


def photo_caches(run, options):
    from photos.models import refresh_photo_matviews

    refresh_photo_matviews()
    return "Photo map and day caches refreshed", {}


def _command(name, **kwargs):
    def run(run_, options):
        out = io.StringIO()
        with redirect_stdout(out), redirect_stderr(out):
            call_command(name, stdout=out, stderr=out, **{k: options.get(k, v) for k, v in kwargs.items()})
        text = out.getvalue()
        run_.log = text[-LOG_LIMIT:]
        last = next((line for line in reversed(text.splitlines()) if line.strip()), "Finished")
        return last[:300], {}
    return run


def ingest(run, options):
    from photos.tasks import ingest_all_photos

    ingest_all_photos(None)
    return "Ingest finished for every library (owners are notified of new photos)", {}


JOBS = {j.key: j for j in (
    Job("photo-places", "Name photo places",
        "Name every geotagged photo's city, state and country with placewise. Preview first to see what changes.",
        "Photos", photo_places,
        (Option("preview", "Preview only (change nothing)", True), Option("missing_only", "Only photos without a place"))),
    Job("photo-caches", "Refresh photo caches",
        "Rebuild the photo map and per-day caches and clear cached stats, for when they look out of date.",
        "Photos", photo_caches),
    Job("photo-ingest", "Ingest new files",
        "Look for new files in every library's folders and add them, as each owner's Ingest button does.",
        "Photos", ingest),
    Job("photo-orientation", "Fix photo orientation",
        "Correct the stored size of rotated photos and remake video thumbnails. Files are never changed.",
        "Photos", _command("fix_orientation", dry_run=True), (Option("dry_run", "Report only (change nothing)", True),)),
    Job("photo-duplicates", "Find duplicate files",
        "Hash photos that have no file hash yet, so Duplicates can find exact copies.",
        "Photos", _command("index_photos", feature="duplicates", sleep=0)),
    Job("photo-quality", "Score blur",
        "Score sharpness for photos that have no score yet (Superlatives and the blur filter use it).",
        "Photos", _command("index_photos", feature="quality", sleep=0)),
)}
