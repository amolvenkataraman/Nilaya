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


class Assignment(models.Model):
    Class = models.ForeignKey(Class, on_delete=models.CASCADE)
    name = models.CharField(max_length=256)
    deadline = models.DateTimeField(auto_now=False)
    url = models.URLField(null=True)
    description = models.TextField()
    graded = models.BooleanField(default=False)
    priority = models.SmallIntegerField(default=3)

    def __str__(self):
        return f"{self.name} for {self.Class.name}. Due: {str(self.deadline)}"

    def getinfo(self):
        ans = {
            "id": self.id,
            "class": self.Class.getinfo(),
            "name": self.name,
            "deadline": str(self.deadline),
            "url": self.url,
            "description": self.description,
            "graded": str(self.graded),
            "priority": self.priority,
        }
        return ans
"""

class Event(models.Model):
    calendar = models.ForeignKey(Calendar, on_delete=models.CASCADE)
    name = models.CharField(max_length=256)
    startdate = models.DateTimeField(auto_now=False)
    enddate = models.DateTimeField(auto_now=False)
    description = models.TextField(null=True, blank=True)

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
        }
        return ans

"""
class Org_Event(models.Model):
    name = models.CharField(max_length=256)
    startdate = models.DateTimeField(auto_now=False)
    enddate = models.DateTimeField(auto_now=False)
    description = models.TextField()
    specialschedule = models.BooleanField(default=False)
    holiday = models.BooleanField(default=False)
    sync_from = models.CharField(max_length=32, null=True, default="")
    sync_id = models.CharField(max_length=128, null=True, default="")
    
    def __str__(self):
        return f"{self.name}. From {str(self.startdate)} to {str(self.enddate)}"

    def getinfo(self):
        ans = {
            "id": self.id,
            "name": self.name,
            "startdate": str(self.startdate),
            "enddate": str(self.enddate),
            "description": self.description,
            "specialschedule": str(self.specialschedule),
            "holiday": str(self.holiday),
        }
        return ans
"""
