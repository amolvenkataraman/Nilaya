"""/api/v2/photos/: read-only library access (timeline, albums, on this day, summary).

Media URLs are the signed nginx paths the old UI uses (/private/... thumbnails,
/photo_cdn/... originals); hashes are precomputed per photo at ingest.
"""

import datetime
import os
import uuid
from typing import Literal, Optional

from django.db.models import Count, Max, Min, OuterRef, Q, Subquery, Sum
from django.db.models.functions import Coalesce
from django.shortcuts import get_object_or_404
from django.utils import timezone
from ninja import Query, Router, Schema

from ninja import Field
from ninja.errors import HttpError

from . import browse
from . import cache as photo_cache
from . import hidden as hidden_mode
from .models import BROKEN_GPS, Album_Subscriber, Photo, ShareAlbum

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
    count: int
    size_kb: int = 0
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
    qs = Photo.objects.filter(album_id__in=subs.values("album_id"), file_not_available=False)
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


def _page(qs, before, limit, before_id=None):
    """Newest first, keyset-paged on (date_taken, id) so photos with the same timestamp aren't skipped."""
    qs = qs.exclude(date_taken__isnull=True)
    anchor = qs.filter(id=before_id).values_list("date_taken", flat=True).first() if before_id else None
    if anchor:  # the exact stored timestamp (JSON rounds to milliseconds, so don't trust the echoed one)
        qs = qs.filter(Q(date_taken__lt=anchor) | Q(date_taken=anchor, id__lt=before_id))
    elif before:
        qs = qs.filter(date_taken__lt=before)
    limit = max(1, min(limit, 300))
    items = list(qs.select_related("album").order_by("-date_taken", "-id")[: limit + 1])
    more = len(items) > limit
    items = items[:limit]
    last = items[-1] if more and items else None
    return {"items": items, "next_before": last.date_taken if last else None, "next_before_id": last.id if last else None}


@router.get("/timeline", response=PageOut, summary="Newest first; pass next_before to get the next page")
def timeline(request, before: Optional[datetime.datetime] = None, limit: int = 120,
             video: Optional[bool] = None, country: str = "", city: str = "", before_id: Optional[uuid.UUID] = None,
             camera: str = "", objects: str = "", after: Optional[datetime.datetime] = None):
    qs = library(request.user, request, listing=True)
    if after:
        qs = qs.filter(date_taken__gte=after)  # with before: a time range (e.g. an event's photos)
    if camera:
        qs = qs.filter(camera_model=camera)
    if objects:
        qs = browse.with_objects(qs, browse.object_ids(objects.split(",")))
    if video is not None:
        qs = qs.filter(video=video)
    if country:
        qs = qs.filter(location_country=country)
    if city:
        qs = qs.filter(location_city=city)
    return _page(qs, before, limit, before_id)


@router.get("/on-this-day", response=list[YearGroup], summary="Photos from today's date in earlier years")
def on_this_day(request, per_year: int = 12):
    import pytz
    tz = pytz.timezone(request.user.timezone) if request.user.timezone in pytz.all_timezones_set else None
    today = timezone.localdate(timezone=tz)  # the user's date, not the server's
    per_year = max(1, min(per_year, 50))
    lib = library(request.user, request, listing=True).select_related("album")
    rollup = daily(request)
    if rollup is not None:
        # Month/day filters can't use an index (every call scanned the library): find the matching
        # days in the small per-day view, then read each day's photos by date range (indexed).
        from zoneinfo import ZoneInfo
        from django.conf import settings
        server_tz = ZoneInfo(settings.TIME_ZONE)
        days = sorted(set(rollup.filter(day__month=today.month, day__day=today.day, day__year__lt=today.year)
                          .values_list("day", flat=True)), reverse=True)
        at = lambda d: datetime.datetime.combine(d, datetime.time(), tzinfo=server_tz)
        out = []
        for d in days:
            items = list(lib.filter(date_taken__gte=at(d), date_taken__lt=at(d + datetime.timedelta(days=1)))
                         .order_by("-date_taken")[:per_year])
            if items:
                out.append({"year": d.year, "items": items})
        return out
    qs = (lib.filter(date_taken__month=today.month, date_taken__day=today.day, date_taken__year__lt=today.year)
          .order_by("-date_taken"))
    groups = {}
    for p in qs[:600]:
        bucket = groups.setdefault(p.date_taken.year, [])
        if len(bucket) < per_year:
            bucket.append(p)
    return [{"year": y, "items": items} for y, items in sorted(groups.items(), reverse=True)]


@router.get("/summary", response=SummaryOut)
def summary(request):
    return photo_cache.cached(request, "summary", lambda: _summary(request))


def _summary(request):
    qs = library(request.user, request, listing=True)
    agg = qs.aggregate(photos=Count("id", filter=Q(video=False)), videos=Count("id", filter=Q(video=True)),
                       size=Sum("size_total"), first=Min("date_taken"), last=Max("date_taken"))
    top = lambda field: [{"name": r[field], "count": r["n"]} for r in
                         qs.exclude(**{f"{field}__isnull": True}).values(field).annotate(n=Count("id")).order_by("-n")[:8]]
    per_year = [{"year": r["date_taken__year"], "count": r["n"]} for r in
                qs.exclude(date_taken__isnull=True).values("date_taken__year").annotate(n=Count("id")).order_by("date_taken__year")]
    return {"photos": agg["photos"], "videos": agg["videos"], "size_kb": agg["size"] or 0,
            "first": agg["first"], "last": agg["last"], "countries": top("location_country"),
            "cities": top("location_city"), "per_year": per_year}


@router.get("/counts", response=dict[str, int], summary="Photos per local day in [start, end] (dates, max 400 days)")
def counts(request, start: datetime.date, end: datetime.date):
    import pytz
    from django.db.models.functions import TruncDate
    if end < start or (end - start).days > 400:
        raise HttpError(400, "Pick a range of up to 400 days")
    tz = pytz.timezone(request.user.timezone) if request.user.timezone in pytz.all_timezones_set else timezone.get_current_timezone()
    lo = tz.localize(datetime.datetime.combine(start, datetime.time())) if hasattr(tz, "localize") else datetime.datetime.combine(start, datetime.time(), tzinfo=tz)
    hi = lo + datetime.timedelta(days=(end - start).days + 1)
    rollup = daily(request)
    if rollup is not None:  # fast path: the materialized per-day view
        rows = rollup.filter(day__gte=start, day__lte=end).values("day").annotate(n=Sum("photos") + Sum("videos"))
        return {r["day"].isoformat(): r["n"] for r in rows if r["n"]}
    rows = (library(request.user, request, listing=True).filter(date_taken__gte=lo, date_taken__lt=hi)
            .annotate(day=TruncDate("date_taken", tzinfo=tz)).values("day").annotate(n=Count("id")))
    return {r["day"].isoformat(): r["n"] for r in rows}


@router.get("/points", summary="Photo locations in a map box, pre-aggregated (for heatmaps); [{lat, lng, count}]")
def points(request, south: float, west: float, north: float, east: float, year: Optional[int] = None,
           include_planes: bool = False):
    from .models import PhotoLocationCache
    if hidden_mode.show_hidden(request):  # the view leaves hidden photos out: use the live table
        qs = library(request.user, request).exclude(latitude__isnull=True).exclude(longitude__isnull=True).exclude(BROKEN_GPS)
        qs = qs.filter(latitude__gte=south, latitude__lte=north)
        qs = qs.filter(longitude__gte=west, longitude__lte=east) if west <= east else \
            qs.filter(Q(longitude__gte=west) | Q(longitude__lte=east))
        if year:
            qs = qs.filter(date_taken__year=year)
        if not include_planes:
            from .models import PLANE_ALTITUDE_M
            qs = qs.exclude(altitude__gte=PLANE_ALTITUDE_M)
        rows = qs.values("latitude", "longitude").annotate(n=Count("id"))[:20000]
        return [{"lat": round(r["latitude"], 5), "lng": round(r["longitude"], 5), "count": r["n"]} for r in rows]
    albums = Album_Subscriber.objects.filter(user=request.user).values("album_id")
    qs = PhotoLocationCache.objects.filter(album_id__in=albums, lat__gte=south, lat__lte=north)
    qs = qs.filter(lng__gte=west, lng__lte=east) if west <= east else qs.filter(Q(lng__gte=west) | Q(lng__lte=east))
    if year:
        qs = qs.filter(dt_year=year)
    if not include_planes:
        qs = qs.filter(Q(on_plane=False) | Q(on_plane__isnull=True))  # NULL altitude = unknown, not "on a plane"
    rows = qs.values("lat", "lng").annotate(n=Sum("cnt"))[:20000]
    return [{"lat": float(r["lat"]), "lng": float(r["lng"]), "count": int(r["n"])} for r in rows]


@router.get("/days", summary="Per local day in [start, end]: photos, videos, size_kb (day headers)")
def days(request, start: datetime.date, end: datetime.date):
    if end < start or (end - start).days > 400:
        raise HttpError(400, "Pick a range of up to 400 days")
    rollup = daily(request)
    if rollup is not None:
        rows = rollup.filter(day__gte=start, day__lte=end).values("day").annotate(
            photos=Sum("photos"), videos=Sum("videos"), size_kb=Sum("size_total_kb"))
        return {r["day"].isoformat(): {"photos": r["photos"], "videos": r["videos"], "size_kb": r["size_kb"]} for r in rows}
    import pytz
    from django.db.models.functions import TruncDate
    tz = pytz.timezone(request.user.timezone) if request.user.timezone in pytz.all_timezones_set else timezone.get_current_timezone()
    lo = tz.localize(datetime.datetime.combine(start, datetime.time())) if hasattr(tz, "localize") else datetime.datetime.combine(start, datetime.time(), tzinfo=tz)
    hi = lo + datetime.timedelta(days=(end - start).days + 1)
    rows = (library(request.user, request, listing=True).filter(date_taken__gte=lo, date_taken__lt=hi)
            .annotate(day=TruncDate("date_taken", tzinfo=tz)).values("day")
            .annotate(photos=Count("id", filter=Q(video=False)), videos=Count("id", filter=Q(video=True)), size_kb=Sum("size_total")))
    return {r["day"].isoformat(): {"photos": r["photos"], "videos": r["videos"], "size_kb": r["size_kb"] or 0} for r in rows}


@router.get("/libraries", response=list[LibraryOut], summary="Library albums (camera folders) you can see")
def libraries(request):
    subs = list(Album_Subscriber.objects.filter(user=request.user).select_related("album").order_by("album__name"))
    ids = sorted(s.album_id for s in subs)
    # Photo counts scan each library: cached (invalidated on photo changes); roles and switches are live.
    # Hidden photos only count in show-hidden mode (which is never cached).
    counts = photo_cache.cached(request, "library-counts", lambda: dict(
        hidden_mode.visible(Photo.objects.filter(album_id__in=ids), request)
        .values_list("album_id").annotate(n=Count("id")).order_by()), ids)
    return [{"id": s.album_id, "name": s.album.name, "role": ("owner", "editor", "viewer")[s.subscribe_type],
             "visible": s.visible, "count": counts.get(s.album_id, 0)} for s in subs]


class SidebarOut(Schema):
    summary: SummaryOut
    albums: list[ShareAlbumOut]
    libraries: list[LibraryOut]
    hidden_mode: dict


@router.get("/sidebar", response=SidebarOut, summary="Summary, shared albums, libraries and show-hidden mode in one request")
def sidebar(request):
    return {"summary": summary(request), "albums": albums(request), "libraries": libraries(request),
            "hidden_mode": get_hidden_mode(request)}


def _album_totals(request):
    """count and size_kb of a shared album (OuterRef "pk") as subqueries: joining photos and members in one
    query multiplied the size by the number of members. Hidden photos count only in show-hidden mode."""
    from .models import ShareAlbum_Photo
    rows = hidden_mode.visible(ShareAlbum_Photo.objects.filter(sharealbum=OuterRef("pk")), request, prefix="photo__") \
        .order_by().values("sharealbum")
    return {"count": Coalesce(Subquery(rows.annotate(n=Count("id")).values("n")), 0),
            "size_kb": Coalesce(Subquery(rows.annotate(s=Sum("photo__size_total")).values("s")), 0)}


@router.get("/albums", response=list[ShareAlbumOut], summary="Shared albums you own or were added to")
def albums(request):
    qs = (ShareAlbum.objects.filter(Q(owner=request.user) | Q(sharealbum_users_subscribed__user=request.user))
          .distinct().select_related("cover_photo__album").annotate(**_album_totals(request))
          .order_by("name"))
    out = []
    for a in qs:
        cover = a.cover_photo if a.cover_photo and not a.cover_photo.hidden else (
            Photo.objects.filter(photo_in_sharealbum__sharealbum=a, hidden=False)
            .select_related("album").order_by("-date_taken").first())
        out.append({"id": a.id, "name": a.name, "description": a.description, "public": a.public,
                    "mine": a.owner_id == request.user.id, "count": a.count, "size_kb": a.size_kb or 0, "cover": cover})
    return out


class AlbumIn(Schema):
    name: str = Field(..., min_length=1, max_length=64)
    description: str = ""
    public: bool = False


class AlbumPatch(Schema):
    name: Optional[str] = Field(None, min_length=1, max_length=64)
    description: Optional[str] = None
    public: Optional[bool] = None
    cover_photo_id: Optional[uuid.UUID] = None


class MemberIn(Schema):
    username: str
    role: Literal["editor", "viewer"] = "viewer"


class MemberPatch(Schema):
    role: Literal["editor", "viewer"]


ROLE_TO_TYPE = {"editor": 1, "viewer": 2}
TYPE_TO_ROLE = {0: "owner", 1: "editor", 2: "viewer"}


def _album_out(a, request):
    photos = Photo.objects.filter(photo_in_sharealbum__sharealbum=a)
    cover = a.cover_photo if a.cover_photo_id and not a.cover_photo.hidden else \
        photos.filter(hidden=False).select_related("album").order_by("-date_taken").first()
    agg = hidden_mode.visible(photos, request).aggregate(n=Count("id"), size=Sum("size_total"))  # same as /albums
    return {"id": a.id, "name": a.name, "description": a.description, "public": a.public,
            "mine": a.owner_id == request.user.id, "count": agg["n"], "size_kb": agg["size"] or 0, "cover": cover}


def _own_share_album(user, album_id):
    return get_object_or_404(ShareAlbum, id=album_id, owner=user)


@router.post("/albums", response={201: ShareAlbumOut}, summary="Create a shared album")
def create_album(request, payload: AlbumIn):
    from .models import ShareAlbum_Subscriber
    import bleach
    a = ShareAlbum.objects.create(owner=request.user, name=bleach.clean(payload.name),
                                  description=bleach.clean(payload.description), public=payload.public)
    ShareAlbum_Subscriber.objects.create(album=a, user=request.user, subscribe_type=0)
    return 201, _album_out(a, request)


@router.patch("/albums/{uuid:album_id}", response=ShareAlbumOut, summary="Rename, describe, make public, set the cover (owner)")
def update_album(request, album_id: uuid.UUID, payload: AlbumPatch):
    from .models import ShareAlbum_Photo
    import bleach
    a = _own_share_album(request.user, album_id)
    data = payload.dict(exclude_unset=True)
    if data.get("name") is not None:
        a.name = bleach.clean(data["name"])
    if "description" in data:
        a.description = bleach.clean(data["description"] or "")
    if data.get("public") is not None:
        a.public = data["public"]
    if data.get("cover_photo_id"):
        if not ShareAlbum_Photo.objects.filter(sharealbum=a, photo_id=data["cover_photo_id"]).exists():
            raise HttpError(400, "That photo isn't in this album")
        a.cover_photo_id = data["cover_photo_id"]
    a.save()
    return _album_out(a, request)


@router.delete("/albums/{uuid:album_id}", response={204: None}, summary="Delete a shared album (owner); the photos stay")
def delete_album(request, album_id: uuid.UUID):
    _own_share_album(request.user, album_id).delete()
    return 204, None


@router.get("/albums/{uuid:album_id}/members", summary="People an album is shared with (owner)")
def album_members(request, album_id: uuid.UUID):
    from .models import ShareAlbum_Subscriber
    a = _own_share_album(request.user, album_id)
    return [{"id": m.id, "username": m.user.username, "name": m.user.get_full_name() or m.user.username,
             "role": TYPE_TO_ROLE.get(m.subscribe_type, "viewer")}
            for m in ShareAlbum_Subscriber.objects.filter(album=a).exclude(subscribe_type=0).select_related("user")]


@router.post("/albums/{uuid:album_id}/members", response={201: dict}, summary="Share an album with someone (owner)")
def add_album_member(request, album_id: uuid.UUID, payload: MemberIn):
    from .models import ShareAlbum_Subscriber
    from users.models import ComptechUser
    from notifications.service import notify
    a = _own_share_album(request.user, album_id)
    target = get_object_or_404(ComptechUser, username=payload.username)
    if target.id == request.user.id or ShareAlbum_Subscriber.objects.filter(album=a, user=target).exists():
        raise HttpError(400, "They already have access")
    m = ShareAlbum_Subscriber.objects.create(album=a, user=target, subscribe_type=ROLE_TO_TYPE[payload.role])
    notify(target, f"{request.user.get_full_name() or request.user.username} shared \"{a.name}\" with you",
           f"You can {'edit' if payload.role == 'editor' else 'view'} this album.", source="Photos",
           url=f"/photos/?album={a.id}")
    return 201, {"id": m.id, "username": target.username, "role": payload.role}


@router.patch("/albums/{uuid:album_id}/members/{int:member_id}", summary="Change someone's role (owner)")
def update_album_member(request, album_id: uuid.UUID, member_id: int, payload: MemberPatch):
    from .models import ShareAlbum_Subscriber
    a = _own_share_album(request.user, album_id)
    m = get_object_or_404(ShareAlbum_Subscriber.objects.exclude(subscribe_type=0), id=member_id, album=a)
    m.subscribe_type = ROLE_TO_TYPE[payload.role]
    m.save(update_fields=["subscribe_type"])
    return {"id": m.id, "role": payload.role}


@router.delete("/albums/{uuid:album_id}/members/{int:member_id}", response={204: None}, summary="Stop sharing with someone (owner)")
def remove_album_member(request, album_id: uuid.UUID, member_id: int):
    from .models import ShareAlbum_Subscriber
    a = _own_share_album(request.user, album_id)
    get_object_or_404(ShareAlbum_Subscriber.objects.exclude(subscribe_type=0), id=member_id, album=a).delete()
    return 204, None


class LibraryPatch(Schema):
    visible: bool


@router.patch("/libraries/{int:album_id}", summary="Show or hide a library in the timeline and stats (Sources)")
def set_library_visible(request, album_id: int, payload: LibraryPatch):
    sub = get_object_or_404(Album_Subscriber, user=request.user, album_id=album_id)
    sub.visible = payload.visible
    sub.save(update_fields=["visible"])
    return {"id": album_id, "visible": sub.visible}


@router.post("/libraries/{int:album_id}/only", summary="Show only this library")
def only_library(request, album_id: int):
    sub = get_object_or_404(Album_Subscriber, user=request.user, album_id=album_id)
    Album_Subscriber.objects.filter(user=request.user).exclude(id=sub.id).update(visible=False)
    sub.visible = True
    sub.save(update_fields=["visible"])
    return {"id": album_id, "visible": True}


@router.post("/ingest", response={202: dict}, summary="Import new files from your libraries' Ingest folders (owners/editors)")
def ingest(request):
    from .tasks import ingest_all_photos
    if not Album_Subscriber.objects.filter(user=request.user, subscribe_type__in=[0, 1]).exists():
        raise HttpError(403, "You don't own or edit any library")
    ingest_all_photos.delay(user_id=request.user.id)
    return 202, {"status": "started"}


@router.post("/{uuid:photo_id}/delete-original", summary="Delete the original/RAW kept next to a photo (owners/editors, browser only)")
def delete_original(request, photo_id: uuid.UUID):
    from apikeys.models import ApiKey
    from .views import delete_photo_original
    if isinstance(getattr(request, "auth", None), ApiKey):
        raise HttpError(403, "Deleting files needs a signed-in browser session")
    return delete_photo_original(request, str(photo_id))  # classic logic: safety checks + owner/editor only


@router.get("/albums/{uuid:album_id}/photos", response=PageOut)
def album_photos(request, album_id: uuid.UUID, before: Optional[datetime.datetime] = None, limit: int = 120,
                 before_id: Optional[uuid.UUID] = None):
    album = get_object_or_404(ShareAlbum.objects.filter(
        Q(owner=request.user) | Q(sharealbum_users_subscribed__user=request.user) | Q(public=True)).distinct(),
        id=album_id)
    return _page(hidden_mode.visible(Photo.objects.filter(photo_in_sharealbum__sharealbum=album), request), before, limit, before_id)


class ObjectOut(Schema):
    id: int
    name: str


class PhotoDetailOut(PhotoOut):
    filename: str
    library: str
    mimetype: Optional[str]
    size_kb: Optional[int]
    size_total_kb: Optional[int]
    megapixels: Optional[float]
    camera_make: Optional[str]
    camera_model: Optional[str]
    exposure: Optional[str]
    fnumber: Optional[str]
    isospeed: Optional[str]
    shutterspeed: Optional[str]
    aperture: Optional[str]
    flash: Optional[str]
    focallength: Optional[str]
    altitude: Optional[float]
    framerate: Optional[int]
    bitrate: Optional[int]
    main_color: Optional[str]
    has_raw: bool
    has_orig: bool
    blur: Optional[float]
    objects: list[ObjectOut]
    hidden: bool
    mine: bool

    @staticmethod
    def resolve_filename(o): return o.filepath.rsplit("/", 1)[-1]
    @staticmethod
    def resolve_library(o): return o.album.name
    @staticmethod
    def resolve_size_kb(o): return o.size
    @staticmethod
    def resolve_size_total_kb(o): return o.size_total
    @staticmethod
    def resolve_megapixels(o): return o.megapixels if o.megapixels is not None else o.calculate_megapixels()
    @staticmethod
    def resolve_has_raw(o): return bool(o.raw_filepath)
    @staticmethod
    def resolve_has_orig(o): return bool(o.orig_filepath)
    @staticmethod
    def resolve_blur(o):
        info = o.ai_index_info or {}
        return round(info["blur_score"], 1) if info.get("blur_score") is not None else None
    @staticmethod
    def resolve_objects(o):
        ids = sorted(set((o.ai_index_info or {}).get("objects") or []))
        return [{"id": i, "name": browse.object_label(i)} for i in ids]
    @staticmethod
    def resolve_mine(o, context): return hidden_mode.can_control(o, context["request"].user)  # may hide/unhide


@router.get("/browse/{category}", summary="Cities, countries, cameras or objects with counts (for search pages)")
def browse_category(request, category: str):
    if category not in ("cities", "countries", "cameras", "objects"):
        raise HttpError(404, "Unknown category")
    return photo_cache.cached(request, "browse", lambda: browse.browse_items(library(request.user, request, listing=True), category), category)


def _local_now(request):
    import pytz
    tz = pytz.timezone(request.user.timezone) if request.user.timezone in pytz.all_timezones_set else timezone.get_current_timezone()
    return tz, timezone.localtime(timezone.now(), tz)


@router.get("/stats", summary="Library statistics (counts, activity, when you take photos, equipment, places)")
def stats(request):
    return photo_cache.cached(request, "stats", lambda: _stats(request))


def _stats(request):
    from django.db.models import Avg
    from django.db.models.functions import ExtractHour, ExtractIsoWeekDay, TruncMonth
    qs = library(request.user, request, listing=True)
    tz, now = _local_now(request)
    agg = qs.aggregate(total=Count("id"), videos=Count("id", filter=Q(video=True)), mp=Avg("megapixels", filter=Q(video=False)),
                       first=Min("date_taken"), last=Max("date_taken"))
    periods = {}
    for key, days in (("week", 7), ("month", 30), ("year", 365)):
        cur = qs.filter(date_taken__gte=now - datetime.timedelta(days=days)).count()
        prev = qs.filter(date_taken__gte=now - datetime.timedelta(days=2 * days), date_taken__lt=now - datetime.timedelta(days=days)).count()
        periods[key] = {"count": cur, "previous": prev}
    ytd_start = now.replace(month=1, day=1, hour=0, minute=0, second=0, microsecond=0)
    year_ago = now.replace(year=now.year - 1, day=28) if (now.month, now.day) == (2, 29) else now.replace(year=now.year - 1)
    periods["ytd"] = {"count": qs.filter(date_taken__gte=ytd_start).count(),
                      "previous": qs.filter(date_taken__gte=ytd_start.replace(year=now.year - 1),
                                            date_taken__lt=year_ago).count()}
    dated = qs.exclude(date_taken__isnull=True)
    hours = dict(dated.annotate(h=ExtractHour("date_taken", tzinfo=tz)).values_list("h").annotate(n=Count("id")))
    weekdays = dict(dated.annotate(d=ExtractIsoWeekDay("date_taken", tzinfo=tz)).values_list("d").annotate(n=Count("id")))
    rollup = daily(request)
    if rollup is not None:
        months = [{"month": r["m"].strftime("%Y-%m"), "photos": r["photos"], "videos": r["videos"]} for r in
                  rollup.annotate(m=TruncMonth("day")).values("m").annotate(photos=Sum("photos"), videos=Sum("videos")).order_by("m")]
    else:
        months = [{"month": r["m"].strftime("%Y-%m"), "photos": r["photos"], "videos": r["videos"]} for r in
                  dated.annotate(m=TruncMonth("date_taken", tzinfo=tz)).values("m")
                  .annotate(photos=Count("id", filter=Q(video=False)), videos=Count("id", filter=Q(video=True))).order_by("m")]
    cams = (qs.exclude(camera_model__isnull=True).exclude(camera_model="").values("camera_make", "camera_model")
            .annotate(n=Count("id")).order_by("-n")[:10])
    top = lambda field: [{"name": r[field], "count": r["n"]} for r in qs.exclude(**{f"{field}__isnull": True})
                         .exclude(**{field: ""}).values(field).annotate(n=Count("id")).order_by("-n")[:10]]
    return {
        "totals": {"total": agg["total"], "photos": agg["total"] - agg["videos"], "videos": agg["videos"],
                   "avg_megapixels": round(agg["mp"], 1) if agg["mp"] else None,
                   "first": agg["first"], "last": agg["last"]},
        "periods": periods,
        "by_hour": [hours.get(h, 0) for h in range(24)],
        "by_weekday": [weekdays.get(d, 0) for d in range(1, 8)],  # Monday first
        "by_month": months,
        "cameras": [{"make": c["camera_make"], "model": c["camera_model"], "count": c["n"]} for c in cams],
        "countries": top("location_country"), "cities": top("location_city"),
    }


@router.get("/storage", summary="Storage used: optimized vs total (originals/RAW), by type, year, library and camera")
def storage(request):
    return photo_cache.cached(request, "storage", lambda: _storage(request))


def _storage(request):
    from django.db.models.functions import ExtractYear
    qs = library(request.user, request, listing=True)
    part = lambda q: q.aggregate(count=Count("id"), optimized_kb=Sum("size"), total_kb=Sum("size_total"), length_s=Sum("length"))
    def block(q):
        a = part(q)
        a = {k: (v or 0) for k, v in a.items()}
        a["overhead_kb"] = a["total_kb"] - a["optimized_kb"]
        return a
    group = lambda field, n=12: [{"name": r[field] if r[field] is not None else "Unknown", "count": r["count"],
                                  "total_kb": r["total"] or 0, "optimized_kb": r["opt"] or 0}
                                 for r in qs.values(field).annotate(count=Count("id"), total=Sum("size_total"), opt=Sum("size"))
                                 .order_by("-total")[:n]]
    rollup = daily(request)
    if rollup is not None:
        years = [{"year": r["y"], "count": r["count"] or 0, "total_kb": r["total"] or 0} for r in
                 rollup.annotate(y=ExtractYear("day")).values("y")
                 .annotate(count=Sum("photos") + Sum("videos"), total=Sum("size_total_kb")).order_by("y")]
    else:
        years = [{"year": r["y"], "count": r["count"], "total_kb": r["total"] or 0} for r in
                 qs.exclude(date_taken__isnull=True).annotate(y=ExtractYear("date_taken")).values("y")
                 .annotate(count=Count("id"), total=Sum("size_total")).order_by("y")]
    largest = list(qs.select_related("album").order_by("-size_total")[:12])
    return {"all": block(qs), "photo": block(qs.filter(video=False)), "video": block(qs.filter(video=True)),
            "by_year": years, "by_library": group("album__name"), "by_camera": group("camera_model"),
            "by_type": group("mimetype"),
            "largest": [{"id": str(p.id), "thumb_url": PhotoOut.resolve_thumb_url(p), "size_kb": p.size_total or 0,
                         "video": p.video, "date_taken": p.date_taken} for p in largest]}


# ---------------------------------------------------------------- Geoguessr and location entry

@router.get("/game/round", response=PhotoOut, summary="Geoguessr: a random geotagged photo from your libraries")
def game_round(request):
    p = (library(request.user, request, listing=True).exclude(latitude__isnull=True).exclude(longitude__isnull=True)
         .exclude(BROKEN_GPS).filter(video=False).select_related("album"))
    p = _random_pick(p)
    if p is None:
        raise HttpError(404, "No geotagged photos yet")
    return p


@router.get("/locate/next", response=PhotoOut, summary="Location entry: the next photo without a location (optionally a year/month)")
def locate_next(request, year: Optional[int] = None, month: Optional[int] = None, zero: bool = False,
                exclude: list[uuid.UUID] = Query([], max_length=200, description="Photos skipped this session")):
    qs = library(request.user, request, listing=True).select_related("album")
    if exclude:
        qs = qs.exclude(id__in=exclude)
    if year:
        qs = qs.filter(date_taken__year=year)
    if month:
        qs = qs.filter(date_taken__month=month)
    qs = qs.filter(BROKEN_GPS).order_by("-date_taken") if zero else \
        qs.filter(Q(latitude__isnull=True) | Q(longitude__isnull=True))
    p = qs.first() if zero else _random_pick(qs)
    if p is None:
        raise HttpError(404, "Every photo here has a location")
    return p


class LocationIn(Schema):
    """Both null clears the location (the classic tool's Clear)."""
    lat: Optional[float] = Field(..., ge=-90, le=90)
    lng: Optional[float] = Field(..., ge=-180, le=180)


@router.post("/{uuid:photo_id}/location", response=PhotoOut, summary="Set a photo's location (library owners/editors)")
def set_location(request, photo_id: uuid.UUID, payload: LocationIn):
    from django.conf import settings
    from django.db import transaction
    if (payload.lat is None) != (payload.lng is None):
        raise HttpError(422, "Give both lat and lng, or both null to clear")
    p = get_object_or_404(_editable_library(request.user).select_related("album").distinct(), id=photo_id)
    p.set_location(payload.lat, payload.lng)
    try:  # same audit trail as the classic tool
        with open(os.path.join(settings.BASE_DIR, "photo_gg_ent_log.txt"), "a") as f:
            f.write(f"{p.id} --> ({payload.lat}, {payload.lng}) [{request.user.username}]\n")
    except OSError:
        pass
    # Only the heat-map view has locations (photos_photo_daily doesn't change). Queued and coalesced:
    # saving one location after another refreshes the view once per burst, not once per save.
    transaction.on_commit(lambda: photo_cache.schedule_matview_refresh(("photos_photo_location_cache",)))
    return p


@router.get("/{uuid:photo_id}/details", response=PhotoDetailOut, summary="Everything known about one photo (info panel)")
def photo_details(request, photo_id: uuid.UUID):
    return get_object_or_404(library(request.user, request).select_related("album"), id=photo_id)


@router.get("/{uuid:photo_id}", response=PhotoOut)
def photo(request, photo_id: uuid.UUID):
    return get_object_or_404(library(request.user, request).select_related("album"), id=photo_id)


# ---------------------------------------------------------------- hidden photos

class HideIn(Schema):
    ids: list[uuid.UUID] = Field(..., max_length=1000)
    hidden: bool = True


class HiddenModeIn(Schema):
    show: bool


class IdsIn(Schema):
    ids: list[uuid.UUID] = Field(..., min_length=1, max_length=1000)


def _editable_library(user):
    """Photos in libraries the user owns or edits (viewers can't change or delete)."""
    return Photo.objects.filter(album__users_subscribed__user=user, album__users_subscribed__subscribe_type__in=[0, 1])


@router.post("/delete", summary="Delete photos (removes the files; library owners/editors only)")
def delete_photos(request, payload: IdsIn):
    from .models import delete_photo
    if isinstance(getattr(request, "auth", None), __import__("apikeys.models", fromlist=["ApiKey"]).ApiKey):
        raise HttpError(403, "Deleting photos needs a signed-in browser session")
    photos = list(_editable_library(request.user).filter(id__in=payload.ids).select_related("album").distinct())
    for p in photos:
        delete_photo(p)
    if photos:
        from django.db import transaction
        transaction.on_commit(photo_cache.schedule_matview_refresh)  # per-day counts and the heat map
    return {"deleted": len(photos)}


def _writable_share_album(user, album_id):
    from .models import ShareAlbum_Subscriber
    return get_object_or_404(ShareAlbum.objects.filter(
        Q(owner=user) | Q(id__in=ShareAlbum_Subscriber.objects.filter(user=user, subscribe_type__in=[0, 1]).values("album_id"))),
        id=album_id)


@router.post("/albums/{uuid:album_id}/photos", summary="Add photos you can see to a shared album you own or edit")
def add_to_album(request, album_id: uuid.UUID, payload: IdsIn):
    from .models import ShareAlbum_Photo
    album = _writable_share_album(request.user, album_id)
    visible = set(library(request.user, request).filter(id__in=payload.ids).values_list("id", flat=True))
    existing = set(ShareAlbum_Photo.objects.filter(sharealbum=album, photo_id__in=visible).values_list("photo_id", flat=True))
    new = [pid for pid in payload.ids if pid in visible and pid not in existing]
    ShareAlbum_Photo.objects.bulk_create([ShareAlbum_Photo(sharealbum=album, photo_id=pid) for pid in new])
    return {"added": [str(pid) for pid in new]}


@router.delete("/albums/{uuid:album_id}/photos", summary="Remove photos from a shared album you own or edit")
def remove_from_album(request, album_id: uuid.UUID, payload: IdsIn):
    from .models import ShareAlbum_Photo
    album = _writable_share_album(request.user, album_id)
    removed, _ = ShareAlbum_Photo.objects.filter(sharealbum=album, photo_id__in=payload.ids).delete()
    return {"removed": removed}


@router.post("/hide", summary="Hide or unhide photos you imported or that are in a library you own")
def hide(request, payload: HideIn):
    changed = Photo.objects.filter(hidden_mode.controls(request.user), id__in=payload.ids) \
        .exclude(hidden=payload.hidden).update(hidden=payload.hidden)
    if changed:
        from django.db import transaction
        transaction.on_commit(photo_cache.schedule_matview_refresh)  # both views leave hidden photos out
    return {"changed": changed}


@router.get("/hidden-mode", summary="Whether show-hidden mode is on for this browser session")
def get_hidden_mode(request):
    return {"show": hidden_mode.show_hidden(request), "minutes": int(hidden_mode.WINDOW.total_seconds() // 60)}


@router.post("/hidden-mode", summary="Turn show-hidden mode on or off (browser session only; off after 30 minutes)")
def set_hidden_mode(request, payload: HiddenModeIn):
    from apikeys.models import ApiKey
    if isinstance(getattr(request, "auth", None), ApiKey):
        raise HttpError(403, "Show-hidden mode can only be turned on from a signed-in browser")
    return {"show": hidden_mode.set_show_hidden(request, payload.show)}
