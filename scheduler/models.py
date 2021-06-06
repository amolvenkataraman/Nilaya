from django.db import models
from users.models import *

# Create your models here.
class Invite(models.Model):
    calendar = models.ForeignKey('Calendar', on_delete=models.CASCADE)
    code = models.CharField(max_length=8, unique=True)
    uses = models.IntegerField(default=0)
    active = models.BooleanField(default=True)

    def __str__(self):
        return f"{self.code}, for {self.calendar.name}"

    def getinfo(self):
        ans = {
            "id": self.id,
            "calendar": self.calendar.getinfo(),
            "code": self.code,
            "uses": self.uses,
            "active": str(self.active),
        }
        return ans

class Calendar(models.Model):
    name = models.CharField(max_length=64, unique=True)
    owner = models.ForeignKey(ComptechUser, on_delete=models.CASCADE, related_name='calendar_owner')
    subscribers = models.ManyToManyField(ComptechUser, related_name='calendar_subscribers', blank=True)
    calendar_type = models.PositiveSmallIntegerField(choices=(
        (0, 'Local Calendar'),
        (1, 'Google Calendar'),
    ), default=0)
    calendar_url = models.CharField(max_length=64, null=True, blank=True)
    colour = models.CharField(max_length=16, default='#000000')
    active = models.BooleanField(default=True)

    def  __str__(self):
        return f"{self.name}, Owner: {self.owner.username}"

    def getinfo(self):
        ans = {
            "id": self.id,
            "name": self.name,
            "owner": {"id": self.owner.id, "username": self.owner.username, "first_name": self.owner.first_name, "last_name": self.owner.last_name},
            "calendar_type": self.calendar_type,
            "active": str(self.active),
            "colour": self.colour,
        }

        if self.calendar_type != 0:
            ans["calendar_url"] = self.calendar_url

        return ans

    def getinfo_full(self):
        ans = {
            "id": self.id,
            "name": self.name,
            "owner": {"id": self.owner.id, "username": self.owner.username, "first_name": self.owner.first_name, "last_name": self.owner.last_name},
            "active": str(self.active),
            "calendar_type": self.calendar_type,
            "colour": self.colour,
            "subscribers": [i.getinfo_zip() for i in self.subscribers.all()],
            "invites": [i.getinfo() for i in Invite.objects.filter(calendar=self)]
        }

        if self.calendar_type != 0:
            ans["calendar_url"] = self.calendar_url

        return ans

class Assignment(models.Model):
    calendar = models.ForeignKey(Calendar, on_delete=models.CASCADE)
    name = models.CharField(max_length=256)
    date = models.DateTimeField(auto_now=False)
    description = models.TextField(null=True, blank=True)
    public = models.BooleanField(default=False)
    priority = models.SmallIntegerField(default=10)

    def __str__(self):
        return f"{self.name} for {self.calendar.name}. Due: {str(self.date)}"

    def getinfo(self):
        ans = {
            "id": self.id,
            "calendar": self.calendar.getinfo(),
            "name": self.name,
            "date": str(self.date),
            "description": self.description,
            "public": str(self.public),
            "priority": self.priority,
        }
        return ans

    def getinfo_zip(self):
        ans = {
            "id": self.id,
            "name": self.name,
            "date": str(self.date),
            "description": self.description,
            "public": str(self.public),
            "priority": self.priority,
        }
        return ans

class Event(models.Model):
    calendar = models.ForeignKey(Calendar, on_delete=models.CASCADE)
    name = models.CharField(max_length=256)
    startdate = models.DateTimeField(auto_now=False)
    enddate = models.DateTimeField(auto_now=False)
    description = models.TextField(null=True, blank=True)
    public = models.BooleanField(default=False)
    priority = models.SmallIntegerField(default=10)

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
            "priority": self.priority,
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
            "priority": self.priority,
        }
        return ans

class Task(models.Model):
    calendar = models.ForeignKey(Calendar, on_delete=models.CASCADE)
    name = models.CharField(max_length=256)
    date = models.DateField(auto_now=False)
    description = models.TextField(null=True, blank=True)
    completed = models.BooleanField(default=False)
    priority = models.SmallIntegerField(default=10)

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
            "priority": self.priority,
        }
        return ans

    def getinfo_zip(self):
        ans = {
            "id": self.id,
            "name": self.name,
            "date": str(self.date),
            "description": self.description,
            "completed": str(self.completed),
            "priority": self.priority,
        }
        return ans

