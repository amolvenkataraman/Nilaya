"""/api/v2/notifications/: inbox (bell menu) and delivery channels for the signed-in user."""

import datetime
import uuid
from typing import Optional

from django.shortcuts import get_object_or_404
from django.utils import timezone
from ninja import Field, Router, Schema
from ninja.errors import HttpError

from .channels import FIELDS, DeliveryError, public_config, send, validate_config
from .models import Notification, NotificationChannel, Priority
from .service import notify

router = Router(tags=["notifications"])


class NotificationOut(Schema):
    id: uuid.UUID
    title: str
    body: str
    source: str
    priority: int
    url: str
    read: bool
    created_on: datetime.datetime

    @staticmethod
    def resolve_body(obj):
        return obj.description or ""


class InboxOut(Schema):
    items: list[NotificationOut]
    unread: int


class CountOut(Schema):
    unread: int


class SendIn(Schema):
    title: str = Field(..., min_length=1, max_length=128)
    body: str = ""
    url: str = ""
    priority: int = Priority.NORMAL


class ChannelOut(Schema):
    id: uuid.UUID
    kind: str
    name: str
    config: dict
    enabled: bool
    min_priority: int
    last_sent_at: Optional[datetime.datetime]
    last_error: str

    @staticmethod
    def resolve_config(obj):
        return public_config(obj)


class ChannelIn(Schema):
    kind: str
    name: str = Field(..., min_length=1, max_length=64)
    config: dict = {}
    enabled: bool = True
    min_priority: int = Priority.LOW


class ChannelPatch(Schema):
    name: Optional[str] = Field(None, min_length=1, max_length=64)
    config: Optional[dict] = None
    enabled: Optional[bool] = None
    min_priority: Optional[int] = None


class TestOut(Schema):
    ok: bool
    error: str = ""


# ---------------------------------------------------------------- inbox

@router.get("/", response=InboxOut, summary="Recent notifications")
def inbox(request, unread_only: bool = False, limit: int = 20, before: Optional[datetime.datetime] = None):
    qs = Notification.objects.filter(user=request.user).exclude(expires_on__lt=timezone.now())
    unread = qs.filter(read=False).count()
    if unread_only:
        qs = qs.filter(read=False)
    if before:
        qs = qs.filter(created_on__lt=before)
    return {"items": list(qs[: max(1, min(limit, 100))]), "unread": unread}


@router.get("/unread-count", response=CountOut)
def unread_count(request):
    return {"unread": Notification.objects.filter(user=request.user, read=False)
            .exclude(expires_on__lt=timezone.now()).count()}


@router.post("/read-all", response=CountOut, summary="Mark every notification read")
def read_all(request):
    Notification.objects.filter(user=request.user, read=False).update(read=True, read_at=timezone.now())
    return {"unread": 0}


@router.post("/{uuid:notification_id}/read", response=NotificationOut)
def mark_read(request, notification_id: uuid.UUID, read: bool = True):
    n = get_object_or_404(Notification, id=notification_id, user=request.user)
    n.read, n.read_at = read, (timezone.now() if read else None)
    n.save(update_fields=["read", "read_at"])
    return n


@router.delete("/{uuid:notification_id}", response={204: None})
def delete(request, notification_id: uuid.UUID):
    get_object_or_404(Notification, id=notification_id, user=request.user).delete()
    return 204, None


@router.post("/send", response=NotificationOut, summary="Send a notification to yourself (scripts, testing)")
def send_to_self(request, payload: SendIn):
    return notify(request.user, payload.title, payload.body, source="API", url=payload.url,
                  priority=max(Priority.LOW, min(Priority.URGENT, payload.priority)))


# ---------------------------------------------------------------- channels

@router.get("/channel-types", auth=None, summary="Channel types and their settings fields")
def channel_types(request):
    return [{"kind": kind.value, "label": kind.label,
             "fields": [{"key": k, "label": label, "required": req, "secret": secret}
                        for k, label, req, secret in FIELDS[kind]]}
            for kind in NotificationChannel.Kind]


@router.get("/channels", response=list[ChannelOut])
def list_channels(request):
    return list(NotificationChannel.objects.filter(user=request.user))


@router.post("/channels", response={201: ChannelOut})
def create_channel(request, payload: ChannelIn):
    try:
        config = validate_config(payload.kind, payload.config)
    except ValueError as exc:
        raise HttpError(400, str(exc)) from exc
    channel = NotificationChannel.objects.create(
        user=request.user, kind=payload.kind, name=payload.name, config=config,
        enabled=payload.enabled, min_priority=payload.min_priority)
    return 201, channel


@router.patch("/channels/{uuid:channel_id}", response=ChannelOut)
def update_channel(request, channel_id: uuid.UUID, payload: ChannelPatch):
    channel = get_object_or_404(NotificationChannel, id=channel_id, user=request.user)
    if payload.config is not None:
        merged = {**channel.config, **{k: v for k, v in payload.config.items() if v not in (None, "")}}
        try:
            channel.config = validate_config(channel.kind, merged)  # blank secret fields keep the old value
        except ValueError as exc:
            raise HttpError(400, str(exc)) from exc
    for field in ("name", "enabled", "min_priority"):
        if getattr(payload, field) is not None:
            setattr(channel, field, getattr(payload, field))
    channel.save()
    return channel


@router.delete("/channels/{uuid:channel_id}", response={204: None})
def delete_channel(request, channel_id: uuid.UUID):
    get_object_or_404(NotificationChannel, id=channel_id, user=request.user).delete()
    return 204, None


@router.post("/channels/{uuid:channel_id}/test", response=TestOut, summary="Send a test message to one channel now")
def test_channel(request, channel_id: uuid.UUID):
    channel = get_object_or_404(NotificationChannel, id=channel_id, user=request.user)
    sample = Notification(user=request.user, title="Test notification", source="AVNet Superapp",
                          description="If you can read this, this channel works.", url="/notifications/",
                          priority=Priority.NORMAL, created_on=timezone.now())
    try:
        send(channel, sample)
    except DeliveryError as exc:
        channel.last_error = str(exc)
        channel.save(update_fields=["last_error"])
        return {"ok": False, "error": str(exc)}
    channel.last_error, channel.last_sent_at = "", timezone.now()
    channel.save(update_fields=["last_error", "last_sent_at"])
    return {"ok": True}


# ---------------------------------------------------------------- automatic reminders

class ReminderSettingsOut(Schema):
    event_minutes: int
    deadline_minutes: int
    todo_minutes: int
    daily_agenda: bool
    agenda_time: datetime.time
    deadlines_to_todos: bool


class ReminderSettingsPatch(Schema):
    event_minutes: Optional[int] = Field(None, ge=0, le=10080)
    deadline_minutes: Optional[int] = Field(None, ge=0, le=10080)
    todo_minutes: Optional[int] = Field(None, ge=0, le=10080)
    daily_agenda: Optional[bool] = None
    agenda_time: Optional[datetime.time] = None
    deadlines_to_todos: Optional[bool] = None


@router.get("/reminders", response=ReminderSettingsOut, summary="Automatic reminder settings (0 minutes = off)")
def get_reminder_settings(request):
    from .models import ReminderSettings
    return ReminderSettings.for_user(request.user)


@router.patch("/reminders", response=ReminderSettingsOut)
def update_reminder_settings(request, payload: ReminderSettingsPatch):
    from .models import ReminderSettings
    st = ReminderSettings.for_user(request.user)
    for key, value in payload.dict(exclude_unset=True).items():
        if value is not None:
            setattr(st, key, value)
    st.save()
    return st
