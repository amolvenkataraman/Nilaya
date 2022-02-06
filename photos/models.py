import uuid
from django.db import models
from users.models import *
from GPSPhoto import gpsphoto
import json

# Create your models here.
def parse_upload_path(instance, filename):
    return f"uploads/{instance.owner.id}/{filename}"

class Album(models.Model):
    name = models.CharField(max_length=64)
    owner = models.ForeignKey(ComptechUser, on_delete=models.CASCADE, related_name='album_owner')

class Photo(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False, verbose_name='ID')
    owner = models.ForeignKey(ComptechUser, on_delete=models.CASCADE, related_name='photo_owner')
    photo = models.FileField(upload_to=parse_upload_path)
    width = models.IntegerField(null=True)
    height = models.IntegerField(null=True)
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

    def get_url(self):
        return self.photo.url

    def get_dimensions(self):
        return json.dumps({
            "width": self.width,
            "height": self.height
        })

    def get_gps_data(self):
        return json.dumps({
            "latitude": self.latitude,
            "longitude": self.longitude
        })

    def get_info(self):
        return json.dumps({
            "id": str(self.id),
            "photo": self.photo.url,
            "width": self.width,
            "height": self.height,
            "latitude": self.latitude,
            "longitude": self.longitude,
            "date_taken": str(self.date_taken)
        })
