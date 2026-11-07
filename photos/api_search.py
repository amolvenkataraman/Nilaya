"""/api/v2/photos/search: free-text photo search (see photos/search.py for the rules).

Same paging and items as /timeline, plus how the query was read:
- interpreted: [{type, kind, value, label, span, typo, detail}]; span = [first, last+1] indices into q.split(),
  so a client removes a term by dropping those words from q;
- unmatched: words nothing understood (ignored);
- count: matching photos and videos on the first page (capped at COUNT_CAP, then count_capped is true).
"""

import datetime
import uuid
from typing import Optional

from django.conf import settings
from django.db.models import Q
from django.utils import timezone
from ninja import Router, Schema

from . import cache as photo_cache
from . import hidden as hidden_mode
from . import search
from .models import Album_Subscriber, Photo, ShareAlbum, ShareAlbum_Photo

router = Router(tags=["photos"])

COUNT_CAP = 10000


class TermOut(Schema):
    type: str
    kind: str
    value: str
    label: str
    span: list[int]
    typo: Optional[str] = None
    detail: Optional[str] = None


def _schemas():
    from .api_v2 import PhotoOut

    class SearchOut(Schema):
        items: list[PhotoOut]
        next_before: Optional[datetime.datetime]
        next_before_id: Optional[uuid.UUID] = None
        interpreted: list[TermOut]
        unmatched: list[str]
        count: Optional[int] = None
        count_capped: bool = False

    return SearchOut


def _tz(user):
    from zoneinfo import ZoneInfo
    for name in (getattr(user, "timezone", ""), settings.TIME_ZONE):
        try:
            return ZoneInfo(name)
        except Exception:
            continue
    return datetime.timezone.utc


def vocab(request):
    """The library's places and cameras, from the cached browse lists (no extra scans when they're warm)."""
    from . import browse
    from .api_v2 import library

    def lists():
        def items(cat):
            return photo_cache.cached(request, "browse", lambda: browse.browse_items(
                library(request.user, request, listing=True), cat), cat)
        return search.build_vocab(items("cities"), items("countries"), items("cameras"))
    return photo_cache.cached(request, "search-vocab", lists)


def names(request):
    albums = (ShareAlbum.objects.filter(Q(owner=request.user) | Q(sharealbum_users_subscribed__user=request.user))
              .distinct().values_list("id", "name"))
    libs = Album_Subscriber.objects.filter(user=request.user).values_list("album_id", "album__name")
    return search.names_vocab(list(albums), list(libs))


def base_queryset(request, terms):
    """Photos the user may see: their visible libraries; a named library (even if switched off in Sources);
    a named shared album (its photos, from any library)."""
    from .api_v2 import library
    libs = {i for t in terms if t.type == "library" for i in t.data["ids"]}
    albums = {i for t in terms if t.type == "album" for i in t.data["ids"]}
    qs = library(request.user, request).filter(album_id__in=sorted(libs)) if libs else None
    if albums:
        inside = Q(id__in=ShareAlbum_Photo.objects.filter(sharealbum_id__in=sorted(albums)).values("photo_id"))
        qs = qs.filter(inside) if qs is not None else hidden_mode.visible(Photo.objects.filter(inside), request)
    return qs if qs is not None else library(request.user, request, listing=True)


@router.get("", response=_schemas(), summary="Search photos by place, object, camera, date, type, album; newest first")
def search_photos(request, q: str = "", before: Optional[datetime.datetime] = None,
                  before_id: Optional[uuid.UUID] = None, limit: int = 120):
    from .api_v2 import _page
    tz = _tz(request.user)
    v = vocab(request)
    terms, unmatched = search.parse(q[:200], v, timezone.localtime(timezone.now(), tz), names(request))
    if q.strip() and not terms:  # nothing understood: say so rather than showing everything
        return {"items": [], "next_before": None, "interpreted": [], "unmatched": unmatched, "count": 0}
    qs = base_queryset(request, terms).filter(search.filters(terms, v["city_countries"]))
    with timezone.override(tz):  # month/day lookups ("june", "summer") in the user's time zone
        page = _page(qs, before, limit, before_id)
        count = None
        if not before and not before_id:
            count = qs.exclude(date_taken__isnull=True).order_by()[:COUNT_CAP + 1].count()
    return {**page, "interpreted": [t.out() for t in terms], "unmatched": unmatched,
            "count": min(count, COUNT_CAP) if count is not None else None,
            "count_capped": bool(count and count > COUNT_CAP)}
