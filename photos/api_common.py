"""Shared parts of /api/v2/photos/: the photo, page, library and album schemas, the library a user can see
(hidden photos left out), the per-day rollup and keyset paging. Media URLs are the signed nginx paths
(/private/... thumbnails, /photo_cdn/... originals); hashes are precomputed per photo at ingest."""

import datetime
import uuid
from typing import Optional

from django.db.models import Q
from ninja import Field, Schema

from . import hidden as hidden_mode
from .models import Album_Subscriber, Photo


class PhotoOut(Schema):
    id: uuid.UUID
    thumb_url: str
    url: str
    width: Optional[int]
    height: Optional[int]
    aspect: float
    date_taken: Optional[datetime.datetime]
    video: bool
    length: Optional[int]
    city: Optional[str]
    country: Optional[str]
    lat: Optional[float]
    lon: Optional[float]
    camera: Optional[str]
    album_id: int
    size_kb: Optional[int] = None        # optimized file (what the app serves)
    size_total_kb: Optional[int] = None  # including originals/RAW
    megapixels: Optional[float] = None
    has_raw: bool = False
    has_orig: bool = False
    blur: Optional[float] = None

    @staticmethod
    def resolve_thumb_url(obj):
        return f"/private/{obj.thumbnail_hash}/photo_cache/thumbnail/{obj.id}.webp"

    @staticmethod
    def resolve_url(obj):
        return f"/photo_cdn/{obj.photo_hash}/{obj.get_path()}"

    @staticmethod
    def resolve_aspect(obj):
        return round((obj.thumbnail_width or 200) / (obj.thumbnail_height or 200), 4)

    @staticmethod
    def resolve_city(obj):
        return obj.location_city

    @staticmethod
    def resolve_country(obj):
        return obj.location_country

    @staticmethod
    def resolve_lat(obj):
        return obj.latitude

    @staticmethod
    def resolve_lon(obj):
        return obj.longitude

    @staticmethod
    def resolve_camera(obj):
        return " ".join(filter(None, (obj.camera_make, obj.camera_model))) or None

    @staticmethod
    def resolve_size_kb(obj):
        return obj.size

    @staticmethod
    def resolve_size_total_kb(obj):
        return obj.size_total

    @staticmethod
    def resolve_has_raw(obj):
        return bool(obj.raw_filepath)

    @staticmethod
    def resolve_has_orig(obj):
        return bool(obj.orig_filepath)

    @staticmethod
    def resolve_blur(obj):
        info = obj.ai_index_info or {}
        return round(info["blur_score"], 1) if isinstance(info, dict) and info.get("blur_score") is not None else None


class PageOut(Schema):
    items: list[PhotoOut]
    next_before: Optional[datetime.datetime]
    next_before_id: Optional[uuid.UUID] = None  # pass both back: photos can share a timestamp


class LibraryOut(Schema):
    id: int
    name: str
    role: str
    visible: bool
    count: int


class ShareAlbumOut(Schema):
    id: uuid.UUID
    name: str
    description: Optional[str]
    public: bool
    mine: bool
    owner: str = ""  # username
    count: int
    videos: int = 0
    size_kb: int = 0
    first: Optional[datetime.datetime] = None  # oldest and newest photo
    last: Optional[datetime.datetime] = None
    cover: Optional[PhotoOut]


class YearGroup(Schema):
    year: int
    items: list[PhotoOut]


class SummaryOut(Schema):
    photos: int
    videos: int
    size_kb: int
    first: Optional[datetime.datetime]
    last: Optional[datetime.datetime]
    countries: list[dict]
    cities: list[dict]
    per_year: list[dict]


def library(user, request=None, listing=False):
    """Every photo the user can see through the library albums they subscribe to.
    Hidden photos are left out unless the owner has show-hidden mode on (pass the request).
    listing=True also leaves out libraries switched off in Sources (like the classic timeline);
    direct access to a photo ignores that switch."""
    subs = Album_Subscriber.objects.filter(user=user)
    if listing:
        subs = subs.filter(visible=True)
    # file_not_available is a stale flag from old scripts; those files exist (owner, 2026-11-05), so they
    # count and show like on the classic pages.
    qs = Photo.objects.filter(album_id__in=subs.values("album_id"))
    return hidden_mode.visible(qs, request)


def daily(request):
    """The per-day rollup view for this user's libraries, or None when it can't be used
    (show-hidden mode needs the live table; the view's days are in settings.TIME_ZONE)."""
    from django.conf import settings

    from .models import PhotoDaily
    if hidden_mode.show_hidden(request) or request.user.timezone not in ("", settings.TIME_ZONE, "Canada/Eastern", "America/Toronto"):
        return None
    albums = Album_Subscriber.objects.filter(user=request.user, visible=True).values("album_id")  # Sources switch, like listing=True
    return PhotoDaily.objects.filter(album_id__in=albums)


def _random_pick(qs):
    """A random row without ORDER BY random() (which sorts the whole library): photo ids are random
    UUIDs, so take the first one at or after a random UUID, wrapping around."""
    pivot = uuid.uuid4()
    return qs.filter(id__gte=pivot).order_by("id").first() or qs.filter(id__lt=pivot).order_by("-id").first()


def _page(qs, before, limit, before_id=None, oldest=False):
    """Newest first (or oldest first), keyset-paged on (date_taken, id) so photos with the same timestamp
    aren't skipped. The cursor (next_before, next_before_id) is the last item returned either way."""
    qs = qs.exclude(date_taken__isnull=True)
    anchor = qs.filter(id=before_id).values_list("date_taken", flat=True).first() if before_id else None
    past = "gt" if oldest else "lt"
    if anchor:  # the exact stored timestamp (JSON rounds to milliseconds, so don't trust the echoed one)
        qs = qs.filter(Q(**{f"date_taken__{past}": anchor}) | Q(date_taken=anchor, **{f"id__{past}": before_id}))
    elif before:
        qs = qs.filter(**{f"date_taken__{past}": before})
    limit = max(1, min(limit, 300))
    order = ("date_taken", "id") if oldest else ("-date_taken", "-id")
    items = list(qs.select_related("album").order_by(*order)[: limit + 1])
    more = len(items) > limit
    items = items[:limit]
    last = items[-1] if more and items else None
    return {"items": items, "next_before": last.date_taken if last else None, "next_before_id": last.id if last else None}


def _editable_library(user):
    """Photos in libraries the user owns or edits (viewers can't change or delete)."""
    return Photo.objects.filter(album__users_subscribed__user=user, album__users_subscribed__subscribe_type__in=[0, 1])


class IdsIn(Schema):
    ids: list[uuid.UUID] = Field(..., min_length=1, max_length=1000)
