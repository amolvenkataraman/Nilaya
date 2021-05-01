from django.db import models
from users.models import *

# Create your models here.
class Calendar(models.Model):
    name = models.CharField(max_length=64, unique=True)
    owner = models.ForeignKey(ComptechUser, on_delete=models.CASCADE, related_name='calendar_owner')
    subscribers = models.ManyToManyField(ComptechUser, related_name='calendar_subscribers', null=True, blank=True)
    active = models.BooleanField(default=True)

    def  __str__(self):
        return f"{self.name}, Owner: {self.owner.username}"

    def getinfo(self):
        ans = {
            "id": self.id,
            "name": self.name,
            "owner": self.owner.getinfo(),
            "active": str(self.active),
        }

        return ans

    def getsubscribers(self):
        return {"subscribers": [i.getinfo() for i in self.subscribers.all()]}

"""
class Group(models.Model):
    name = models.CharField(max_length=64, unique=True)
    classes = models.ManyToManyField(Class, related_name='group_class')

    def __str__(self):
        return f"{self.name}"


class Invite(models.Model):
    Class = models.ForeignKey(Class, on_delete=models.CASCADE)
    code = models.CharField(max_length=8, unique=True)
    uses = models.IntegerField(default=0)
    active = models.BooleanField(default=True)

    def __str__(self):
        return f"{self.code}, for {self.Class.name}"

    def getinfo(self):
        ans = {
            "id": self.id,
            "class": self.Class.getinfo(),
            "code": self.code,
            "uses": self.uses,
            "active": str(self.active),
        }
        return ans
"""

class Event(models.Model):
    calendar = models.ForeignKey(Calendar, on_delete=models.CASCADE)
    name = models.CharField(max_length=256)
    startdate = models.DateTimeField(auto_now=False)
    enddate = models.DateTimeField(auto_now=False)
    description = models.TextField(null=True, blank=True)
    public = models.BooleanField(default=False)

    def __str__(self):
        return f"{self.name} for {self.calendar.name}. From {str(self.startdate)} to {str(self.enddate)}"

    def getinfo(self):
        ans = {
            "id": self.id,
            "calendar": self.calendar.getinfo(),
            "name": self.name,
            "startdate": str(self.startdate),
            "enddate": str(self.enddate),
            "description": self.description,
            "public": str(self.public),
        }
        return ans

    def getinfo_zip(self):
        ans = {
            "id": self.id,
            "name": self.name,
            "startdate": str(self.startdate),
            "enddate": str(self.enddate),
            "description": self.description,
            "public": str(self.public),
        }
        return ans

class Reminder(models.Model):
    calendar = models.ForeignKey(Calendar, on_delete=models.CASCADE)
    name = models.CharField(max_length=256)
    date = models.DateField(auto_now=False)
    description = models.TextField(null=True, blank=True)
    completed = models.BooleanField(default=False)

    def __str__(self):
        return f"{self.name} for {self.calendar.name}. On {str(self.date)}"

    def getinfo(self):
        ans = {
            "id": self.id,
            "calendar": self.calendar.getinfo(),
            "name": self.name,
            "date": str(self.date),
            "description": self.description,
            "completed": str(self.completed),
        }
        return ans

    def getinfo_zip(self):
        ans = {
            "id": self.id,
            "name": self.name,
            "date": str(self.date),
            "description": self.description,
            "completed": str(self.completed),
        }
        return ans


