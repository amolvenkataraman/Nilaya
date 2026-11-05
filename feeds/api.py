"""/api/v2/feeds/: private ICS feed URLs (browser session only)."""

import datetime
import uuid
from typing import Literal, Optional

from django.conf import settings
from django.shortcuts import get_object_or_404
from ninja import Field, Router, Schema
from ninja.security import django_auth

from .models import Feed

router = Router(tags=["feeds"], auth=django_auth)


class FeedOut(Schema):
    id: uuid.UUID
    kind: str
    name: str
    created_on: datetime.datetime
    last_fetched_on: Optional[datetime.datetime]
    fetches: int


class FeedIn(Schema):
    kind: Literal["calendar", "tasks"]
    name: str = Field(..., min_length=1, max_length=64)


@router.get("/", response=list[FeedOut])
def list_feeds(request):
    return list(Feed.objects.filter(user=request.user))


@router.post("/", response={201: dict}, summary="Create a feed; the URL is shown once")
def create_feed(request, payload: FeedIn):
    feed, token = Feed.issue(request.user, payload.kind, payload.name.strip())
    base = getattr(settings, "SITE_URL", "") or request.build_absolute_uri("/").rstrip("/")
    return 201, {"feed": FeedOut.from_orm(feed).dict(), "url": f"{base}/feeds/{token}.ics"}


@router.delete("/{uuid:feed_id}", response={204: None}, summary="Revoke")
def revoke_feed(request, feed_id: uuid.UUID):
    get_object_or_404(Feed, id=feed_id, user=request.user).delete()
    return 204, None
