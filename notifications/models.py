import uuid

from django.db import models

from users.models import ComptechUser


class Priority(models.IntegerChoices):
    LOW = 0, "Low"
    NORMAL = 10, "Normal"
    HIGH = 15, "High"
    URGENT = 20, "Urgent"


class Notification(models.Model):
    """One message for one user, shown in the bell menu and delivered to their channels."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False, verbose_name='ID')
    user = models.ForeignKey(ComptechUser, on_delete=models.CASCADE, related_name='notification_user')
    title = models.CharField(max_length=128, null=False, blank=False)
    source = models.CharField(max_length=128, null=False, blank=False)  # app that sent it, e.g. "Calendar"
    description = models.TextField(null=True, blank=True)
    url = models.CharField(max_length=512, blank=True, default="")  # in-app link, e.g. /calendar/
    created_on = models.DateTimeField(auto_now_add=True)
    priority = models.SmallIntegerField(default=Priority.NORMAL)
    device_group = models.SmallIntegerField(default=0)
    expires_on = models.DateTimeField(auto_now=False, null=True, blank=True)
    read = models.BooleanField(default=False)
    read_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_on"]
        indexes = [models.Index(fields=["user", "read", "-created_on"], name="notif_user_read_idx")]

    def __str__(self):
        return f"{self.title} for {self.user.username}"


class NotificationChannel(models.Model):
    """Somewhere outside the app a user's notifications are pushed to (phone, email, chat, ...)."""

    class Kind(models.TextChoices):
        NTFY = "ntfy", "ntfy"
        GOTIFY = "gotify", "Gotify"
        EMAIL = "email", "Email"
        DISCORD = "discord", "Discord webhook"
        WEBHOOK = "webhook", "Webhook (JSON, e.g. Home Assistant)"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(ComptechUser, on_delete=models.CASCADE, related_name="notification_channels")
    kind = models.CharField(max_length=16, choices=Kind.choices)
    name = models.CharField(max_length=64)
    config = models.JSONField(default=dict, blank=True)  # kind-specific: url, token, address, secret
    enabled = models.BooleanField(default=True)
    min_priority = models.SmallIntegerField(default=Priority.LOW)  # only deliver at/above this
    created_on = models.DateTimeField(auto_now_add=True)
    last_sent_at = models.DateTimeField(null=True, blank=True)
    last_error = models.TextField(blank=True, default="")

    class Meta:
        ordering = ["created_on"]

    def __str__(self):
        return f"{self.get_kind_display()} '{self.name}' for {self.user.username}"
