from django.db import models

# Create your models here.
class Bg_Image(models.Model):
    image = models.ImageField(upload_to='bg_images/images')
    description = models.CharField(max_length=64)
    location = models.CharField(max_length=64)

    def __str__(self):
        return self.description