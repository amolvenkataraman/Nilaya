from django.db import models
from users.models import *
from Comptech.utils import get_model_attrs

# Create your models here.
class Notification(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False, verbose_name='ID')
    user = models.ForeignKey(ComptechUser, on_delete=models.CASCADE, related_name='notification_user')
    title = models.CharField(max_length=128, null=False, blank=False)
    source = models.CharField(max_length=128, null=False, blank=False)
    description = models.TextField(null=True, blank=True)
    created_on = models.DateTimeField(auto_now=True)
    priority = models.SmallIntegerField(default=10)
    device_group = models.SmallIntegerField(default=0)
    expires_on = models.DateTimeField(auto_now=False, null=True, blank=True)
    read = models.BooleanField(default=False)

    def __str__(self):
        return f"{self.title} for {self.user.username}"
