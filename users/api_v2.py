"""/api/v2/me: the signed-in user."""

import datetime
import uuid
from typing import Optional

import pytz
from ninja import Field, Router, Schema
from ninja.errors import HttpError

router = Router(tags=["me"])


class GroupOut(Schema):
    id: int
    name: str


class MeOut(Schema):
    id: uuid.UUID
    username: str
    first_name: str
    last_name: str
    email: str
    description: str
    birthday: Optional[datetime.date]
    timezone: str
    profile_picture: str
    is_staff: bool
    groups: list[GroupOut]

    @staticmethod
    def resolve_profile_picture(obj):
        return obj.profile_picture.url

    @staticmethod
    def resolve_groups(obj):
        return list(obj.user_groups.all())


class MePatch(Schema):
    first_name: Optional[str] = Field(None, max_length=150)
    last_name: Optional[str] = Field(None, max_length=150)
    description: Optional[str] = Field(None, max_length=512)
    birthday: Optional[datetime.date] = None
    timezone: Optional[str] = None


@router.get("", response=MeOut, summary="The signed-in user")
def me(request):
    return request.user


@router.patch("", response=MeOut)
def update_me(request, payload: MePatch):
    user = request.user
    data = {k: v for k, v in payload.dict(exclude_unset=True).items() if v is not None or k == "birthday"}
    if "timezone" in data and data["timezone"] not in pytz.all_timezones_set:
        raise HttpError(400, "Unknown time zone")
    for key, value in data.items():
        setattr(user, key, value)
    user.save(update_fields=list(data) or None)
    return user


# ---------------------------------------------------------------- profile picture, password

class PictureIn(Schema):
    data_url: str = Field(..., max_length=15_000_000)  # "data:image/...;base64,<payload>" (cropped in the browser)


@router.post("/picture", response=MeOut, summary="Set your profile picture from a data URL (re-encoded as JPEG)")
def set_picture(request, payload: PictureIn):
    import base64
    import io
    import os

    from django.conf import settings
    from PIL import Image

    from Comptech.utils import random_characters

    try:
        img = Image.open(io.BytesIO(base64.b64decode(payload.data_url.split(",", 1)[1], validate=True)))
        img.load()
    except Exception as exc:
        raise HttpError(400, "That isn't a readable image") from exc
    img = img.convert("RGB")
    img.thumbnail((1024, 1024))  # plenty for an avatar; keeps files small
    os.makedirs(os.path.join(settings.MEDIA_ROOT, "users", "profile_pictures"), exist_ok=True)
    name = f"users/profile_pictures/{random_characters()}.jpg"
    img.save(os.path.join(settings.MEDIA_ROOT, name), "JPEG", quality=90)
    request.user.profile_picture = name
    request.user.save(update_fields=["profile_picture"])
    return request.user


class PasswordIn(Schema):
    old: str
    new: str = Field(..., min_length=8, max_length=128)


@router.post("/password", response={204: None}, summary="Change your password (browser session only)")
def change_password(request, payload: PasswordIn):
    from django.contrib.auth import password_validation, update_session_auth_hash
    from django.core.exceptions import ValidationError

    from apikeys.models import ApiKey
    if isinstance(getattr(request, "auth", None), ApiKey):
        raise HttpError(403, "Change your password from a signed-in browser")
    user = request.user
    if not user.check_password(payload.old):
        raise HttpError(400, "Your current password is wrong")
    try:
        password_validation.validate_password(payload.new, user)
    except ValidationError as exc:
        raise HttpError(400, " ".join(exc.messages)) from exc
    user.set_password(payload.new)
    user.save(update_fields=["password"])
    update_session_auth_hash(request, user)  # stay signed in
    return 204, None


# ---------------------------------------------------------------- other people

people = Router(tags=["users"])


class PersonOut(Schema):
    id: uuid.UUID
    username: str
    name: str
    description: str
    profile_picture: str
    groups: list[GroupOut]

    @staticmethod
    def resolve_name(obj):
        return obj.get_full_name() or obj.username

    @staticmethod
    def resolve_profile_picture(obj):
        return obj.profile_picture.url

    @staticmethod
    def resolve_groups(obj):
        return list(obj.user_groups.filter(public=True))


@people.get("/{username}", response=PersonOut, summary="Someone's public profile (name, picture, description, public groups)")
def person(request, username: str):
    from django.shortcuts import get_object_or_404

    from .models import ComptechUser
    return get_object_or_404(ComptechUser, username=username, is_active=True)
