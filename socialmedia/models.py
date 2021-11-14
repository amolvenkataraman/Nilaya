from django.db import models
from users.models import *
import uuid

# Create your models here.
class Post(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False, verbose_name='ID')
    posted_by = models.ForeignKey(ComptechUser, on_delete=models.CASCADE, related_name='post_posted_by')
    posted_on = models.DateTimeField(auto_now=True)
    likes = models.ManyToManyField(ComptechUser, related_name='post_likes')
    image = models.ImageField(upload_to='sm_posts', null=True, blank=True)
