"""/api/v2/photos/public/: what anyone with the link may use, signed in or not.

A shared album's page: public albums for anyone; private ones for their owner and members (the same
rule the old /photos/?album=<id> page had). Hidden photos never show.
"""

import datetime
import uuid
from typing import Optional

from django.db.models import Count, Max, Min, Q, Sum
from django.shortcuts import get_object_or_404
from ninja import Router, Schema
from ninja.errors import HttpError

from . import hidden as hidden_mode
from .api_common import PageOut, _page
from .models import Photo, ShareAlbum

router = Router(tags=["photos"])


class PublicAlbumOut(Schema):
    id: uuid.UUID
    name: str
    description: str
    owner: str
    public: bool
    photos: int
    videos: int
    size_kb: int
    first: Optional[datetime.datetime]
    last: Optional[datetime.datetime]
    cover_url: Optional[str]
    member: bool  # the viewer can also open it inside Photos


def _album(request, album_id):
    album = get_object_or_404(ShareAlbum.objects.select_related("owner"), id=album_id)
    user = request.user
    member = user.is_authenticated and (album.owner_id == user.id or user.is_superuser
                                        or album.sharealbum_users_subscribed.filter(user=user).exists())
    if not (album.public or member):
        raise HttpError(404, "Not found")  # don't confirm that a private album exists
    return album, member


def _photos(request, album):
    return hidden_mode.visible(Photo.objects.filter(photo_in_sharealbum__sharealbum=album), request)


@router.get("/albums/{uuid:album_id}", auth=None, response=PublicAlbumOut,
            summary="A shared album's name, owner and totals (public albums: no sign-in needed)")
def public_album(request, album_id: uuid.UUID):
    album, member = _album(request, album_id)
    qs = _photos(request, album)
    agg = qs.aggregate(photos=Count("id", filter=Q(video=False)), videos=Count("id", filter=Q(video=True)),
                       size=Sum("size_total"), first=Min("date_taken"), last=Max("date_taken"))
    cover = album.cover_photo if album.cover_photo_id and not album.cover_photo.hidden else \
        qs.order_by("-date_taken").first()
    owner = album.owner
    return {"id": album.id, "name": album.name, "description": album.description or "",
            "owner": owner.get_full_name() or owner.username, "public": album.public,
            "photos": agg["photos"], "videos": agg["videos"], "size_kb": agg["size"] or 0,
            "first": agg["first"], "last": agg["last"],
            "cover_url": f"/private/{cover.thumbnail_hash}/photo_cache/thumbnail/{cover.id}.webp" if cover else None,
            "member": member}


@router.get("/albums/{uuid:album_id}/photos", auth=None, response=PageOut, summary="A shared album's photos, newest first (paged like /timeline)")
def public_album_photos(request, album_id: uuid.UUID, before: Optional[datetime.datetime] = None, limit: int = 120,
                        before_id: Optional[uuid.UUID] = None):
    album, _ = _album(request, album_id)
    return _page(_photos(request, album), before, limit, before_id)
