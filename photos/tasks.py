from celery import shared_task
from celery.utils.log import get_task_logger

from photos.models import *
from users.models import ComptechUser
from photos.indeximg import photo_ingest_for_album

logger = get_task_logger(__name__)

@shared_task
def ingest_all_photos(user_id=None):
    if user_id:
        try:
            user = ComptechUser.objects.get(id=user_id)
        except User.DoesNotExist:
            logger.error(f"User with ID {user_id} does not exist.")
            return
        album_subs = user.album_subscribed.all()
        albums = [i.album for i in album_subs]
    else:
        albums = list(Album.objects.all())

    for album in albums:
        logger.info(f"Ingesting photos for album {album.name} (ID: {album.id})")
        task_user = user if user_id else album.owner
        photo_ingest_for_album(album, task_user, False)


    logger.info("Refreshing photo location cache materialized view")
    refresh_photo_location_cache()

    logger.info("Photo ingestion and location cache refresh complete.")
