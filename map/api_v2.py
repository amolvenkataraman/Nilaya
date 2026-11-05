"""/api/v2/places/: saved places in groups (your own groups plus public ones)."""

import uuid
from decimal import Decimal
from typing import Optional

from django.db.models import Count, Q
from django.shortcuts import get_object_or_404
from ninja import Field, Router, Schema
from ninja.errors import HttpError

from .models import Location, LocationGroup

router = Router(tags=["places"])
CATEGORIES = dict(Location.CATEGORY_CHOICES)


class GroupOut(Schema):
    id: int
    name: str
    description: str
    is_public: bool
    mine: bool
    count: int


class GroupIn(Schema):
    name: str = Field(..., min_length=1, max_length=200)
    description: str = ""
    is_public: bool = False


class GroupPatch(Schema):
    name: Optional[str] = Field(None, min_length=1, max_length=200)
    description: Optional[str] = None
    is_public: Optional[bool] = None


class PlaceOut(Schema):
    id: uuid.UUID
    group_id: int
    name: str
    description: str
    latitude: float
    longitude: float
    altitude: Optional[float]
    category: str
    address: Optional[str]
    rating: Optional[int]
    notes: str


class PlaceIn(Schema):
    group_id: int
    name: str = Field(..., min_length=1, max_length=200)
    latitude: float = Field(..., ge=-90, le=90)
    longitude: float = Field(..., ge=-180, le=180)
    altitude: Optional[float] = None
    category: str = "other"
    description: str = ""
    address: Optional[str] = None
    rating: Optional[int] = Field(None, ge=1, le=5)
    notes: str = ""


class PlacePatch(Schema):
    group_id: Optional[int] = None
    name: Optional[str] = Field(None, min_length=1, max_length=200)
    latitude: Optional[float] = Field(None, ge=-90, le=90)
    longitude: Optional[float] = Field(None, ge=-180, le=180)
    altitude: Optional[float] = None
    category: Optional[str] = None
    description: Optional[str] = None
    address: Optional[str] = None
    rating: Optional[int] = Field(None, ge=0, le=5)  # 0 clears the rating
    notes: Optional[str] = None


def _visible_groups(user):
    return LocationGroup.objects.filter(Q(owner=user) | Q(is_public=True))


def _own_group(user, group_id):
    return get_object_or_404(LocationGroup, id=group_id, owner=user)


def _clean(data):
    if "category" in data and data["category"] not in CATEGORIES:
        raise HttpError(400, "Unknown category")
    for key in ("latitude", "longitude", "altitude"):
        if data.get(key) is not None:
            data[key] = Decimal(str(data[key])).quantize(Decimal("0.000001"))
    if data.get("rating") == 0:
        data["rating"] = None
    return data


@router.get("/categories", summary="Place categories")
def categories(request):
    return [{"key": k, "label": v} for k, v in Location.CATEGORY_CHOICES]


@router.get("/groups", response=list[GroupOut])
def list_groups(request):
    groups = _visible_groups(request.user).annotate(count=Count("locations")).order_by("name")
    return [{**{f: getattr(g, f) for f in ("id", "name", "description", "is_public", "count")},
             "mine": g.owner_id == request.user.id} for g in groups]


@router.post("/groups", response={201: GroupOut})
def create_group(request, payload: GroupIn):
    g = LocationGroup.objects.create(owner=request.user, **payload.dict())
    return 201, {**payload.dict(), "id": g.id, "mine": True, "count": 0}


@router.patch("/groups/{int:group_id}", response=GroupOut)
def update_group(request, group_id: int, payload: GroupPatch):
    g = _own_group(request.user, group_id)
    for key, value in payload.dict(exclude_unset=True).items():
        setattr(g, key, value)
    g.save()
    return {**{f: getattr(g, f) for f in ("id", "name", "description", "is_public")},
            "mine": True, "count": g.locations.count()}


@router.delete("/groups/{int:group_id}", response={204: None})
def delete_group(request, group_id: int):
    _own_group(request.user, group_id).delete()
    return 204, None


@router.get("", response=list[PlaceOut], summary="Places (optionally one group, a category, a search or a map box)")
def list_places(request, group: Optional[int] = None, category: Optional[str] = None, q: str = "",
                south: Optional[float] = None, west: Optional[float] = None,
                north: Optional[float] = None, east: Optional[float] = None):
    qs = Location.objects.filter(group__in=_visible_groups(request.user))
    if group is not None:
        qs = qs.filter(group_id=group)
    if category:
        qs = qs.filter(category=category)
    if q:
        qs = qs.filter(Q(name__icontains=q) | Q(address__icontains=q) | Q(notes__icontains=q) | Q(description__icontains=q))
    if None not in (south, west, north, east):
        qs = qs.filter(latitude__gte=south, latitude__lte=north)
        qs = qs.filter(longitude__gte=west, longitude__lte=east) if west <= east else \
            qs.filter(Q(longitude__gte=west) | Q(longitude__lte=east))  # box crosses the antimeridian
    return list(qs.order_by("name"))


@router.post("", response={201: PlaceOut})
def create_place(request, payload: PlaceIn):
    data = _clean(payload.dict())
    data["group"] = _own_group(request.user, data.pop("group_id"))
    return 201, Location.objects.create(**data)


@router.get("/{uuid:place_id}", response=PlaceOut)
def get_place(request, place_id: uuid.UUID):
    return get_object_or_404(Location, id=place_id, group__in=_visible_groups(request.user))


@router.patch("/{uuid:place_id}", response=PlaceOut)
def update_place(request, place_id: uuid.UUID, payload: PlacePatch):
    place = get_object_or_404(Location, id=place_id, group__owner=request.user)
    data = _clean(payload.dict(exclude_unset=True))
    if "group_id" in data:
        data["group"] = _own_group(request.user, data.pop("group_id"))
    for key, value in data.items():
        setattr(place, key, value)
    place.save()
    return place


@router.delete("/{uuid:place_id}", response={204: None})
def delete_place(request, place_id: uuid.UUID):
    get_object_or_404(Location, id=place_id, group__owner=request.user).delete()
    return 204, None
