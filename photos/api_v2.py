"""/api/v2/photos/: read-only library access (timeline, albums, on this day, summary).

Media URLs are the signed nginx paths the old UI uses (/private/... thumbnails,
/photo_cdn/... originals); hashes are precomputed per photo at ingest.
"""

import datetime
import uuid
from typing import Literal, Optional

from django.db.models import Count, F, Max, Min, Q, Sum
from django.shortcuts import get_object_or_404
from django.utils import timezone
from ninja import Field, Query, Router, Schema
from ninja.errors import HttpError

from . import api_albums, api_insights, browse
from . import cache as photo_cache
from . import hidden as hidden_mode
from .api_albums import albums
from .api_common import (
    IdsIn,
    LibraryOut,
    PageOut,
    PhotoOut,
    ShareAlbumOut,
    SummaryOut,
    YearGroup,
    _editable_library,
    _page,
    _random_pick,
    daily,
    library,
)
from .models import BROKEN_GPS, Album_Subscriber, Photo, ShareAlbum

router = Router(tags=["photos"])


def _blur_range(qs, min_blur, max_blur):
    """Sharpness (blur score, normalised to 12 MP so big and small photos compare), photos only."""
    from django.db.models import Case, FloatField, Value, When
    from django.db.models.fields.json import KeyTextTransform
    from django.db.models.functions import Cast
    mp = Case(When(megapixels__gt=0, then=F("megapixels")), default=Value(12.0), output_field=FloatField())
    qs = qs.filter(video=False, ai_index_info__blur_score__isnull=False).annotate(
        sharp=Cast(KeyTextTransform("blur_score", "ai_index_info"), output_field=FloatField()) * (12.0 / mp))
    if min_blur is not None:
        qs = qs.filter(sharp__gte=min_blur)
    if max_blur is not None:
        qs = qs.filter(sharp__lte=max_blur)
    return qs


@router.get("/timeline", response=PageOut,
            summary="Newest first (order=oldest: oldest first); pass next_before and next_before_id back to get the next page")
def timeline(request, before: Optional[datetime.datetime] = None, limit: int = 120,
             video: Optional[bool] = None, country: str = "", city: str = "", before_id: Optional[uuid.UUID] = None,
             camera: str = "", objects: str = "", after: Optional[datetime.datetime] = None,
             q: str = "", camera_make: str = "", north: Optional[float] = None, south: Optional[float] = None,
             east: Optional[float] = None, west: Optional[float] = None, min_blur: Optional[float] = None,
             max_blur: Optional[float] = None, order: Literal["newest", "oldest"] = "newest"):
    qs = library(request.user, request, listing=True)
    if after:
        qs = qs.filter(date_taken__gte=after)  # with before: a time range (e.g. an event's photos)
    if q.strip():  # free text: a place, a camera or a detected object
        text = q.strip()[:128]
        match = (Q(location_city__icontains=text) | Q(location_country__icontains=text)
                 | Q(camera_make__icontains=text) | Q(camera_model__icontains=text))
        ids = browse.object_ids([text])
        if ids:
            match |= Q(id__in=browse.with_objects(qs, ids).values("id"))
        qs = qs.filter(match)
    if camera_make:
        qs = qs.filter(camera_make__icontains=camera_make)
    if None not in (north, south, east, west):  # a map area ("Photos in this area")
        qs = qs.filter(latitude__gte=south, latitude__lte=north)
        qs = qs.filter(longitude__gte=west, longitude__lte=east) if west <= east else \
            qs.filter(Q(longitude__gte=west) | Q(longitude__lte=east))
    if min_blur is not None or max_blur is not None:
        qs = _blur_range(qs, min_blur, max_blur)
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
    if order == "oldest":  # `before` is then the cursor of the previous page (it pages forward in time)
        return _page(qs, before, limit, before_id, oldest=True)
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
    return photo_cache.cached(request, "summary:v2", lambda: _summary(request))  # v2: places leave out plane photos


def _summary(request):
    qs = library(request.user, request, listing=True)
    agg = qs.aggregate(photos=Count("id", filter=Q(video=False)), videos=Count("id", filter=Q(video=True)),
                       size=Sum("size_total"), first=Min("date_taken"), last=Max("date_taken"))
    from .models import PLANE_ALTITUDE_M
    ground = qs.exclude(altitude__gte=PLANE_ALTITUDE_M)  # a flyover city isn't a place visited (NULL altitude = ground)
    top = lambda field: [{"name": r[field], "count": r["n"]} for r in
                         ground.exclude(**{f"{field}__isnull": True}).values(field).annotate(n=Count("id")).order_by("-n")[:8]]
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
           include_planes: bool = False, until_year: bool = False, max_alt: Optional[float] = None,
           library_id: Optional[int] = None):
    """year with until_year: every year up to and including it. max_alt: only photos taken at or below
    that altitude (metres; unknown altitude counts). library_id: one library only."""
    from .models import PhotoLocationCache
    if hidden_mode.show_hidden(request) or max_alt is not None:  # the view has no altitudes or hidden photos
        qs = library(request.user, request).exclude(latitude__isnull=True).exclude(longitude__isnull=True).exclude(BROKEN_GPS)
        qs = qs.filter(latitude__gte=south, latitude__lte=north)
        qs = qs.filter(longitude__gte=west, longitude__lte=east) if west <= east else \
            qs.filter(Q(longitude__gte=west) | Q(longitude__lte=east))
        if year:
            qs = qs.filter(date_taken__year__lte=year) if until_year else qs.filter(date_taken__year=year)
        if library_id:
            qs = qs.filter(album_id=library_id)
        if max_alt is not None:
            qs = qs.filter(Q(altitude__lte=max_alt) | Q(altitude__isnull=True))
        if not include_planes:
            from .models import PLANE_ALTITUDE_M
            qs = qs.exclude(altitude__gte=PLANE_ALTITUDE_M)
        rows = qs.values("latitude", "longitude").annotate(n=Count("id"))[:20000]
        return [{"lat": round(r["latitude"], 5), "lng": round(r["longitude"], 5), "count": r["n"]} for r in rows]
    albums = Album_Subscriber.objects.filter(user=request.user).values("album_id")
    qs = PhotoLocationCache.objects.filter(album_id__in=albums, lat__gte=south, lat__lte=north)
    qs = qs.filter(lng__gte=west, lng__lte=east) if west <= east else qs.filter(Q(lng__gte=west) | Q(lng__lte=east))
    if year:
        qs = qs.filter(dt_year__lte=year) if until_year else qs.filter(dt_year=year)
    if library_id:
        qs = qs.filter(album_id=library_id)
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
    import os

    from django.db import transaction

    from apikeys.models import ApiKey
    if isinstance(getattr(request, "auth", None), ApiKey):
        raise HttpError(403, "Deleting files needs a signed-in browser session")
    p = Photo.objects.select_related("album").filter(id=photo_id).first()
    if p is None:
        raise HttpError(404, "Not found")
    if not request.user.is_superuser and not _editable_library(request.user).filter(id=p.id).exists():
        raise HttpError(403, "Only owners and editors of this library can delete originals.")
    freed_kb = 0
    # Only a separate original: never the optimized file the app shows (same path, or resolving to it).
    if p.orig_filepath and p.orig_filepath != p.filepath:
        if p.album and p.album.location:
            orig = os.path.normpath(os.path.join(p.album.location, p.orig_filepath))
            shown = os.path.normpath(os.path.join(p.album.location, p.filepath))
            if orig != shown and os.path.exists(orig):
                try:
                    freed_kb = os.path.getsize(orig) // 1024
                    os.remove(orig)
                except OSError:
                    pass
        # The original's own row (if it was ever imported as an item); never p itself.
        Photo.objects.filter(album=p.album, filepath=p.orig_filepath).exclude(id=p.id).delete()
        p.orig_filepath = None
        p.update_file_sizes()
        p.save()
        transaction.on_commit(photo_cache.schedule_matview_refresh)  # sizes per day
    return {"size": p.size, "size_total": p.size_total, "freed_kb": freed_kb}


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
    """Both null clears the location."""
    lat: Optional[float] = Field(..., ge=-90, le=90)
    lng: Optional[float] = Field(..., ge=-180, le=180)


@router.post("/{uuid:photo_id}/location", response=PhotoOut, summary="Set a photo's location (library owners/editors)")
def set_location(request, photo_id: uuid.UUID, payload: LocationIn):
    from django.db import transaction
    if (payload.lat is None) != (payload.lng is None):
        raise HttpError(422, "Give both lat and lng, or both null to clear")
    p = get_object_or_404(_editable_library(request.user).select_related("album").distinct(), id=photo_id)
    p.set_location(payload.lat, payload.lng)
    # Only the heat-map view has locations (photos_photo_daily doesn't change). Queued and coalesced:
    # saving one location after another refreshes the view once per burst, not once per save.
    transaction.on_commit(lambda: photo_cache.schedule_matview_refresh(("photos_photo_location_cache",)))
    return p


def _viewable(request, photo_id):
    """One photo from your libraries, or from a shared album you own or were added to."""
    p = library(request.user, request).select_related("album").filter(id=photo_id).first()
    if p is None:
        albums = ShareAlbum.objects.filter(Q(owner=request.user) | Q(sharealbum_users_subscribed__user=request.user))
        p = hidden_mode.visible(Photo.objects.filter(id=photo_id, photo_in_sharealbum__sharealbum__in=albums), request) \
            .select_related("album").first()
    if p is None:
        raise HttpError(404, "Not found")
    return p


@router.get("/{uuid:photo_id}/details", response=PhotoDetailOut, summary="Everything known about one photo (info panel)")
def photo_details(request, photo_id: uuid.UUID):
    return _viewable(request, photo_id)


@router.get("/{uuid:photo_id}", response=PhotoOut, summary="One photo (from your libraries or a shared album you're in)")
def photo(request, photo_id: uuid.UUID):
    return _viewable(request, photo_id)


# ---------------------------------------------------------------- hidden photos


class HideIn(Schema):
    ids: list[uuid.UUID] = Field(..., max_length=1000)
    hidden: bool = True


class HiddenModeIn(Schema):
    show: bool




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


# Shared albums and browse/stats/storage/superlatives live in their own modules.
router.add_router("", api_albums.router)
router.add_router("", api_insights.router)
