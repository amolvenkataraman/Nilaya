"""/api/v2/keys/: manage your API keys (signed-in browser session only)."""

import datetime
import uuid
from typing import Optional

from django.shortcuts import get_object_or_404
from ninja import Field, Router, Schema
from ninja.errors import HttpError
from ninja.security import django_auth

from notifications.service import Priority, notify

from .models import APPS, SCOPES, ApiKey

router = Router(tags=["api keys"], auth=django_auth)
MAX_KEYS = 25


class KeyOut(Schema):
    id: uuid.UUID
    name: str
    prefix: str
    scopes: list[str]
    created_on: datetime.datetime
    expires_on: Optional[datetime.datetime]
    last_used_on: Optional[datetime.datetime]
    last_used_ip: Optional[str]


class KeyCreated(Schema):
    key: KeyOut
    token: str  # shown once


class KeyIn(Schema):
    name: str = Field(..., min_length=1, max_length=64)
    scopes: list[str] = Field(..., min_length=1)
    expires_on: Optional[datetime.datetime] = None


class KeyPatch(Schema):
    name: Optional[str] = Field(None, min_length=1, max_length=64)
    scopes: Optional[list[str]] = Field(None, min_length=1)


def _check_scopes(scopes):
    bad = set(scopes) - SCOPES
    if bad:
        raise HttpError(400, f"Unknown scope(s): {', '.join(sorted(bad))}")


@router.get("/apps", summary="Apps and access levels a key can be given")
def apps(request):
    return [{"app": k, "label": v, "scopes": [f"{k}:read", f"{k}:write"]} for k, v in APPS.items()]


@router.get("/", response=list[KeyOut])
def list_keys(request):
    return list(ApiKey.objects.filter(user=request.user))


@router.post("/", response={201: KeyCreated})
def create_key(request, payload: KeyIn):
    _check_scopes(payload.scopes)
    if ApiKey.objects.filter(user=request.user).count() >= MAX_KEYS:
        raise HttpError(400, f"You can have at most {MAX_KEYS} keys; revoke one first")
    key, token = ApiKey.issue(request.user, payload.name.strip(), payload.scopes, payload.expires_on)
    notify(request.user, f"New API key \"{key.name}\" created",
           f"Access: {', '.join(key.scopes)}. If this wasn't you, revoke it in Settings → API keys.",
           source="Security", url="/settings#set-api", priority=Priority.HIGH)
    return 201, {"key": key, "token": token}


@router.patch("/{uuid:key_id}", response=KeyOut)
def update_key(request, key_id: uuid.UUID, payload: KeyPatch):
    key = get_object_or_404(ApiKey, id=key_id, user=request.user)
    if payload.scopes is not None:
        _check_scopes(payload.scopes)
        key.scopes = sorted(set(payload.scopes))
    if payload.name is not None:
        key.name = payload.name.strip()
    key.save()
    return key


@router.delete("/{uuid:key_id}", response={204: None}, summary="Revoke")
def revoke_key(request, key_id: uuid.UUID):
    get_object_or_404(ApiKey, id=key_id, user=request.user).delete()
    return 204, None
