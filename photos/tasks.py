from celery import shared_task
from celery.utils.log import get_task_logger
from django.conf import settings

from photos.models import *
from users.models import ComptechUser
from photos.indeximg import photo_ingest_for_album

logger = get_task_logger(__name__)

@shared_task
def ingest_all_photos(user_id=None):
    if user_id:
        try:
            user = ComptechUser.objects.get(id=user_id)
        except ComptechUser.DoesNotExist:
            logger.error(f"User with ID {user_id} does not exist.")
            return
        album_subs = user.album_subscribed.all()
        albums = [i.album for i in album_subs]
    else:
        albums = list(Album.objects.all())

    all_new_photos = []
    for album in albums:
        logger.info(f"Ingesting photos for album {album.name} (ID: {album.id})")
        task_user = user if user_id else album.owner
        new_photos = photo_ingest_for_album(album, task_user, False)
        all_new_photos.extend(new_photos)

    logger.info("Refreshing photo location cache materialized view")
    refresh_photo_location_cache()

    if getattr(settings, 'PHOTOS_AI_INDEX_ON_INGEST', False) and all_new_photos:
        new_photo_ids = [str(p.id) for p in all_new_photos]
        logger.info(f"Triggering AI indexing for {len(new_photo_ids)} newly ingested photos")
        ai_index_photos.delay(new_photo_ids)

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

