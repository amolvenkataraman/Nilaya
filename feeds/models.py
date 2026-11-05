"""Private ICS feed URLs (subscribe from a phone's calendar app). The URL is the secret:
only its SHA-256 is stored, it's shown once, and it can be revoked."""

import hashlib
import hmac
import secrets
import uuid

from django.conf import settings
from django.db import models


def _digest(token):
    return hashlib.sha256(token.encode()).hexdigest()


class Feed(models.Model):
    KINDS = [("calendar", "Calendar events"), ("tasks", "Tasks with due dates")]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="feeds")
    kind = models.CharField(max_length=8, choices=KINDS)
    name = models.CharField(max_length=64)
    prefix = models.CharField(max_length=16, unique=True)
    hashed = models.CharField(max_length=64)
    created_on = models.DateTimeField(auto_now_add=True)
    last_fetched_on = models.DateTimeField(null=True, blank=True)
    fetches = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ["-created_on"]

    @classmethod
    def issue(cls, user, kind, name):
        prefix = secrets.token_hex(4)
        token = f"f_{prefix}_{secrets.token_urlsafe(24)}"
        return cls.objects.create(user=user, kind=kind, name=name, prefix=prefix, hashed=_digest(token)), token

    @classmethod
    def from_token(cls, token):
        parts = token.split("_")
        if len(parts) < 3 or parts[0] != "f":
            return None
        feed = cls.objects.select_related("user").filter(prefix=parts[1]).first()
        if feed is None or not hmac.compare_digest(feed.hashed, _digest(token)) or not feed.user.is_active:
            return None
        return feed
