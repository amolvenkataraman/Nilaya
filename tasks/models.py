"""Tasks: projects, kanban buckets, labels, reminders, comments, relations and
saved views around the existing scheduler.Todo (which stays the task row, so the
calendar and home page keep showing the same todos)."""

import uuid

from django.conf import settings
from django.db import models
from django.utils import timezone


class Project(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="task_projects")
    parent = models.ForeignKey("self", on_delete=models.CASCADE, null=True, blank=True, related_name="children")
    name = models.CharField(max_length=128)
    description = models.TextField(blank=True, default="")
    colour = models.CharField(max_length=7, blank=True, default="")
    is_inbox = models.BooleanField(default=False)
    archived = models.BooleanField(default=False)
    favorite = models.BooleanField(default=False)
    position = models.FloatField(default=0)
    default_view = models.CharField(max_length=8, default="list")  # list | board | table | calendar
    created_on = models.DateTimeField(default=timezone.now)
    updated_on = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["position", "name"]
        constraints = [models.UniqueConstraint(fields=["owner"], condition=models.Q(is_inbox=True),
                                               name="tasks_one_inbox_per_user")]

    def __str__(self):
        return f"{self.name} ({self.owner})"


class ProjectMember(models.Model):
    class Role(models.IntegerChoices):
        READ = 0, "Can view"
        WRITE = 1, "Can edit"
        ADMIN = 2, "Admin"

    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name="members")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="task_memberships")
    role = models.PositiveSmallIntegerField(choices=Role.choices, default=Role.WRITE)

    class Meta:
        unique_together = [("project", "user")]


class Bucket(models.Model):
    """A kanban column. Moving a task into the done bucket completes it."""
    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name="buckets")
    name = models.CharField(max_length=64)
    position = models.FloatField(default=0)
    limit = models.PositiveSmallIntegerField(default=0)  # 0 = no WIP limit
    is_done = models.BooleanField(default=False)

    class Meta:
        ordering = ["position", "id"]


class Label(models.Model):
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="task_labels")
    name = models.CharField(max_length=48)
    colour = models.CharField(max_length=7, blank=True, default="")

    class Meta:
        ordering = ["name"]
        unique_together = [("owner", "name")]


class Reminder(models.Model):
    """Absolute (at) or relative to the task's due/start date (relative_to + offset seconds, negative = before)."""
    todo = models.ForeignKey("scheduler.Todo", on_delete=models.CASCADE, related_name="reminders")
    at = models.DateTimeField(null=True, blank=True)
    relative_to = models.CharField(max_length=8, blank=True, default="")  # "" | due | start
    offset = models.IntegerField(default=0)
    fire_at = models.DateTimeField(null=True, blank=True, db_index=True)  # resolved time, kept in sync
    sent_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["fire_at"]

    def resolve(self):
        base = {"due": self.todo.complete_by, "start": self.todo.start_on}.get(self.relative_to)
        self.fire_at = self.at if not self.relative_to else (
            base + timezone.timedelta(seconds=self.offset) if base else None)
        return self.fire_at


class Comment(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    todo = models.ForeignKey("scheduler.Todo", on_delete=models.CASCADE, related_name="comments")
    author = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="task_comments")
    body = models.TextField()
    created_on = models.DateTimeField(default=timezone.now)
    edited_on = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["created_on"]


class Relation(models.Model):
    """Directed link; the inverse row is created alongside it (blocks <-> blocked_by, ...)."""
    KINDS = {"related": "related", "blocks": "blocked_by", "blocked_by": "blocks",
             "duplicate_of": "duplicated_by", "duplicated_by": "duplicate_of",
             "precedes": "follows", "follows": "precedes"}

    todo = models.ForeignKey("scheduler.Todo", on_delete=models.CASCADE, related_name="relations")
    other = models.ForeignKey("scheduler.Todo", on_delete=models.CASCADE, related_name="+")
    kind = models.CharField(max_length=16)

    class Meta:
        unique_together = [("todo", "other", "kind")]


class SavedView(models.Model):
    """A saved filter ("smart list"): the task-list query parameters, stored as JSON."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="task_views")
    name = models.CharField(max_length=64)
    filters = models.JSONField(default=dict)
    position = models.FloatField(default=0)

    class Meta:
        ordering = ["position", "name"]
