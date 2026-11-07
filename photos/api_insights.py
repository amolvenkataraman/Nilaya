"""/api/v2/photos/superlatives/{category}: rankings across the libraries you see.

Item rankings return photos with the numbers each ranking is about; day rankings return local days.
An original or RAW file that was also imported as its own item is counted once (its main photo).
Cached like stats and storage (photos/cache.py), so switching rankings back and forth is free.
"""

import datetime
from typing import Literal, Optional

from django.db.models import Count, Exists, F, OuterRef, Q, Sum
from ninja import Router, Schema

from . import cache as photo_cache
from .api_v2 import library

router = Router(tags=["photos"])

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
