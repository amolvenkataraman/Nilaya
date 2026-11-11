"""/api/v2/devices/: signing in from the mobile apps.

A phone signs in once with a username and password and gets two things back: a device token, and an
API key for the app that asked. The phone never stores the password. Every other app on that phone
trades the device token for its own key (/app-key), limited to that app's data.

The two phone endpoints take no cookie and no API key (auth=None): the password or the device token
in the body is the credential, so there is nothing for CSRF to protect. Listing and revoking devices
is for a signed-in browser only, like API keys.
"""

import datetime
import uuid
from typing import Optional

from django.shortcuts import get_object_or_404
from ninja import Field, Router, Schema
from ninja.errors import HttpError
from ninja.security import django_auth

from notifications.service import Priority, notify
from users.auth_api import check_credentials

from .models import APPS, Device

router = Router(tags=["devices"])
MAX_DEVICES = 25


class DeviceOut(Schema):
    id: uuid.UUID
    name: str
    created_on: datetime.datetime
    last_used_on: Optional[datetime.datetime]
    apps: list[str]

    @staticmethod
    def resolve_apps(obj):
        return sorted({scope.split(":")[0] for key in obj.keys.all() for scope in key.scopes} - {"me"})


class SignInIn(Schema):
    username: str = Field(..., max_length=150)
    password: str = Field(..., max_length=4096)
    device_name: str = Field(..., min_length=1, max_length=40)  # e.g. "Pixel 8"
    app: str


class AppKeyIn(Schema):
    device_token: str = Field(..., max_length=256)
    app: str


class AppKeyOut(Schema):
    app: str
    token: str  # shown once


class SignedIn(AppKeyOut):
    device: DeviceOut
    device_token: str  # shown once


def _check_app(app):
    if app not in Device.PHONE_APPS:
        raise HttpError(400, f"Unknown app: {app}")


@router.post("/sign-in", auth=None, response={201: SignedIn},
             summary="Phone: sign in with a username and password; returns a device token and a key for one app")
def sign_in(request, payload: SignInIn):
    _check_app(payload.app)
    user = check_credentials(request, payload.username, payload.password)
    if Device.objects.filter(user=user).count() >= MAX_DEVICES:
        raise HttpError(400, f"You can have at most {MAX_DEVICES} devices; remove one in Settings first")
    device, device_token = Device.issue(user, payload.device_name.strip())
    _, token = device.app_key(payload.app)
    notify(user, f"New device \"{device.name}\" signed in",
           f"It signed in to {APPS[payload.app]}. If this wasn't you, remove it in Settings and change your password.",
           source="Security", url="/settings#set-api", priority=Priority.HIGH)
    return 201, {"device": device, "device_token": device_token, "app": payload.app, "token": token}


@router.post("/app-key", auth=None, response={201: AppKeyOut},
             summary="Phone: trade the device token for one app's key (replaces that app's earlier key on this device)")
def app_key(request, payload: AppKeyIn):
    _check_app(payload.app)
    device = Device.from_token(payload.device_token)
    if device is None:
        raise HttpError(401, "This device is signed out. Sign in again.")
    _, token = device.app_key(payload.app)
    return 201, {"app": payload.app, "token": token}


@router.get("/", auth=django_auth, response=list[DeviceOut], summary="Your signed-in devices and the apps on each")
def list_devices(request):
    return list(Device.objects.filter(user=request.user).prefetch_related("keys"))


@router.delete("/{uuid:device_id}", auth=django_auth, response={204: None},
               summary="Sign a device out: revokes the device token and every app key on it")
def remove_device(request, device_id: uuid.UUID):
    get_object_or_404(Device, id=device_id, user=request.user).delete()
    return 204, None
