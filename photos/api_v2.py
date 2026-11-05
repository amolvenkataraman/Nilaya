"""/api/v2/photos/: read-only library access (timeline, albums, on this day, summary).

Media URLs are the signed nginx paths the old UI uses (/private/... thumbnails,
/photo_cdn/... originals); hashes are precomputed per photo at ingest.
"""

import datetime
import uuid
from typing import Optional

from django.db.models import Count, Max, Min, Q, Sum
from django.shortcuts import get_object_or_404
from django.utils import timezone
from ninja import Router, Schema

from .models import Album_Subscriber, Photo, ShareAlbum

router = Router(tags=["photos"])


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


class PageOut(Schema):
    items: list[PhotoOut]
    next_before: Optional[datetime.datetime]


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
    count: int
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


def library(user):
    """Every photo the user can see through the library albums they subscribe to."""
    return Photo.objects.filter(album__users_subscribed__user=user, file_not_available=False)


def _page(qs, before, limit):
    qs = qs.exclude(date_taken__isnull=True)
    if before:
        qs = qs.filter(date_taken__lt=before)
    items = list(qs.select_related("album").order_by("-date_taken")[: max(1, min(limit, 300)) + 1])
    more = len(items) > limit
    items = items[:limit]
    return {"items": items, "next_before": items[-1].date_taken if more and items else None}


@router.get("/timeline", response=PageOut, summary="Newest first; pass next_before to get the next page")
def timeline(request, before: Optional[datetime.datetime] = None, limit: int = 120,
             video: Optional[bool] = None, country: str = "", city: str = ""):
    qs = library(request.user)
    if video is not None:
        qs = qs.filter(video=video)
    if country:
        qs = qs.filter(location_country=country)
    if city:
        qs = qs.filter(location_city=city)
    return _page(qs, before, limit)


@router.get("/on-this-day", response=list[YearGroup], summary="Photos from today's date in earlier years")
def on_this_day(request, per_year: int = 12):
    today = timezone.localdate()
    qs = (library(request.user).select_related("album")
          .filter(date_taken__month=today.month, date_taken__day=today.day, date_taken__year__lt=today.year)
          .order_by("-date_taken"))
    groups = {}
    for p in qs[:600]:
        bucket = groups.setdefault(p.date_taken.year, [])
        if len(bucket) < per_year:
            bucket.append(p)
    return [{"year": y, "items": items} for y, items in sorted(groups.items(), reverse=True)]


@router.get("/summary", response=SummaryOut)
def summary(request):
    qs = library(request.user)
    agg = qs.aggregate(photos=Count("id", filter=Q(video=False)), videos=Count("id", filter=Q(video=True)),
                       size=Sum("size_total"), first=Min("date_taken"), last=Max("date_taken"))
    top = lambda field: [{"name": r[field], "count": r["n"]} for r in
                         qs.exclude(**{f"{field}__isnull": True}).values(field).annotate(n=Count("id")).order_by("-n")[:8]]
    per_year = [{"year": r["date_taken__year"], "count": r["n"]} for r in
                qs.exclude(date_taken__isnull=True).values("date_taken__year").annotate(n=Count("id")).order_by("date_taken__year")]
    return {"photos": agg["photos"], "videos": agg["videos"], "size_kb": agg["size"] or 0,
            "first": agg["first"], "last": agg["last"], "countries": top("location_country"),
            "cities": top("location_city"), "per_year": per_year}


@router.get("/libraries", response=list[LibraryOut], summary="Library albums (camera folders) you can see")
def libraries(request):
    subs = (Album_Subscriber.objects.filter(user=request.user).select_related("album")
            .annotate(count=Count("album__photo_album")).order_by("album__name"))
    return [{"id": s.album_id, "name": s.album.name, "role": ("owner", "editor", "viewer")[s.subscribe_type],
             "visible": s.visible, "count": s.count} for s in subs]


@router.get("/albums", response=list[ShareAlbumOut], summary="Shared albums you own or were added to")
def albums(request):
    qs = (ShareAlbum.objects.filter(Q(owner=request.user) | Q(sharealbum_users_subscribed__user=request.user))
          .distinct().select_related("cover_photo__album").annotate(count=Count("sharealbum_photos", distinct=True))
          .order_by("name"))
    out = []
    for a in qs:
        cover = a.cover_photo or (Photo.objects.filter(photo_in_sharealbum__sharealbum=a)
                                  .select_related("album").order_by("-date_taken").first())
        out.append({"id": a.id, "name": a.name, "description": a.description, "public": a.public,
                    "mine": a.owner_id == request.user.id, "count": a.count, "cover": cover})
    return out


@router.get("/albums/{uuid:album_id}/photos", response=PageOut)
def album_photos(request, album_id: uuid.UUID, before: Optional[datetime.datetime] = None, limit: int = 120):
    album = get_object_or_404(ShareAlbum.objects.filter(
        Q(owner=request.user) | Q(sharealbum_users_subscribed__user=request.user) | Q(public=True)).distinct(),
        id=album_id)
    return _page(Photo.objects.filter(photo_in_sharealbum__sharealbum=album), before, limit)


@router.get("/{uuid:photo_id}", response=PhotoOut)
def photo(request, photo_id: uuid.UUID):
    return get_object_or_404(library(request.user).select_related("album"), id=photo_id)
