from django.db import models
from django.contrib.auth.models import User
from django.contrib.auth.models import AbstractUser

# Create your models here.
class UserGroup(models.Model):
    name = models.CharField(max_length=32)
    description = models.CharField(max_length=512, default="No description")
    picture = models.ImageField(upload_to="media/users/group_pictures", null=True, blank=True)
    priority = models.IntegerField(default=1)
    public = models.BooleanField(default=False)

    def __str__(self):
        return f"{self.name}"
    
    def getinfo(self):
        ans = {
            "id": self.id,
            "name": self.name,
            "description": self.description,
        }

        try:
            ans["picture"] = self.picture.url
        except ValueError:
            pass

        return ans

class ComptechUser(AbstractUser):
    description = models.CharField(max_length=512, default="No description")
    #gender = models.BooleanField(default=True)
    #location = models.ForeignKey()
    birthday = models.DateField(null=True, blank=True)
    timezone = models.CharField(max_length=32, default='Canada/Eastern')
    profile_picture = models.ImageField(upload_to="users/profile_pictures", null=True, blank=True)
    dark_mode = models.BooleanField(default=False)
    friends = models.ManyToManyField("self", related_name='user_friends', blank=True)
    user_groups = models.ManyToManyField(UserGroup, blank=True)
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
            "is_staff": self.is_staff,
            "is_admin": self.is_superuser,
            "groups": [i.getinfo() for i in self.user_groups.all()]
        }

        try:
            ans["profile_picture"] = self.profile_picture.url
        except ValueError:
            pass

        return ans

    def getinfo_zip(self):
        ans = {
            "id": self.id,
            "username": self.username,
            "first_name": self.first_name,
            "last_name": self.last_name,
            "description": self.description,
            "is_admin": self.is_superuser,
        }

        return ans

    def getfriends(self):
        return [i.getinfo() for i in self.friends.all()]

class FriendRequest(models.Model):
    fromuser = models.ForeignKey(ComptechUser, on_delete=models.CASCADE, related_name='friend_request_from')
    touser = models.ForeignKey(ComptechUser, on_delete=models.CASCADE, related_name='friend_request_to')

    def getinfo(self):
        return {
            "id": self.id,
            "from": self.fromuser.getinfo(),
            "to": self.touser.getinfo(),
        }
