from django.db import models
from users.models import *

# Create your models here.
class DirectMessage(models.Model):
    created_on = models.DateTimeField(auto_now=True)
    name = models.CharField(max_length=32, null=True, blank=True)

    def getinfo(self):
        ans = {
            "id": self.id,
            "created_on": self.created_on,
            "users": [ComptechUser.objects.filter(id=i.user_id)[0].getinfo() for i in DMUser.objects.filter(dm=self)]
        }

        if self.name != None:
            ans["name"] = self.name
        else:
            ans["name"] = str([ComptechUser.objects.filter(id=i.user_id)[0].username for i in DMUser.objects.filter(dm=self)])

        return ans

class DMUser(models.Model):
    dm = models.ForeignKey(DirectMessage, on_delete=models.CASCADE)
    user_id = models.IntegerField()

class Message(models.Model):
    dm = models.ForeignKey(DirectMessage, on_delete=models.CASCADE)
    message = models.CharField(max_length=2048, null=True, blank=True)
    attachment = models.FileField(upload_to='media/chat/attachments')
    sent_by = models.IntegerField()
    sent_time = models.DateTimeField(auto_now=True)
