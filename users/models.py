import uuid
from django.db import models
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
    
class ComptechUser(AbstractUser):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False, verbose_name='ID')
    description = models.CharField(max_length=512, default="No description")
    birthday = models.DateField(null=True, blank=True)
    timezone = models.CharField(max_length=32, default='Canada/Eastern')
    profile_picture = models.ImageField(upload_to="users/profile_pictures", default='profile_picture.png')
    friends = models.ManyToManyField("self", related_name='user_friends', blank=True)
    user_groups = models.ManyToManyField(UserGroup, blank=True)
    newuser = models.BooleanField(default=True)
    preferences = models.JSONField(default=dict, blank=True)  # only what the user changed; users.preferences has the defaults

    REQUIRED_FIELDS = ['first_name', 'last_name', 'password']

    def __str__(self):
        return f"{self.username}"

class FriendRequest(models.Model):
    fromuser = models.ForeignKey(ComptechUser, on_delete=models.CASCADE, related_name='friend_request_from')
    touser = models.ForeignKey(ComptechUser, on_delete=models.CASCADE, related_name='friend_request_to')
