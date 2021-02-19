from django.db import models
from django.contrib.auth.models import User
from django.contrib.auth.models import AbstractUser

# Create your models here.
class ComptechUser(AbstractUser):
    description = models.CharField(max_length=512, default="No description")
    #location = models.ForeignKey()
    profile_picture = models.ImageField(upload_to="profile_pictures", null=True, blank=True)
    newuser = models.BooleanField(default=True)

    REQUIRED_FIELDS = ['first_name', 'last_name', 'password']

    def __str__(self):
        return f"{self.username}"

    def getinfo(self):
        ans = {
            "id": self.id,
            "username": self.username,
            "first_name": self.first_name,
            "last_name": self.last_name,
            "description": self.description,
        }

        try:
            ans["profile_picture"] = self.profile_picture.url
        except ValueError:
            print("", end="")

        return ans
