from django.db import models
from users.models import *
from rest_framework import serializers

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
    name = models.CharField(max_length=64)
    owner = models.ForeignKey(ComptechUser, on_delete=models.CASCADE, related_name='calendar_owner')
    calendar_type = models.PositiveSmallIntegerField(choices=(
        (0, 'Local Calendar'),
        (1, 'ICalendar'),
        (2, 'Google Calendar'),
    ), default=0)
    calendar_url = models.CharField(max_length=128, null=True, blank=True)
    colour = models.CharField(max_length=16, default='#000000')
    active = models.BooleanField(default=True)

    def  __str__(self):
        return f"{self.name}, Owner: {self.owner.username}"

    def getinfo(self):
        ans = {
            "id": self.id,
            "name": self.name,
            "owner": {"id": self.owner.id},
            "calendar_type": self.calendar_type,
            "active": str(self.active),
            "colour": self.colour,
        }

        return ans

    def getinfo_full(self):
        ans = {
            "id": self.id,
            "name": self.name,
            "owner": {"id": self.owner.id, "username": self.owner.username, "first_name": self.owner.first_name, "last_name": self.owner.last_name},
            "active": str(self.active),
            "calendar_type": self.calendar_type,
            "colour": self.colour,
            "subscribers": [i.getinfo_zip() for i in self.users_subscribed.all()],
            "invites": [i.getinfo() for i in Invite.objects.filter(calendar=self)]
        }

        if self.calendar_type != 0:
            ans["calendar_url"] = self.calendar_url

        return ans

class Subscriber(models.Model):
    calendar = models.ForeignKey(Calendar, on_delete=models.CASCADE, related_name='users_subscribed')
    user = models.ForeignKey(ComptechUser, on_delete=models.CASCADE, related_name='calendar_subscribed')
    subscribe_type = models.PositiveSmallIntegerField(choices=(
        (0, 'Owner'),
        (1, 'Admin'),
        (2, 'Subscriber'),
    ), default=0)
    visible = models.BooleanField(default=True)

    def __str__(self):
        return f"{self.user.username} subscribed to {self.calendar.name}"

    def getinfo(self):
        ans = {
            "id": self.calendar.id,
            "subscribe_id": self.id,
            "name": self.calendar.name,
            "owner": self.calendar.owner.id,
            "calendar_type": self.calendar.calendar_type,
            "active": str(self.calendar.active),
            "colour": self.calendar.colour,
            "user": self.user.id,
            "subscribe_type": self.subscribe_type,
            "visible": str(self.visible),
        }

        return ans

    def getinfo_zip(self):
        ans = {
            "id": self.id,
            "user": self.user.getinfo_zip(),
            "subscribe_type": self.subscribe_type,
        }

        return ans

class Event(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False, verbose_name='ID')
    calendar = models.ForeignKey(Calendar, on_delete=models.CASCADE)
    name = models.CharField(max_length=256, null=False, blank=False)
    startdate = models.DateTimeField(auto_now=False)
    enddate = models.DateTimeField(auto_now=False, null=True, blank=True)
    allday = models.BooleanField(default=False)
    category = models.PositiveSmallIntegerField(choices=(
        (0, 'Uncategorized'),
        (1, 'Meeting'),
        (2, 'Focus Time'),
        (3, 'Break Time'),
        (4, 'Study'),
        (5, 'Work'),
        (6, 'Personal'),
        (7, 'Tech Break'),
        (8, 'Other'),
    ), default=0)
    description = models.TextField(null=True, blank=True)
    public = models.BooleanField(default=False)
    priority = models.SmallIntegerField(default=10)
    repeat_every = models.IntegerField(null=True, blank=True)
    repeat_end = models.DateField(null=True, blank=True)
    sync_id = models.CharField(max_length=64, null=True, blank=True)

    def __str__(self):
        return f"{self.name} for {self.calendar.name}. From {str(self.startdate)} to {str(self.enddate)}"

    def getinfo(self):
        ans = {
            "id": str(self.id),
            "calendar": self.calendar.id,
            "name": self.name,
            "startdate": str(self.startdate),
            "enddate": str(self.enddate),
            "allday": self.allday,
            "category": self.category,
            "description": self.description,
            "public": str(self.public),
            "priority": self.priority,
            "repeat_every": self.repeat_every,
            "repeat_end": self.repeat_end,
        }
        return ans

class Todo(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False, verbose_name='ID')
    user = models.ForeignKey(ComptechUser, on_delete=models.CASCADE)
    name = models.CharField(max_length=256)
    description = models.TextField(null=True, blank=True)
    completed = models.BooleanField(default=False)
    priority = models.SmallIntegerField(default=10)
    recurring = models.BooleanField(default=False)
    completiondate = models.DateTimeField(auto_now=False, null=True, blank=True)

    def __str__(self):
        return f"{self.name} for {self.user.username}."

    def getinfo(self):
        ans = {
            "id": str(self.id),
            "user": self.user.id,
            "name": self.name,
            "description": self.description,
            "completed": str(self.completed),
            "priority": self.priority,
            "recurring": str(self.recurring),
            "completion": str(self.completiondate),
        }
        return ans
