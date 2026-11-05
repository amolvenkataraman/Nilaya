from django.apps import AppConfig


class PhotosConfig(AppConfig):
    name = 'photos'

    def ready(self):
        from django.db.models.signals import post_delete, post_save
        from .cache import bump
        from .models import Photo
        # Any photo change makes the cached library aggregates stale (photos/cache.py).
        post_save.connect(lambda **kw: bump(), sender=Photo, weak=False, dispatch_uid="photos-cache-save")
        post_delete.connect(lambda **kw: bump(), sender=Photo, weak=False, dispatch_uid="photos-cache-delete")
