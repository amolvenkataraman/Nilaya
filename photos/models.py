import uuid
from django.db import models
from users.models import *

# Create your models here.
def parse_album_path(instance, filename):
    return f"photos/album/{instance.id}/{filename}"

class Album(models.Model):
    name = models.CharField(max_length=64)
    owner = models.ForeignKey(ComptechUser, on_delete=models.CASCADE, related_name='album_owner')
    oldestdate = models.DateTimeField(null=True, blank=True)
    newestdate = models.DateTimeField(null=True, blank=True)
    picture = models.ImageField(upload_to=parse_album_path, null=True, blank=True)
    location = models.CharField(max_length=128)
    split = models.BooleanField(default=True) # Whether photos are split in different folders by year and month

    def __str__(self):
        return f"{self.name} [{self.owner.username}]"

class Photo(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False, verbose_name='ID')
    owner = models.ForeignKey(ComptechUser, on_delete=models.CASCADE, related_name='photo_owner')
    album = models.ForeignKey(Album, on_delete=models.PROTECT, related_name='photo_album')
    filepath = models.CharField(max_length=128)

    width = models.IntegerField(null=True, blank=True)
    height = models.IntegerField(null=True, blank=True)
    latitude = models.FloatField(null=True, blank=True)
    longitude = models.FloatField(null=True, blank=True)
    orientation = models.CharField(max_length=32)
    date_taken = models.DateTimeField(auto_now=False, null=True, blank=True)

    camera_make = models.CharField(max_length=32, null=True, blank=True)
    camera_model = models.CharField(max_length=32, null=True, blank=True)
    exposure = models.CharField(max_length=32, null=True, blank=True)
    fnumber = models.CharField(max_length=32, null=True, blank=True)
    isospeed = models.CharField(max_length=32, null=True, blank=True)
    shutterspeed = models.CharField(max_length=32, null=True, blank=True)
    aperture = models.CharField(max_length=32, null=True, blank=True)
    flash = models.CharField(max_length=32, null=True, blank=True)
    focallength = models.CharField(max_length=32, null=True, blank=True)

    video = models.BooleanField(default=False)
    length = models.IntegerField(null=True, blank=True)

    def get_dimensions(self):
        return {
            "width": self.width,
            "height": self.height
        }

    def get_gps_data(self):
        return {
            "lat": self.latitude,
            "lon": self.longitude
        }

    def get_info(self):
        return {
            "id": str(self.id),
            "path": str(self.album.location + self.filepath),
            "filepath": str(self.filepath),
            "width": self.width,
            "height": self.height,
            "lat": self.latitude,
            "lon": self.longitude,
            "date_taken": str(self.date_taken),

            "camera_make": self.camera_make,
            "camera_model": self.camera_model,
            "exposure": self.exposure,
            "fnumber": self.fnumber,
            "isospeed": self.isospeed,
            "shutterspeed": self.shutterspeed,
            "aperture": self.aperture,
            "flash": self.flash,
            "focallength": self.focallength
        }
