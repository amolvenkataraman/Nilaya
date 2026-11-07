"""Personal API keys for the V2 API, scoped per app (read or write).

The token is shown once; only its SHA-256 is stored (tokens are 256-bit random, so a
fast hash is fine and lets every request be checked in one indexed lookup)."""

import hashlib
import hmac
import re
import secrets
import uuid

from django.conf import settings
from django.db import models
from django.utils import timezone

APPS = {
    "me": "Profile",
    "calendar": "Calendar",
    "tasks": "Tasks",
    "habits": "Habits",
    "contacts": "Contacts",
    "photos": "Photos",
    "places": "Places",
    "notifications": "Notifications",
}
SCOPES = {f"{app}:{level}" for app in APPS for level in ("read", "write")}
TOKEN_PREFIX = "nly_"
# Tokens look like <3 letters>_<8 hex>_<secret>. Keys made before the rename to Nilaya used another
# 3-letter prefix; they keep working because the stored hash covers the whole token.
_TOKEN_RE = re.compile(r"^[a-z]{3}_([0-9a-f]{8})_.+$")


def _digest(token):
    return hashlib.sha256(token.encode()).hexdigest()


class ApiKey(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="api_keys")
    name = models.CharField(max_length=64)
    prefix = models.CharField(max_length=16, unique=True)  # public part, shown in lists
    hashed = models.CharField(max_length=64)
    scopes = models.JSONField(default=list)  # e.g. ["tasks:write", "calendar:read"]
    created_on = models.DateTimeField(auto_now_add=True)
    expires_on = models.DateTimeField(null=True, blank=True)
    last_used_on = models.DateTimeField(null=True, blank=True)
    last_used_ip = models.GenericIPAddressField(null=True, blank=True)

    class Meta:
        ordering = ["-created_on"]
        verbose_name = "API key"

    def __str__(self):  # also the throttle identity
        return f"apikey:{self.id}"

    @classmethod
    def issue(cls, user, name, scopes, expires_on=None):
        prefix = secrets.token_hex(4)
        token = f"{TOKEN_PREFIX}{prefix}_{secrets.token_urlsafe(32)}"
        key = cls.objects.create(user=user, name=name, prefix=prefix, hashed=_digest(token),
                                 scopes=sorted(set(scopes)), expires_on=expires_on)
        return key, token

    @classmethod
    def from_token(cls, token):
        """The live key for a presented token, or None."""
        m = _TOKEN_RE.match(token or "")
        if not m:
            return None
        prefix = m.group(1)
        key = cls.objects.select_related("user").filter(prefix=prefix).first()
        if key is None or not hmac.compare_digest(key.hashed, _digest(token)):
            return None
        if (key.expires_on and key.expires_on <= timezone.now()) or not key.user.is_active:
            return None
        return key

    def allows(self, app, write):
        return f"{app}:write" in self.scopes or (not write and f"{app}:read" in self.scopes)
