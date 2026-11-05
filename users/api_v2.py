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
    data = payload.dict(exclude_unset=True)
    if "timezone" in data and data["timezone"] not in pytz.all_timezones_set:
        raise HttpError(400, "Unknown time zone")
    for key, value in data.items():
        setattr(user, key, value)
    user.save(update_fields=list(data) or None)
    return user
