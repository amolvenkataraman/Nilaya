"""/api/v2/photos/public/: what anyone with the link may use, signed in or not.

- A shared album's page: public albums for anyone; private ones for their owner and members
  (the same rule the old /photos/?album=<id> page had). Hidden photos never show.
- The upload portal: people send photos and videos to the site's owner (settings.ALLOW_PHOTO_UPLOADS,
  PHOTOS_UPLOAD_RECIPIENT_NAME from site.json, files land in settings.UPLOADS_DIR untouched, so all
  metadata is kept). Nothing is imported automatically.
"""

import datetime
import os
import uuid
from pathlib import Path
from typing import Optional

from django.conf import settings
from django.db.models import Count, Max, Min, Q, Sum
from django.shortcuts import get_object_or_404
from ninja import Router, Schema
from ninja.errors import HttpError
from ninja.utils import check_csrf

from . import hidden as hidden_mode
from .api_common import PageOut, _page
from .models import Photo, ShareAlbum

router = Router(tags=["photos"])

UPLOAD_EXTENSIONS = {"jpg", "jpeg", "png", "mp4", "mpg", "m4v", "mov", "mod", "avi", "3gp", "mkv", "gif", "heic", "webp"}


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


# ---------------------------------------------------------------- upload portal

class UploadInfo(Schema):
    enabled: bool
    recipient: str
    extensions: list[str]


@router.get("/upload", auth=None, response=UploadInfo, summary="The upload portal: whether it's open, and for whom")
def upload_info(request):
    return {"enabled": bool(getattr(settings, "ALLOW_PHOTO_UPLOADS", True)),
            "recipient": getattr(settings, "PHOTOS_UPLOAD_RECIPIENT_NAME", "the owner of this site"),
            "extensions": sorted(UPLOAD_EXTENSIONS)}


class UploadOut(Schema):
    saved: list[str]
    errors: list[str]


@router.post("/upload", auth=None, response=UploadOut,
             summary="Send photos or videos to the site's owner (multipart field `files`; saved untouched)")
def upload(request):
    if check_csrf(request) is not None:
        raise HttpError(403, "Your session expired. Reload the page and try again.")
    if not getattr(settings, "ALLOW_PHOTO_UPLOADS", True):
        raise HttpError(403, "Uploads are turned off.")
    files = request.FILES.getlist("files") or request.FILES.getlist("file") or list(request.FILES.values())
    if not files:
        raise HttpError(400, "No files were sent.")
    target_dir = settings.UPLOADS_DIR
    os.makedirs(target_dir, exist_ok=True)
    saved, errors = [], []
    for f in files:
        name = Path(f.name).name  # no directories: never write outside the uploads folder
        stem, dot, ext = name.rpartition(".")
        if not dot or not stem or ext.lower() not in UPLOAD_EXTENSIONS:
            errors.append(f"{name}: .{ext.lower() if dot else ''} files aren't accepted.")
            continue
        base, suffix = os.path.splitext(name)
        path, n = os.path.join(target_dir, name), 1
        while os.path.exists(path):  # never overwrite an earlier upload
            path, n = os.path.join(target_dir, f"{base}_{n}{suffix}"), n + 1
        try:
            with open(path, "xb") as out:  # raw chunks: EXIF and video metadata stay exactly as sent
                for chunk in f.chunks():
                    out.write(chunk)
        except OSError as exc:
            errors.append(f"{name}: couldn't be saved ({exc.strerror or 'disk error'}).")
            continue
        saved.append(os.path.basename(path))
    if not saved:
        raise HttpError(400, " ".join(errors))
    return {"saved": saved, "errors": errors}
