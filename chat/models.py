from django.db import models
from users.models import *

# Create your models here.
class DirectMessage(models.Model):
    created_on = models.DateTimeField(auto_now=True)
    name = models.CharField(max_length=32, null=True, blank=True)

    def getinfo(self):
        ans = {
            "id": self.id,
            "created_on": str(self.created_on),
        }

        dm_users = DMUser.objects.filter(dm=self).values_list('user_id', flat=True)
        users = [i.getinfo_zip() for i in ComptechUser.objects.filter(id__in=list(dm_users))]
        ans["users"] = users

        if self.name == None:
            ans["name"] = ", ".join([i["username"] for i in users])
        else:
            ans["name"] = self.name

        return ans

class DMUser(models.Model):
    dm = models.ForeignKey(DirectMessage, on_delete=models.CASCADE)
    user_id = models.IntegerField()

class Message(models.Model):
    dm = models.ForeignKey(DirectMessage, on_delete=models.CASCADE)
    message = models.CharField(max_length=2048, null=True, blank=True)
    attachment = models.FileField(upload_to='chat/attachments', null=True, blank=True)
    sent_by = models.IntegerField()
    sent_time = models.DateTimeField(auto_now=True)

    def getinfo(self):
        user_ = ComptechUser.objects.filter(id=self.sent_by)[0]
        ans = {
            "dm": self.dm.id,
            "message": self.message,
            "sent_by_id": self.sent_by,
            "sent_by_user": {"id": user_.id, "username": user_.username},
            "sent_time": str(self.sent_time),
        }

        return ans
