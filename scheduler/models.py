from django.db import models
from django.utils import timezone
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

def user_brief(user):
    """The minimum other people need to recognise a user."""
    return {"id": str(user.id), "username": user.username,
            "first_name": user.first_name, "last_name": user.last_name}

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

    def get_subs(self, editor=False):
        """Who's in the calendar. Only names are shared (no birthdays, groups or
        admin flags); the subscriber list and invite codes are for owners/admins."""
        ans = {"owner": user_brief(self.owner), "subscribers": [], "invites": []}
        if editor:
            ans["subscribers"] = [i.getinfo(user=True) for i in self.users_subscribed.select_related('user')]
            ans["invites"] = [i.getinfo() for i in Invite.objects.filter(calendar=self)]
        return ans

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
    
        if user: ans["user"] = user_brief(self.user)

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
    custom_info = models.JSONField(default=dict, null=True, blank=True)

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
    custom_info = models.JSONField(default=dict, null=True, blank=True)

    # Tasks app (Vikunja-style). complete_by = due date, completed/completed_on = done.
    project = models.ForeignKey('tasks.Project', on_delete=models.CASCADE, null=True, blank=True, related_name='tasks')
    bucket = models.ForeignKey('tasks.Bucket', on_delete=models.SET_NULL, null=True, blank=True, related_name='tasks')
    position = models.FloatField(default=0)
    labels = models.ManyToManyField('tasks.Label', blank=True, related_name='tasks')
    assignees = models.ManyToManyField(ComptechUser, blank=True, related_name='assigned_todos')
    start_on = models.DateTimeField(null=True, blank=True)
    repeat_mode = models.PositiveSmallIntegerField(choices=(
        (0, 'Does not repeat'),
        (1, 'Every interval after the due date'),
        (2, 'Monthly'),
        (3, 'Every interval after completion'),
    ), default=0)
    repeat_every = models.PositiveIntegerField(null=True, blank=True)  # seconds, for modes 1 and 3
    favorite = models.BooleanField(default=False)
    colour = models.CharField(max_length=7, blank=True, default='')
    created_on = models.DateTimeField(default=timezone.now)
    updated_on = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"{self.name} for {self.user.username}."

    def getinfo(self):
        ans = get_model_attrs(self, ["id", "name", "description", "priority", "completed", "complete_by", "completed_on", "percent_complete", "time_spent"])
        ans["user"] = self.user.id

        return ans
