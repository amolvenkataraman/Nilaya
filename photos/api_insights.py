"""/api/v2/photos/: browse (places, cameras, objects), stats, storage and superlatives.

Superlatives: rankings across the libraries you see.

Item rankings return photos with the numbers each ranking is about; day rankings return local days.
An original or RAW file that was also imported as its own item is counted once (its main photo).
Cached like stats and storage (photos/cache.py), so switching rankings back and forth is free.
"""

import datetime
from typing import Literal, Optional

from django.db.models import Count, Exists, F, Max, Min, OuterRef, Q, Sum
from django.utils import timezone
from ninja import Router, Schema
from ninja.errors import HttpError

from . import browse
from . import cache as photo_cache
from .api_common import PhotoOut, daily, library
from .models import Album_Subscriber

router = Router()  # tags come from photos.api_v2.router

ITEM = ("biggest-files", "longest-videos", "biggest-orig-videos", "biggest-resolution", "biggest-photos",
        "biggest-overhead", "biggest-raw")
DAY = ("day-most-photos", "day-most-videos", "day-most-storage", "day-longest-video-time")
Category = Literal["biggest-files", "longest-videos", "biggest-orig-videos", "biggest-resolution", "biggest-photos",
                   "biggest-overhead", "biggest-raw", "day-most-photos", "day-most-videos", "day-most-storage",
                   "day-longest-video-time"]


class RankedItem(Schema):
    id: str
    thumb_url: str
    filename: str
    library: str
    owner: str
    video: bool
    date_taken: Optional[datetime.datetime]
    size_kb: int  # the optimized file
    size_total_kb: int  # with the original/RAW kept next to it
    length_s: Optional[int]
    megapixels: Optional[float]
    width: Optional[int]
    height: Optional[int]
    has_raw: bool
    has_orig: bool


class RankedDay(Schema):
    date: datetime.date
    photos: int
    videos: int
    size_kb: int
    length_s: int


class ItemSummary(Schema):
    count: int
    photos: int
    videos: int
    size_kb: int
    size_total_kb: int
    length_s: int
    max_megapixels: Optional[float]


class SuperlativesOut(Schema):
    category: str
    kind: Literal["item", "day"]
    items: list[RankedItem] = []
    days: list[RankedDay] = []
    summary: Optional[ItemSummary] = None


def _pool(request):
    qs = library(request.user, request, listing=True)
    # A file that is some photo's original or RAW, imported again as its own item: count it once.
    twin = qs.filter(Q(orig_filepath=OuterRef("filepath")) | Q(raw_filepath=OuterRef("filepath")),
                     album_id=OuterRef("album_id"))
    return qs.exclude(Exists(twin))


def _items(qs, category, limit):
    big = (F("size_total").desc(nulls_last=True), F("size").desc(nulls_last=True))
    qs = {
        "biggest-files": lambda: qs.order_by(*big),
        "longest-videos": lambda: qs.filter(video=True, length__isnull=False).order_by(F("length").desc()),
        "biggest-orig-videos": lambda: qs.filter(video=True).exclude(orig_filepath__isnull=True).exclude(orig_filepath="").order_by(*big),
        "biggest-resolution": lambda: qs.filter(megapixels__isnull=False).order_by(F("megapixels").desc()),
        "biggest-photos": lambda: qs.filter(video=False).order_by(*big),
        "biggest-overhead": lambda: qs.annotate(gap=F("size_total") - F("size")).filter(gap__gt=0).order_by(F("gap").desc()),
        "biggest-raw": lambda: qs.exclude(raw_filepath__isnull=True).exclude(raw_filepath="").order_by(*big),
    }[category]()
    rows = list(qs.select_related("album", "owner")[:limit])
    items = [{
        "id": str(p.id), "thumb_url": f"/private/{p.thumbnail_hash}/photo_cache/thumbnail/{p.id}.webp",
        "filename": p.filepath.rsplit("/", 1)[-1], "library": p.album.name, "owner": p.owner.username,
        "video": p.video, "date_taken": p.date_taken, "size_kb": p.size or p.size_total or 0,
        "size_total_kb": p.size_total or p.size or 0, "length_s": p.length, "megapixels": p.megapixels,
        "width": p.width, "height": p.height, "has_raw": bool(p.raw_filepath), "has_orig": bool(p.orig_filepath),
    } for p in rows]
    summary = {
        "count": len(items), "photos": sum(not i["video"] for i in items), "videos": sum(i["video"] for i in items),
        "size_kb": sum(i["size_kb"] for i in items), "size_total_kb": sum(i["size_total_kb"] for i in items),
        "length_s": sum(i["length_s"] or 0 for i in items if i["video"]),
        "max_megapixels": max((i["megapixels"] for i in items if i["megapixels"]), default=None),
    }
    return {"items": items, "summary": summary}


def _days(qs, category, limit):
    qs = qs.filter(date_taken__isnull=False)
    if category == "day-most-photos":
        qs, order = qs.filter(video=False), "photos"
    elif category == "day-most-videos":
        qs, order = qs.filter(video=True), "videos"
    elif category == "day-longest-video-time":
        qs, order = qs.filter(video=True, length__gt=0), "length_s"
    else:
        order = "size_kb"
    rows = (qs.values(day=F("date_taken__date"))
            .annotate(photos=Count("id", filter=Q(video=False)), videos=Count("id", filter=Q(video=True)),
                      size_kb=Sum("size_total"), length_s=Sum("length", filter=Q(video=True)))
            .order_by(F(order).desc(nulls_last=True), "-day")[:limit])
    return {"days": [{"date": r["day"], "photos": r["photos"], "videos": r["videos"], "size_kb": r["size_kb"] or 0,
                      "length_s": r["length_s"] or 0} for r in rows]}


@router.get("/superlatives/{category}", response=SuperlativesOut,
            summary="Rankings: largest, longest, highest resolution, biggest originals/RAW, busiest days (top 20-200)")
def superlatives(request, category: Category, limit: int = 50):
    limit = max(1, min(limit, 200))

    def compute():
        qs = _pool(request)
        body = _items(qs, category, limit) if category in ITEM else _days(qs, category, limit)
        return {"category": category, "kind": "item" if category in ITEM else "day", **body}
    return photo_cache.cached(request, "superlatives", compute, category, limit)


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
    return photo_cache.cached(request, "stats:v2", lambda: _stats(request))  # :v2 = response shape; never serve an old one


def _by_type(rows, key, size):
    """Aggregated (key, photos, videos, length_s) rows -> {"photos": [...], "videos": [...], "length_s": [...]} over 1..size
    (or 0..size-1 for hours), so every activity chart can switch between all / photos / videos / video duration."""
    base = 0 if key == "h" else 1
    out = {"photos": [0] * size, "videos": [0] * size, "length_s": [0] * size}
    for r in rows:
        if r[key] is None:
            continue
        i = int(r[key]) - base
        if 0 <= i < size:
            out["photos"][i] += r["photos"] or 0
            out["videos"][i] += r["videos"] or 0
            out["length_s"][i] += r["length_s"] or 0
    return out


def _stats(request):
    from django.db.models import Avg
    from django.db.models.functions import (
        ExtractDay,
        ExtractHour,
        ExtractIsoWeekDay,
        ExtractMonth,
        TruncMonth,
    )
    qs = library(request.user, request, listing=True)
    tz, now = _local_now(request)
    agg = qs.aggregate(total=Count("id"), videos=Count("id", filter=Q(video=True)), mp=Avg("megapixels", filter=Q(video=False)),
                       length_s=Sum("length", filter=Q(video=True)), first=Min("date_taken"), last=Max("date_taken"))
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
    live = dict(photos=Count("id", filter=Q(video=False)), videos=Count("id", filter=Q(video=True)),
                length_s=Sum("length", filter=Q(video=True)))
    # Hour of day needs the live table (the rollup is per day); in the viewer's time zone.
    by_hour = _by_type(dated.annotate(h=ExtractHour("date_taken", tzinfo=tz)).values("h").annotate(**live), "h", 24)
    rollup = daily(request)
    if rollup is not None:  # per-day rollup: day of month, weekday, month of year and months without touching photos
        summed = dict(photos=Sum("photos"), videos=Sum("videos"), length_s=Sum("length_s"))
        by_day = lambda fn, k: rollup.annotate(**{k: fn("day")}).values(k).annotate(**summed)
        month_rows = rollup.annotate(m=TruncMonth("day")).values("m").annotate(**summed).order_by("m")
    else:
        by_day = lambda fn, k: dated.annotate(**{k: fn("date_taken", tzinfo=tz)}).values(k).annotate(**live)
        month_rows = dated.annotate(m=TruncMonth("date_taken", tzinfo=tz)).values("m").annotate(**live).order_by("m")
    months = [{"month": r["m"].strftime("%Y-%m"), "photos": r["photos"] or 0, "videos": r["videos"] or 0,
               "length_s": r["length_s"] or 0} for r in month_rows if r["m"] is not None]
    cams = (qs.exclude(camera_model__isnull=True).exclude(camera_model="").values("camera_make", "camera_model")
            .annotate(n=Count("id")).order_by("-n")[:10])
    top = lambda field: [{"name": r[field], "count": r["n"]} for r in qs.exclude(**{f"{field}__isnull": True})
                         .exclude(**{field: ""}).values(field).annotate(n=Count("id")).order_by("-n")[:10]]
    return {
        "totals": {"total": agg["total"], "photos": agg["total"] - agg["videos"], "videos": agg["videos"],
                   "video_length_s": agg["length_s"] or 0,
                   "avg_megapixels": round(agg["mp"], 1) if agg["mp"] else None,
                   "first": agg["first"], "last": agg["last"]},
        "periods": periods,
        "by_hour": by_hour,                                            # 0..23
        "by_weekday": _by_type(by_day(ExtractIsoWeekDay, "d"), "d", 7),   # Monday first
        "by_day_of_month": _by_type(by_day(ExtractDay, "d"), "d", 31),    # 1..31
        "by_month_of_year": _by_type(by_day(ExtractMonth, "d"), "d", 12),  # Jan..Dec
        "by_month": months,  # every month with photos, oldest first (upload history: months and years)
        "cameras": [{"make": c["camera_make"], "model": c["camera_model"], "count": c["n"]} for c in cams],
        "countries": top("location_country"), "cities": top("location_city"),
    }


# Storage breakdown, the classic Storage page's definitions: optimized = size, total = size_total (KB),
# RAW = photos' total - optimized, originals = videos' total - optimized, duration = sum of video length (s).
_P, _V = Q(video=False), Q(video=True)


_BREAKDOWN = dict(photo_count=Count("id", filter=_P), photo_kb=Sum("size", filter=_P), photo_total=Sum("size_total", filter=_P),
                  video_count=Count("id", filter=_V), video_kb=Sum("size", filter=_V), video_total=Sum("size_total", filter=_V),
                  video_s=Sum("length", filter=_V))


def _breakdown(r):
    """One aggregated row -> photo/video counts, optimized, RAW/original, duration and totals (all KB / seconds)."""
    v = {k: r.get(k) or 0 for k in _BREAKDOWN}
    return {"photo_count": v["photo_count"], "photo_kb": v["photo_kb"], "raw_kb": v["photo_total"] - v["photo_kb"],
            "video_count": v["video_count"], "video_kb": v["video_kb"], "original_kb": v["video_total"] - v["video_kb"],
            "video_s": v["video_s"], "count": v["photo_count"] + v["video_count"],
            "optimized_kb": v["photo_kb"] + v["video_kb"], "total_kb": v["photo_total"] + v["video_total"]}


def _add(a, b):
    return {k: a.get(k, 0) + b[k] for k in b}


@router.get("/storage", summary="Storage used: optimized vs total (originals/RAW) by library, year and month, camera and type")
def storage(request):
    return photo_cache.cached(request, "storage:v2", lambda: _storage(request))  # :v2 = response shape


def _storage(request):
    from django.db.models import Value
    from django.db.models.functions import NullIf, TruncMonth
    qs = library(request.user, request, listing=True)
    tz, _ = _local_now(request)
    t = _breakdown(qs.aggregate(**_BREAKDOWN))
    bucket = lambda count, opt, total, length=0: {"count": count, "optimized_kb": opt, "total_kb": total,
                                                  "overhead_kb": total - opt, "length_s": length}
    # By library: every visible library (empty ones too, like the classic page), biggest first.
    libs = {r["album_id"]: r for r in qs.values("album_id").annotate(**_BREAKDOWN)}
    subs = Album_Subscriber.objects.filter(user=request.user, visible=True).values_list("album_id", "album__name")
    by_library = sorted(({"id": aid, "name": name, **_breakdown(libs.get(aid, {}))} for aid, name in subs),
                        key=lambda r: (-r["total_kb"], r["name"].lower()))
    # By month in the viewer's time zone (one grouped query); years are sums of their months. No limit.
    by_month = [{"month": r["m"].strftime("%Y-%m"), **_breakdown(r)} for r in
                qs.exclude(date_taken__isnull=True).annotate(m=TruncMonth("date_taken", tzinfo=tz)).values("m")
                .annotate(**_BREAKDOWN).order_by("-m") if r["m"] is not None]
    years = {}
    for m in by_month:
        y = int(m["month"][:4])
        years[y] = _add(years.get(y, {}), {k: v for k, v in m.items() if k != "month"})
    by_year = [{"year": y, **years[y]} for y in sorted(years, reverse=True)]
    undated = _breakdown(qs.filter(date_taken__isnull=True).aggregate(**_BREAKDOWN))

    def group(field, n=12):
        """Top n by total size; blank and missing values are one "not recorded" row (name None), with its photo/video split."""
        rows = (qs.annotate(g=NullIf(field, Value(""))).values("g")
                .annotate(count=Count("id"), videos=Count("id", filter=_V), total=Sum("size_total"), opt=Sum("size"))
                .order_by(F("total").desc(nulls_last=True))[:n])  # Postgres sorts NULL first
        return [{"name": r["g"], "count": r["count"], "videos": r["videos"], "total_kb": r["total"] or 0,
                 "optimized_kb": r["opt"] or 0} for r in rows]
    largest = list(qs.filter(size_total__gt=0).select_related("album").order_by("-size_total")[:12])
    return {"all": bucket(t["count"], t["optimized_kb"], t["total_kb"], t["video_s"]),
            "photo": bucket(t["photo_count"], t["photo_kb"], t["photo_kb"] + t["raw_kb"]),
            "video": bucket(t["video_count"], t["video_kb"], t["video_kb"] + t["original_kb"], t["video_s"]),
            "by_library": by_library, "by_year": by_year, "by_month": by_month,
            "undated": undated if undated["count"] else None,
            "by_camera": group("camera_model"), "by_type": group("mimetype"),
            "largest": [{"id": str(p.id), "thumb_url": PhotoOut.resolve_thumb_url(p), "size_kb": p.size_total or 0,
                         "video": p.video, "date_taken": p.date_taken} for p in largest]}


# ---------------------------------------------------------------- Geoguessr and location entry
