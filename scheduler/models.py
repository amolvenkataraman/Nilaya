from django.db import models
from users.models import *
from Comptech.utils import get_model_attrs

# Create your models here.
class Invite(models.Model):
    calendar = models.ForeignKey('Calendar', on_delete=models.CASCADE)
    code = models.CharField(max_length=8, unique=True)
    uses = models.IntegerField(default=0)
    active = models.BooleanField(default=True)

    def __str__(self):
        return f"{self.code}, for {self.calendar.name}"

    def getinfo(self, full=False):
        ans = get_model_attrs(self, ["id", "code", "uses", "active"])

        if full: ans["calendar"] = self.calendar.getinfo()
        return ans
    
    @classmethod
    def get_user_objs(cls, user):
        pass

class Calendar(models.Model):
    name = models.CharField(max_length=64)
    owner = models.ForeignKey(ComptechUser, on_delete=models.CASCADE, related_name='calendar_owner')
    colour = models.CharField(max_length=16, default='#000000')
    public = models.BooleanField(default=False)
    active = models.BooleanField(default=True)
    calendar_type = models.PositiveSmallIntegerField(choices=(
        (0, 'Local Calendar'),
        (1, 'ICalendar'),
        (2, 'Google Calendar'),
        (50, 'UWaterloo WCMS'),
    ), default=0)
    calendar_url = models.CharField(max_length=256, null=True, blank=True)
    auto_sync = models.BooleanField(default=False)
    auto_sync_sm = models.IntegerField(null=True, blank=True)
    auto_sync_sy = models.IntegerField(null=True, blank=True)
    auto_sync_em = models.IntegerField(null=True, blank=True)
    auto_sync_ey = models.IntegerField(null=True, blank=True)

    def  __str__(self):
        return f"{self.name}, Owner: {self.owner.username}"

    def getinfo(self):
        ans = get_model_attrs(self, ["id", "name", "colour", "public", "active", "calendar_type", "auto_sync"])
        ans["owner"] = {"id": self.owner.id}

        return ans

    def get_subs(self):
        return {
            "owner": self.owner.getinfo(),
            "subscribers": [i.getinfo(user=True) for i in self.users_subscribed.all()],
            "invites": [i.getinfo() for i in Invite.objects.filter(calendar=self)]
        }

class Subscriber(models.Model):
    calendar = models.ForeignKey(Calendar, on_delete=models.CASCADE, related_name='users_subscribed')
    user = models.ForeignKey(ComptechUser, on_delete=models.CASCADE, related_name='calendar_subscribed')
    subscribe_type = models.PositiveSmallIntegerField(choices=(
        (0, 'Owner'),
        (1, 'Admin'),
        (2, 'Subscriber'),
    ), default=2)
    display_busy = models.PositiveSmallIntegerField(choices=(
        (0, 'None'),
        (1, 'Event Type Only'),
        (2, 'All'),
    ), default=0)
    colour = models.CharField(max_length=16, null=True, blank=True, default=None)
    visible = models.BooleanField(default=True)

    def __str__(self):
        return f"{self.user.username} subscribed to {self.calendar.name}"

    def getinfo(self, cal=False, user=False):
        ans = get_model_attrs(self, ["id", "subscribe_type", "display_busy", "colour", "visible"])
        ans["user"] = self.user.id

        if cal: ans["calendar"] = self.calendar.getinfo()
    
        if user: ans["user"] = self.user.getinfo()

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
        (8, 'Test / Exam'),
        (9, 'Lecture'),
        (100, 'Other'),
    ), default=0)
    location = models.CharField(max_length=256, null=True, blank=True)
    description = models.TextField(null=True, blank=True)
    completed = models.BooleanField(default=False)
    public = models.BooleanField(default=False)
    priority = models.SmallIntegerField(default=10)
    repeat_every = models.IntegerField(null=True, blank=True)
    repeat_end = models.DateField(null=True, blank=True)
    sync_id = models.CharField(max_length=256, null=True, blank=True)
    custom_info = models.JSONField(default={}, null=True, blank=True)

    def __str__(self):
        return f"{self.name} for {self.calendar.name}. From {str(self.startdate)} to {str(self.enddate)}"

    def getinfo(self, full=False):
        ans = get_model_attrs(self, ["id", "name", "startdate", "enddate", "allday", "category", "location", "description", "completed", "public", "priority"])
        ans["calendar"] = self.calendar.id

        if full: ans = {**ans, **get_model_attrs(self, ["repeat_every", "repeat_end", "sync_id"])}

        return ans
        
    @classmethod
    def get_user_objs(cls, user):
        pass

class Todo(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False, verbose_name='ID')
    parent = models.ForeignKey("self", on_delete=models.CASCADE, null=True, blank=True)
    user = models.ForeignKey(ComptechUser, on_delete=models.CASCADE)
    name = models.CharField(max_length=256)
    status = models.PositiveSmallIntegerField(choices=(
        (0, 'Uncategorized'),
        (1, 'Backlog'),
        (2, 'Waiting'),
        (3, 'To-do'),
        (11, 'Design'),
        (12, 'In-Progress'),
        (13, 'Testing'),
        (100, 'Completed'),
    ), default=0)
    description = models.TextField(null=True, blank=True)
    priority = models.SmallIntegerField(default=10)
    completed = models.BooleanField(default=False)
    complete_by = models.DateTimeField(auto_now=False, null=True, blank=True)
    completed_on = models.DateTimeField(auto_now=False, null=True, blank=True)
    percent_complete = models.PositiveSmallIntegerField(null=True, blank=True)
    time_spent = models.PositiveSmallIntegerField(null=True, blank=True)
    custom_info = models.JSONField(default={}, null=True, blank=True)

    def __str__(self):
        return f"{self.name} for {self.user.username}."

    def getinfo(self):
        ans = get_model_attrs(self, ["id", "name", "description", "priority", "completed", "complete_by", "completed_on", "percent_complete", "time_spent"])
        ans["user"] = self.user.id

        return ans

class Habit(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False, verbose_name='ID')
    user = models.ForeignKey(ComptechUser, on_delete=models.CASCADE)
    name = models.CharField(max_length=256)
    frequency = models.PositiveSmallIntegerField(choices=(
        (1, 'Daily'),
        (7, 'Weekly'),
        (30, 'Monthly'),
    ), default=1)
    start_day = models.DateField()
    end_day = models.DateField(null=True, blank=True)
    description = models.TextField(null=True, blank=True)
    priority = models.SmallIntegerField(default=10)
    daily_default = models.SmallIntegerField(default=0)
    daily_goal = models.SmallIntegerField(default=1)
    below_goal = models.BooleanField(default=False)
    custom_info = models.JSONField(default={}, null=True, blank=True)

    def __str__(self):
        return f"{self.name} for {self.user.username}."

    def getinfo(self):
        ans = get_model_attrs(self, ["id", "name", "frequency", "description", "priority", "daily_default", "daily_goal"])
        ans["user"] = self.user.id

        return ans

class Habit_Day(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False, verbose_name='ID')
    habit = models.ForeignKey(Habit, on_delete=models.CASCADE)
    day = models.DateField()
    value = models.SmallIntegerField(default=0)

    def __str__(self):
        return f"{self.habit.name} on {self.day} [{self.value}]"

    def getinfo(self):
        ans = get_model_attrs(self, ["id", "day", "value"])
        ans["habit"] = self.habit.id

        return ans
