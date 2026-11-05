from celery import shared_task
from celery.utils.log import get_task_logger
from django.conf import settings

from photos.models import *
from users.models import ComptechUser
from photos.indeximg import photo_ingest_for_album
from notifications.service import notify

logger = get_task_logger(__name__)


@shared_task(ignore_result=True)
def refresh_photo_views(views):
    """Coalesced refresh queued by photos.cache.schedule_matview_refresh."""
    from photos.cache import run_scheduled_refresh
    run_scheduled_refresh(views)


@shared_task
def ingest_all_photos(user_id=None):
    if user_id:
        try:
            user = ComptechUser.objects.get(id=user_id)
        except ComptechUser.DoesNotExist:
            logger.error(f"User with ID {user_id} does not exist.")
            return
        album_subs = user.album_subscribed.filter(subscribe_type__in=[0, 1])  # owner/editor only
        albums = [i.album for i in album_subs]
    else:
        albums = list(Album.objects.all())

    all_new_photos = []
    per_user = {}  # who to tell: the user who started it, else each album's owner
    for album in albums:
        logger.info(f"Ingesting photos for album {album.name} (ID: {album.id})")
        task_user = user if user_id else album.owner
        new_photos = photo_ingest_for_album(album, task_user, False)
        all_new_photos.extend(new_photos)
        if new_photos:
            per_user.setdefault(task_user, []).append(f"{len(new_photos)} in {album.name}")

    logger.info("Refreshing photo location cache materialized view")
    refresh_photo_location_cache()

    if getattr(settings, 'PHOTOS_AI_INDEX_ON_INGEST', False) and all_new_photos:
        new_photo_ids = [str(p.id) for p in all_new_photos]
        logger.info(f"Triggering AI indexing for {len(new_photo_ids)} newly ingested photos")
        ai_index_photos.delay(new_photo_ids)

    for who, parts in per_user.items():
        total = sum(int(p.split(" ", 1)[0]) for p in parts)
        notify(who, f"Ingest finished: {total} new photo{'s' if total != 1 else ''}", ", ".join(parts),
               source="Photos", url="/photos/")
    if user_id and not per_user:
        notify(user, "Ingest finished: nothing new", "No new files were found in your Ingest folders.",
               source="Photos", url="/photos/", priority=0)

    logger.info("Photo ingestion and location cache refresh complete.")


@shared_task
def ai_index_photos(photo_ids):
    from photos.AI import objects as ai_objects
    from photos.AI import duplicates as ai_duplicates
    from photos.AI import quality as ai_quality

    photos = list(Photo.objects.filter(id__in=photo_ids))
    logger.info(f"Running AI indexing on {len(photos)} photos")

    ai_objects.run(photos)
    ai_duplicates.run(photos)
    ai_quality.run(photos)

    logger.info("AI indexing complete.")

