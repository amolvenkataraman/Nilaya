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


class Device(models.Model):
    """A phone signed in to the mobile apps. Each app on it holds its own ApiKey, limited to that app.
    The device token (kept on the phone, stored hashed here like a key) does one thing: get those app
    keys, so a second app doesn't ask for the password. Deleting a device revokes all of its keys."""

    TOKEN_PREFIX = "nld_"
    PHONE_APPS = tuple(a for a in APPS if a != "me")  # apps a phone can ask a key for

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="devices")
    name = models.CharField(max_length=64)
    prefix = models.CharField(max_length=16, unique=True)
    hashed = models.CharField(max_length=64)
    created_on = models.DateTimeField(auto_now_add=True)
    last_used_on = models.DateTimeField(null=True, blank=True)  # last time an app asked for a key

    class Meta:
        ordering = ["-created_on"]

    def __str__(self):
        return f"device:{self.id}"

    @classmethod
    def issue(cls, user, name):
        prefix = secrets.token_hex(4)
        token = f"{cls.TOKEN_PREFIX}{prefix}_{secrets.token_urlsafe(32)}"
        return cls.objects.create(user=user, name=name, prefix=prefix, hashed=_digest(token)), token

    @classmethod
    def from_token(cls, token):
        """The device for a presented device token, or None."""
        m = _TOKEN_RE.match(token or "")
        if not m or not token.startswith(cls.TOKEN_PREFIX):
            return None
        device = cls.objects.select_related("user").filter(prefix=m.group(1)).first()
        if device is None or not hmac.compare_digest(device.hashed, _digest(token)) or not device.user.is_active:
            return None
        return device

    def app_key(self, app):
        """A new key for one app on this device: write access to that app, plus reading the profile.
        It replaces the key that app had here, so reinstalling an app doesn't leave a stale one."""
        for key in self.keys.all():
            if f"{app}:write" in key.scopes:
                key.delete()
        self.last_used_on = timezone.now()
        self.save(update_fields=["last_used_on"])
        return ApiKey.issue(self.user, f"{self.name} · {APPS[app]}"[:64], [f"{app}:write", "me:read"], device=self)


class ApiKey(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="api_keys")
    device = models.ForeignKey(Device, on_delete=models.CASCADE, related_name="keys", null=True, blank=True)
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
    def issue(cls, user, name, scopes, expires_on=None, device=None):
        prefix = secrets.token_hex(4)
        token = f"{TOKEN_PREFIX}{prefix}_{secrets.token_urlsafe(32)}"
        key = cls.objects.create(user=user, name=name, prefix=prefix, hashed=_digest(token),
                                 scopes=sorted(set(scopes)), expires_on=expires_on, device=device)
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
