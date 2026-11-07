"""/api/v2/photos/albums: shared albums (create, edit, cover, members, photos in them)."""

import datetime
import uuid
from typing import Literal, Optional

from django.db.models import Count, Max, Min, OuterRef, Q, Subquery, Sum
from django.db.models.functions import Coalesce
from django.shortcuts import get_object_or_404
from ninja import Field, Router, Schema
from ninja.errors import HttpError

from . import hidden as hidden_mode
from .api_common import IdsIn, PageOut, ShareAlbumOut, _page, library
from .models import Photo, ShareAlbum

router = Router()  # tags come from photos.api_v2.router


def _album_totals(request):
    """count and size_kb of a shared album (OuterRef "pk") as subqueries: joining photos and members in one
    query multiplied the size by the number of members. Hidden photos count only in show-hidden mode."""
    from .models import ShareAlbum_Photo
    rows = hidden_mode.visible(ShareAlbum_Photo.objects.filter(sharealbum=OuterRef("pk")), request, prefix="photo__") \
        .order_by().values("sharealbum")
    return {"count": Coalesce(Subquery(rows.annotate(n=Count("id")).values("n")), 0),
            "videos": Coalesce(Subquery(rows.annotate(n=Count("id", filter=Q(photo__video=True))).values("n")), 0),
            "size_kb": Coalesce(Subquery(rows.annotate(s=Sum("photo__size_total")).values("s")), 0),
            "first": Subquery(rows.annotate(d=Min("photo__date_taken")).values("d")),
            "last": Subquery(rows.annotate(d=Max("photo__date_taken")).values("d"))}


@router.get("/albums", response=list[ShareAlbumOut], summary="Shared albums you own or were added to")
def albums(request):
    qs = (ShareAlbum.objects.filter(Q(owner=request.user) | Q(sharealbum_users_subscribed__user=request.user))
          .distinct().select_related("cover_photo__album", "owner").annotate(**_album_totals(request))
          .order_by("name"))
    out = []
    for a in qs:
        cover = a.cover_photo if a.cover_photo and not a.cover_photo.hidden else (
            Photo.objects.filter(photo_in_sharealbum__sharealbum=a, hidden=False)
            .select_related("album").order_by("-date_taken").first())
        out.append({"id": a.id, "name": a.name, "description": a.description, "public": a.public,
                    "mine": a.owner_id == request.user.id, "owner": a.owner.username, "count": a.count,
                    "videos": a.videos, "size_kb": a.size_kb or 0, "first": a.first, "last": a.last, "cover": cover})
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
    agg = hidden_mode.visible(photos, request).aggregate(  # same as /albums
        n=Count("id"), videos=Count("id", filter=Q(video=True)), size=Sum("size_total"),
        first=Min("date_taken"), last=Max("date_taken"))
    return {"id": a.id, "name": a.name, "description": a.description, "public": a.public,
            "mine": a.owner_id == request.user.id, "owner": a.owner.username, "count": agg["n"],
            "videos": agg["videos"], "size_kb": agg["size"] or 0, "first": agg["first"], "last": agg["last"],
            "cover": cover}


def _own_share_album(user, album_id):
    return get_object_or_404(ShareAlbum, id=album_id, owner=user)


@router.post("/albums", response={201: ShareAlbumOut}, summary="Create a shared album")
def create_album(request, payload: AlbumIn):
    import bleach

    from .models import ShareAlbum_Subscriber
    a = ShareAlbum.objects.create(owner=request.user, name=bleach.clean(payload.name),
                                  description=bleach.clean(payload.description), public=payload.public)
    ShareAlbum_Subscriber.objects.create(album=a, user=request.user, subscribe_type=0)
    return 201, _album_out(a, request)


@router.patch("/albums/{uuid:album_id}", response=ShareAlbumOut, summary="Rename, describe, make public, set the cover (owner)")
def update_album(request, album_id: uuid.UUID, payload: AlbumPatch):
    import bleach

    from .models import ShareAlbum_Photo
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
    from notifications.service import notify
    from users.models import ComptechUser

    from .models import ShareAlbum_Subscriber
    a = _own_share_album(request.user, album_id)
    target = get_object_or_404(ComptechUser, username=payload.username)
    if target.id == request.user.id or ShareAlbum_Subscriber.objects.filter(album=a, user=target).exists():
        raise HttpError(400, "They already have access")
    m = ShareAlbum_Subscriber.objects.create(album=a, user=target, subscribe_type=ROLE_TO_TYPE[payload.role])
    notify(target, f"{request.user.get_full_name() or request.user.username} shared \"{a.name}\" with you",
           f"You can {'edit' if payload.role == 'editor' else 'view'} this album.", source="Photos",
           url=f"/photos/albums/{a.id}")
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


@router.get("/albums/{uuid:album_id}/photos", response=PageOut)
def album_photos(request, album_id: uuid.UUID, before: Optional[datetime.datetime] = None, limit: int = 120,
                 before_id: Optional[uuid.UUID] = None):
    album = get_object_or_404(ShareAlbum.objects.filter(
        Q(owner=request.user) | Q(sharealbum_users_subscribed__user=request.user) | Q(public=True)).distinct(),
        id=album_id)
    return _page(hidden_mode.visible(Photo.objects.filter(photo_in_sharealbum__sharealbum=album), request), before, limit, before_id)


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
