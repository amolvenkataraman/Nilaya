"""/api/v2/places/: saved places in groups (your own groups plus public ones, read-only).

Photo-derived features (photos here, visits, suggestions, most visited) read only the photos
the user can see through `photos.api_v2.library` (which also leaves hidden photos out).
"""

import datetime
import json
import math
import re
import uuid
from collections import Counter, defaultdict
from decimal import Decimal
from typing import Literal, Optional
from xml.parsers import expat

from django.core.cache import cache
from django.db import transaction
from django.db.models import Avg, Count, F, Q
from django.db.models.functions import Round, TruncDate
from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.utils.text import slugify
from ninja import Field, File, Form, Query, Router, Schema
from ninja.errors import HttpError
from ninja.files import UploadedFile

from photos.api_v2 import PhotoOut, library
from photos.models import BROKEN_GPS
from apikeys.auth import require_also

from .models import Location, LocationGroup

router = Router(tags=["places"])
CATEGORIES = dict(Location.CATEGORY_CHOICES)
STATUSES = dict(Location.STATUS_CHOICES)
Status = Literal["saved", "want_to_go", "visited"]

PHOTO_RADIUS_M = 150       # "photos here" and visits
SUGGEST_EXCLUDE_M = 200    # a frequent photo spot this close to a place is already saved
SUGGEST_MIN_DAYS = 2
DUPLICATE_M = 50           # import: same name this close = duplicate
CELL = 1000                # photo grid cells per degree (0.001 deg = ~111 m of latitude)
CELL_M = 111_320 / CELL
CELLS_TTL = 120            # seconds the per-user photo grid is cached
MAX_IMPORT_BYTES = 5 * 1024 * 1024
MAX_IMPORT_FEATURES = 2000
ALTITUDE_LIMIT = 999.999999  # the column is DECIMAL(9, 6)


class GroupOut(Schema):
    id: int
    name: str
    description: str
    is_public: bool
    mine: bool
    count: int
    visible: bool = False   # shown on my map (per person; hidden by default)
    archived: bool = False  # set by the owner


class GroupIn(Schema):
    name: str = Field(..., min_length=1, max_length=200)
    description: str = ""
    is_public: bool = False


class GroupPatch(Schema):
    name: Optional[str] = Field(None, min_length=1, max_length=200)
    description: Optional[str] = None
    is_public: Optional[bool] = None
    archived: Optional[bool] = None


class VisibilityIn(Schema):
    visible: bool


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
    status: str
    visited_on: Optional[datetime.date]
    updated_on: datetime.datetime


class PlaceIn(Schema):
    group_id: int
    name: str = Field(..., min_length=1, max_length=200)
    latitude: float = Field(..., ge=-90, le=90)
    longitude: float = Field(..., ge=-180, le=180)
    altitude: Optional[float] = Field(None, ge=-ALTITUDE_LIMIT, le=ALTITUDE_LIMIT)
    category: str = "other"
    description: str = ""
    address: Optional[str] = None
    rating: Optional[int] = Field(None, ge=1, le=5)
    notes: str = ""
    status: Status = "saved"
    visited_on: Optional[datetime.date] = None


class PlacePatch(Schema):
    group_id: Optional[int] = None
    name: Optional[str] = Field(None, min_length=1, max_length=200)
    latitude: Optional[float] = Field(None, ge=-90, le=90)
    longitude: Optional[float] = Field(None, ge=-180, le=180)
    altitude: Optional[float] = Field(None, ge=-ALTITUDE_LIMIT, le=ALTITUDE_LIMIT)
    category: Optional[str] = None
    description: Optional[str] = None
    address: Optional[str] = None
    rating: Optional[int] = Field(None, ge=0, le=5)  # 0 clears the rating
    notes: Optional[str] = None
    status: Optional[Status] = None
    visited_on: Optional[datetime.date] = None


class PlacePhotosOut(Schema):
    count: int
    visits: int
    first_visit: Optional[datetime.date]
    last_visit: Optional[datetime.date]
    photos: list[PhotoOut]


class SuggestionOut(Schema):
    latitude: float
    longitude: float
    photos: int
    days: int
    first_day: Optional[datetime.date]
    last_day: Optional[datetime.date]
    city: Optional[str]
    country: Optional[str]
    name: str
    address: str


class CategoryCount(Schema):
    key: str
    label: str
    count: int


class VisitedPlace(Schema):
    id: uuid.UUID
    name: str
    category: str
    visits: int
    last_visit: Optional[datetime.date]


class StatsOut(Schema):
    total: int
    by_status: dict[str, int]
    by_category: list[CategoryCount]
    most_visited: list[VisitedPlace]


class ImportOut(Schema):
    format: str
    found: int
    new: int
    duplicates: int
    invalid: int
    created: int
    sample: list[str]


# ---------- helpers ----------

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


def _dist_m(lat1, lon1, lat2, lon2):
    """Great-circle distance in metres."""
    p1, p2 = math.radians(lat1), math.radians(lat2)
    a = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lon2 - lon1) / 2) ** 2
    return 12_742_000 * math.asin(math.sqrt(min(1.0, a)))


def _cell(lat, lon):
    return round(lat * CELL), round(lon * CELL)


def _index(rows):
    """Grid index of (lat, lon, ...) tuples for fast "anything within r metres" lookups."""
    idx = defaultdict(list)
    for row in rows:
        idx[_cell(row[0], row[1])].append(row)
    return idx


def _near(idx, lat, lon, r):
    """Rows of a grid index within r metres of (lat, lon)."""
    cy, cx = _cell(lat, lon)
    ky = math.ceil(r / CELL_M)
    kx = min(math.ceil(r / (CELL_M * max(math.cos(math.radians(lat)), 0.01))), 60)
    for dy in range(-ky, ky + 1):
        for dx in range(-kx, kx + 1):
            for row in idx.get((cy + dy, cx + dx), ()):
                if _dist_m(lat, lon, row[0], row[1]) <= r:
                    yield row


def _photos_near(user, lat, lon, r=PHOTO_RADIUS_M):
    """(id, date_taken) of the user's photos within r metres: a bounding-box query, then exact distance."""
    dlat = r / 111_320
    dlon = r / (111_320 * max(math.cos(math.radians(lat)), 0.01))
    rows = library(user).filter(latitude__range=(lat - dlat, lat + dlat),
                                longitude__range=(lon - dlon, lon + dlon)).exclude(BROKEN_GPS) \
        .values_list("id", "latitude", "longitude", "date_taken")
    return [(pid, when) for pid, la, lo, when in rows if _dist_m(lat, lon, la, lo) <= r]


def _photo_cells(user):
    """The user's geotagged photos aggregated in SQL to (grid cell, local day) rows, as a grid index of
    (lat, lon, day, photos, city, country). Cached briefly: suggestions and stats both read it."""
    key = f"map:photo-cells:{user.pk}"
    try:
        cells = cache.get(key)
    except Exception:  # the cache is never required: if it's down, compute as before
        cells = None
    if cells is None:
        rows = (library(user).filter(latitude__isnull=False, longitude__isnull=False)
                .exclude(BROKEN_GPS)  # a 0 coordinate is broken GPS, not a visit to the equator/meridian
                .annotate(cy=Round(F("latitude") * CELL), cx=Round(F("longitude") * CELL),
                          day=TruncDate("date_taken"))
                .values("cy", "cx", "day", "location_city", "location_country")
                .annotate(n=Count("id"), lat=Avg("latitude"), lon=Avg("longitude"))
                .order_by())
        cells = defaultdict(list)
        for r in rows:
            cells[(int(r["cy"]), int(r["cx"]))].append(
                (r["lat"], r["lon"], r["day"], r["n"], r["location_city"], r["location_country"]))
        cells = dict(cells)
        try:
            cache.set(key, cells, CELLS_TTL)
        except Exception:
            pass
    return cells


def _clusters(cells):
    """Greedy clustering: the busiest unclaimed cell absorbs its unclaimed 3x3 neighbours."""
    totals = {c: sum(r[3] for r in rows) for c, rows in cells.items()}
    taken, out = set(), []
    for seed in sorted(totals, key=totals.get, reverse=True):
        if seed in taken:
            continue
        members = [(seed[0] + dy, seed[1] + dx) for dy in (-1, 0, 1) for dx in (-1, 0, 1)]
        members = [c for c in members if c in cells and c not in taken]
        taken.update(members)
        rows = [r for c in members for r in cells[c]]
        n = sum(r[3] for r in rows)
        days = sorted({r[2] for r in rows if r[2]})
        places = Counter()
        for r in rows:
            if r[4]:
                places[(r[4], r[5] or "")] += r[3]
        city, country = places.most_common(1)[0][0] if places else (None, None)
        out.append({"latitude": sum(r[0] * r[3] for r in rows) / n, "longitude": sum(r[1] * r[3] for r in rows) / n,
                    "photos": n, "days": len(days), "first_day": days[0] if days else None,
                    "last_day": days[-1] if days else None, "city": city, "country": country or None})
    return out


def _visits(cells, lat, lon):
    """Distinct days with photos within PHOTO_RADIUS_M (from the cell aggregates)."""
    return {r[2] for r in _near(cells, lat, lon, PHOTO_RADIUS_M) if r[2]}


# ---------- groups ----------

@router.get("/categories", summary="Place categories")
def categories(request):
    return [{"key": k, "label": v} for k, v in Location.CATEGORY_CHOICES]


@router.get("/groups", response=list[GroupOut])
def list_groups(request, include_archived: bool = False):
    from .models import GroupPreference
    groups = _visible_groups(request.user).annotate(count=Count("locations")).order_by("name")
    if not include_archived:
        groups = groups.filter(archived=False)
    shown = set(GroupPreference.objects.filter(user=request.user, visible=True).values_list("group_id", flat=True))
    return [{**{f: getattr(g, f) for f in ("id", "name", "description", "is_public", "count", "archived")},
             "mine": g.owner_id == request.user.id, "visible": g.id in shown} for g in groups]


def _set_visible(user, group_id, visible):
    from .models import GroupPreference
    get_object_or_404(_visible_groups(user), id=group_id)
    GroupPreference.objects.update_or_create(user=user, group_id=group_id, defaults={"visible": visible})


@router.put("/groups/{int:group_id}/visibility", summary="Show or hide a group's places on your map")
def set_group_visibility(request, group_id: int, payload: VisibilityIn):
    _set_visible(request.user, group_id, payload.visible)
    return {"id": group_id, "visible": payload.visible}


@router.post("/groups/{int:group_id}/only", summary="Show only this group on your map")
def only_group(request, group_id: int):
    from .models import GroupPreference
    _set_visible(request.user, group_id, True)
    GroupPreference.objects.filter(user=request.user).exclude(group_id=group_id).update(visible=False)
    return {"id": group_id, "visible": True}


@router.post("/groups", response={201: GroupOut})
def create_group(request, payload: GroupIn):
    from .models import GroupPreference
    g = LocationGroup.objects.create(owner=request.user, **payload.dict())
    GroupPreference.objects.create(user=request.user, group=g, visible=True)  # a new group shows on its creator's map
    return 201, {**payload.dict(), "id": g.id, "mine": True, "count": 0, "visible": True}


@router.patch("/groups/{int:group_id}", response=GroupOut)
def update_group(request, group_id: int, payload: GroupPatch):
    g = _own_group(request.user, group_id)
    for key, value in payload.dict(exclude_unset=True).items():
        if value is not None:  # every field is required: null leaves it as it is
            setattr(g, key, value)
    g.save()
    from .models import GroupPreference
    shown = GroupPreference.objects.filter(user=request.user, group=g, visible=True).exists()
    return {**{f: getattr(g, f) for f in ("id", "name", "description", "is_public", "archived")},
            "mine": True, "count": g.locations.count(), "visible": shown}


@router.delete("/groups/{int:group_id}", response={204: None})
def delete_group(request, group_id: int):
    _own_group(request.user, group_id).delete()
    return 204, None


@router.get("/groups/{int:group_id}/export", summary="Download a group as GeoJSON")
def export_group(request, group_id: int):
    group = get_object_or_404(_visible_groups(request.user), id=group_id)
    features = []
    for p in group.locations.all():
        coords = [float(p.longitude), float(p.latitude)] + ([float(p.altitude)] if p.altitude is not None else [])
        features.append({"type": "Feature", "geometry": {"type": "Point", "coordinates": coords}, "properties": {
            "name": p.name, "category": p.category, "status": p.status,
            "visited_on": p.visited_on.isoformat() if p.visited_on else None, "rating": p.rating,
            "address": p.address, "description": p.description, "notes": p.notes}})
    body = json.dumps({"type": "FeatureCollection", "name": group.name, "features": features},
                      ensure_ascii=False, indent=1)
    response = HttpResponse(body, content_type="application/geo+json")
    response["Content-Disposition"] = f'attachment; filename="{slugify(group.name) or "places"}.geojson"'
    return response


# ---------- import ----------

def _num(value):
    if isinstance(value, bool):
        return None
    try:
        value = float(value)
    except (TypeError, ValueError):
        return None
    return value if math.isfinite(value) else None


def _text(value, limit):
    return value.strip()[:limit] if isinstance(value, str) else ""


def _first(*values):
    return next((v.strip() for v in values if isinstance(v, str) and v.strip()), "")


_URL_COORDS = re.compile(r"[?&](?:q|query|ll)=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)|@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)")


def _item(name, lat, lon, alt=None, props=None):
    """A validated place dict, or None when the coordinates are unusable."""
    props = props or {}
    lat, lon, alt = _num(lat), _num(lon), _num(alt)
    if lat is None or lon is None or not (-90 <= lat <= 90 and -180 <= lon <= 180):
        return None
    rating = _num(props.get("rating"))
    try:
        visited_on = datetime.date.fromisoformat(props["visited_on"]) if isinstance(props.get("visited_on"), str) else None
    except ValueError:
        visited_on = None
    q = Decimal("0.000001")
    return {
        "name": (_first(name) or "Imported place")[:200],
        "latitude": Decimal(str(lat)).quantize(q), "longitude": Decimal(str(lon)).quantize(q),
        "altitude": Decimal(str(alt)).quantize(q) if alt is not None and abs(alt) <= ALTITUDE_LIMIT else None,
        "category": props.get("category") if props.get("category") in CATEGORIES else "other",
        "status": props.get("status") if props.get("status") in STATUSES else "saved",
        "visited_on": visited_on,
        "rating": int(rating) if rating is not None and 1 <= rating <= 5 else None,
        "address": _text(props.get("address"), 1000) or None,
        "description": _text(props.get("description"), 5000),
        "notes": _text(props.get("notes"), 5000),
    }


def _feature_item(feature):
    """GeoJSON Point feature (ours, generic or Google Takeout "Saved Places.json") -> place dict."""
    if not isinstance(feature, dict):
        return None
    props = feature.get("properties") if isinstance(feature.get("properties"), dict) else {}
    geom = feature.get("geometry") if isinstance(feature.get("geometry"), dict) else {}
    coords = geom.get("coordinates")
    if geom.get("type") != "Point" or not isinstance(coords, list) or len(coords) < 2:
        return None
    lon, lat = _num(coords[0]), _num(coords[1])
    alt = coords[2] if len(coords) > 2 else None
    loc = props.get("location") or props.get("Location") or {}
    loc = loc if isinstance(loc, dict) else {}
    if not lat and not lon:  # Takeout writes [0, 0] when it only has the Maps URL
        geo = loc.get("Geo Coordinates") if isinstance(loc.get("Geo Coordinates"), dict) else {}
        lat, lon = _num(geo.get("Latitude")), _num(geo.get("Longitude"))
        url = _first(props.get("google_maps_url"), props.get("Google Maps URL"))
        m = _URL_COORDS.search(url) if not (lat or lon) and url else None
        if m:
            lat, lon = (float(m.group(1)), float(m.group(2))) if m.group(1) else (float(m.group(3)), float(m.group(4)))
        if not lat and not lon:
            return None
    address = _first(props.get("address"), loc.get("address"), loc.get("Address"))
    props = {**props, "address": address,
             "description": _first(props.get("description"), props.get("Comment"), props.get("comment"))}
    name = _first(props.get("name"), props.get("Title"), loc.get("name"), loc.get("Business Name"), address)
    return _item(name, lat, lon, alt, props)


def _parse_geojson(text):
    try:
        doc = json.loads(text)
    except (ValueError, RecursionError):
        raise HttpError(400, "This isn't a GeoJSON, Google Takeout or KML file")
    if isinstance(doc, dict) and doc.get("type") == "Feature":
        features = [doc]
    elif isinstance(doc, dict) and doc.get("type") == "FeatureCollection" and isinstance(doc.get("features"), list):
        features = doc["features"]
    else:
        raise HttpError(400, "Expected a GeoJSON FeatureCollection")
    if len(features) > MAX_IMPORT_FEATURES:
        raise HttpError(400, f"Too many places (the limit is {MAX_IMPORT_FEATURES})")
    takeout_keys = {"google_maps_url", "Google Maps URL", "location", "Location"}
    takeout = any(isinstance(f, dict) and isinstance(f.get("properties"), dict)
                  and takeout_keys & f["properties"].keys() for f in features)
    items = [_feature_item(f) for f in features]
    return ("takeout" if takeout else "geojson"), items


def _parse_kml(data):
    """KML Placemarks with a Point. Parsed with expat with DTDs refused outright, so entity
    expansion ("billion laughs") and external entities can't happen (defusedxml isn't installed)."""
    parser = expat.ParserCreate(namespace_separator=" ")

    def forbid(*_):
        raise ValueError("DTDs are not allowed")

    parser.StartDoctypeDeclHandler = forbid
    parser.EntityDeclHandler = forbid
    parser.ExternalEntityRefHandler = forbid
    parser.SetParamEntityParsing(expat.XML_PARAM_ENTITY_PARSING_NEVER)
    items, path, buf = [], [], []
    current = None

    def start(tag, attrs):
        nonlocal current
        tag = tag.rsplit(" ", 1)[-1]
        path.append(tag)
        buf.clear()
        if tag == "Placemark":
            current = {}

    def end(tag):
        nonlocal current
        tag = tag.rsplit(" ", 1)[-1]
        text = "".join(buf).strip()
        buf.clear()
        path.pop()
        if current is None:
            return
        if tag in ("name", "description", "address") and path and path[-1] == "Placemark":
            current.setdefault(tag, text)
        elif tag == "coordinates" and "Point" in path:
            current.setdefault("coordinates", text)
        elif tag == "Placemark":
            parts = current.get("coordinates", "").split()[:1]
            xyz = parts[0].split(",") if parts else []
            items.append(_item(current.get("name"), xyz[1], xyz[0], xyz[2] if len(xyz) > 2 else None,
                               {"description": current.get("description"), "address": current.get("address")})
                         if len(xyz) >= 2 else None)
            current = None
            if len(items) > MAX_IMPORT_FEATURES:
                raise OverflowError

    def chars(data):
        if sum(map(len, buf)) < 20_000:
            buf.append(data)

    parser.StartElementHandler, parser.EndElementHandler, parser.CharacterDataHandler = start, end, chars
    try:
        parser.Parse(data, True)
    except OverflowError:
        raise HttpError(400, f"Too many places (the limit is {MAX_IMPORT_FEATURES})")
    except (expat.ExpatError, ValueError):
        raise HttpError(400, "This KML file can't be read (DTDs and entities aren't allowed)")
    return "kml", items


@router.post("/import", response=ImportOut,
             summary="Import GeoJSON, Google Takeout 'Saved Places.json' or KML into one of your groups")
def import_places(request, file: File[UploadedFile], group_id: Form[int], dry_run: Form[bool] = False):
    group = _own_group(request.user, group_id)
    if file.size > MAX_IMPORT_BYTES:
        raise HttpError(413, f"File is too large (the limit is {MAX_IMPORT_BYTES // (1024 * 1024)} MB)")
    data = file.read(MAX_IMPORT_BYTES + 1)
    if len(data) > MAX_IMPORT_BYTES:
        raise HttpError(413, "File is too large")
    if data.lstrip()[:1] == b"<" or (file.name or "").lower().endswith(".kml"):
        fmt, items = _parse_kml(data)
    else:
        try:
            fmt, items = _parse_geojson(data.decode("utf-8-sig"))
        except UnicodeDecodeError:
            raise HttpError(400, "The file must be UTF-8 text")
    norm = lambda s: " ".join(s.lower().split())  # noqa: E731
    seen = _index((float(la), float(lo), norm(n)) for n, la, lo in
                  group.locations.values_list("name", "latitude", "longitude"))
    new, duplicates = [], 0
    for it in filter(None, items):
        lat, lon, key = float(it["latitude"]), float(it["longitude"]), norm(it["name"])
        if any(row[2] == key for row in _near(seen, lat, lon, DUPLICATE_M)):
            duplicates += 1
            continue
        seen[_cell(lat, lon)].append((lat, lon, key))
        new.append(it)
    created = 0
    if not dry_run and new:
        with transaction.atomic():
            created = len(Location.objects.bulk_create([Location(group=group, **it) for it in new]))
    return {"format": fmt, "found": len(items), "new": len(new), "duplicates": duplicates,
            "invalid": sum(1 for it in items if it is None), "created": created,
            "sample": [it["name"] for it in new[:8]]}


# ---------- photo-derived ----------

@router.get("/suggestions", response=list[SuggestionOut],
            summary="Frequent photo spots (on 2+ days) that aren't near any place you can see")
def suggestions(request, min_photos: int = Query(5, ge=2, le=1000), limit: int = Query(20, ge=1, le=100)):
    clusters = [c for c in _clusters(_photo_cells(request.user))
                if c["photos"] >= min_photos and c["days"] >= SUGGEST_MIN_DAYS]
    places = _index((float(la), float(lo)) for la, lo in Location.objects.filter(
        group__in=_visible_groups(request.user)).values_list("latitude", "longitude"))
    out = []
    for c in sorted(clusters, key=lambda c: (c["days"], c["photos"]), reverse=True):
        if next(_near(places, c["latitude"], c["longitude"], SUGGEST_EXCLUDE_M), None):
            continue
        c["name"] = c["city"] or "Photo spot"
        c["address"] = ", ".join(filter(None, (c["city"], c["country"])))
        out.append(c)
        if len(out) >= limit:
            break
    return out


@router.get("/stats", response=StatsOut, summary="Your places by category and status, and the most visited")
def stats(request):
    own = Location.objects.filter(group__owner=request.user)
    by_status = dict.fromkeys(STATUSES, 0)
    by_status.update({r["status"]: r["n"] for r in own.values("status").annotate(n=Count("id")).order_by()})
    by_category = [{"key": r["category"], "label": CATEGORIES.get(r["category"], r["category"]), "count": r["n"]}
                   for r in own.values("category").annotate(n=Count("id")).order_by("-n", "category")]
    cells = _photo_cells(request.user)
    visited = []
    if cells:
        for pid, name, category, la, lo in own.values_list("id", "name", "category", "latitude", "longitude"):
            days = _visits(cells, float(la), float(lo))
            if days:
                visited.append({"id": pid, "name": name, "category": category,
                                "visits": len(days), "last_visit": max(days)})
    visited.sort(key=lambda v: (v["visits"], v["last_visit"]), reverse=True)
    return {"total": sum(by_status.values()), "by_status": by_status, "by_category": by_category,
            "most_visited": visited[:5]}


@router.get("/photos-near", response=PlacePhotosOut, summary=f"Your photos within {PHOTO_RADIUS_M} m of a point")
def photos_near(request, latitude: float = Query(..., ge=-90, le=90), longitude: float = Query(..., ge=-180, le=180),
                limit: int = Query(24, ge=1, le=100)):
    require_also(request, "photos")  # returns photo links
    return _photos_payload(request.user, latitude, longitude, limit)


# ---------- places ----------

@router.get("/geocode", summary="Search addresses and places on OpenStreetMap (Nominatim); off when ONLINE_MODE is off")
def geocode(request, q: str):
    import json
    import urllib.parse
    import urllib.request

    from django.conf import settings
    from django.http import JsonResponse

    query = q.strip()[:200]
    if not query:
        raise HttpError(400, "Type something to search for")
    if not getattr(settings, "ONLINE_MODE", True):  # same switch as scheduler/notifications
        raise HttpError(503, "Place search is off on this server (offline mode)")
    req = urllib.request.Request(
        "https://nominatim.openstreetmap.org/search?" + urllib.parse.urlencode({"format": "json", "q": query}),
        # Nominatim's policy: an identifying User-Agent and Referer (this site's own address).
        headers={"User-Agent": f"AVNet-Superapp/1.0 (+{settings.SITE_URL})", "Referer": settings.SITE_URL})
    try:
        with urllib.request.urlopen(req, timeout=10) as response:  # noqa: S310 - fixed https URL
            data = json.loads(response.read().decode("utf-8"))
    except Exception as exc:
        raise HttpError(502, "Place search is unavailable right now") from exc
    return JsonResponse(data, safe=False)


class PinOut(Schema):
    """Just what the map draws; the rest comes from GET /places/{id} when a place is opened."""
    id: uuid.UUID
    group_id: int
    name: str
    latitude: float
    longitude: float
    category: str
    status: str
    rating: Optional[int]
    address: Optional[str]  # list rows show it
    visited_on: Optional[datetime.date]


@router.get("/pins", response=list[PinOut], summary="Map pins: like the list (same filters) with only the fields a map needs")
def list_pins(request, group: Optional[int] = None, category: Optional[str] = None, q: str = "",
              status: Optional[Status] = None, min_rating: Optional[int] = Query(None, ge=1, le=5),
              south: Optional[float] = None, west: Optional[float] = None,
              north: Optional[float] = None, east: Optional[float] = None, visible: bool = False):
    # About a tenth of the full list's size with thousands of places, and no model objects built.
    qs = _places(request, group, category, q, status, min_rating, south, west, north, east, visible)
    return list(qs.order_by("name").values(*PinOut.model_fields))


@router.get("", response=list[PlaceOut], summary="Places (optionally one group, a category, a search or a map box)")
def list_places(request, group: Optional[int] = None, category: Optional[str] = None, q: str = "",
                status: Optional[Status] = None, min_rating: Optional[int] = Query(None, ge=1, le=5),
                south: Optional[float] = None, west: Optional[float] = None,
                north: Optional[float] = None, east: Optional[float] = None, visible: bool = False):
    return list(_places(request, group, category, q, status, min_rating, south, west, north, east, visible).order_by("name"))


def _places(request, group, category, q, status, min_rating, south, west, north, east, visible):
    groups = _visible_groups(request.user)
    if visible:  # only the groups I've turned on (and never archived ones): the map's normal load
        from .models import GroupPreference
        groups = groups.filter(archived=False, id__in=GroupPreference.objects.filter(
            user=request.user, visible=True).values("group_id"))
    qs = Location.objects.filter(group__in=groups)
    if group is not None:
        qs = qs.filter(group_id=group)
    if category:
        qs = qs.filter(category=category)
    if status:
        qs = qs.filter(status=status)
    if min_rating:
        qs = qs.filter(rating__gte=min_rating)
    if q:
        qs = qs.filter(Q(name__icontains=q) | Q(address__icontains=q) | Q(notes__icontains=q) | Q(description__icontains=q))
    if None not in (south, west, north, east):
        qs = qs.filter(latitude__gte=south, latitude__lte=north)
        qs = qs.filter(longitude__gte=west, longitude__lte=east) if west <= east else \
            qs.filter(Q(longitude__gte=west) | Q(longitude__lte=east))  # box crosses the antimeridian
    return qs


@router.post("", response={201: PlaceOut})
def create_place(request, payload: PlaceIn):
    data = _clean(payload.dict())
    data["group"] = _own_group(request.user, data.pop("group_id"))
    if data["status"] == "visited" and not data["visited_on"]:
        data["visited_on"] = timezone.localdate()
    return 201, Location.objects.create(**data)


@router.get("/{uuid:place_id}", response=PlaceOut)
def get_place(request, place_id: uuid.UUID):
    return get_object_or_404(Location, id=place_id, group__in=_visible_groups(request.user))


def _photos_payload(user, lat, lon, limit):
    near = _photos_near(user, lat, lon)
    days = sorted({timezone.localtime(when).date() for _, when in near if when})
    oldest = datetime.datetime.min.replace(tzinfo=datetime.timezone.utc)
    newest = sorted(near, key=lambda p: p[1] or oldest, reverse=True)[:limit]
    photos = library(user).filter(id__in=[pid for pid, _ in newest]).select_related("album").order_by("-date_taken")
    return {"count": len(near), "visits": len(days), "first_visit": days[0] if days else None,
            "last_visit": days[-1] if days else None, "photos": list(photos)}


@router.get("/{uuid:place_id}/photos", response=PlacePhotosOut,
            summary=f"Your photos within {PHOTO_RADIUS_M} m of a place, newest first, and visits (distinct days)")
def place_photos(request, place_id: uuid.UUID, limit: int = Query(24, ge=1, le=100)):
    require_also(request, "photos")  # returns photo links
    place = get_object_or_404(Location, id=place_id, group__in=_visible_groups(request.user))
    return _photos_payload(request.user, float(place.latitude), float(place.longitude), limit)


@router.patch("/{uuid:place_id}", response=PlaceOut)
def update_place(request, place_id: uuid.UUID, payload: PlacePatch):
    place = get_object_or_404(Location, id=place_id, group__owner=request.user)
    nullable = {"altitude", "address", "rating", "visited_on", "status"}  # status: dropped below
    data = _clean({k: v for k, v in payload.dict(exclude_unset=True).items() if v is not None or k in nullable})
    if "group_id" in data:
        data["group"] = _own_group(request.user, data.pop("group_id"))
    if data.get("status") is None:
        data.pop("status", None)  # status can't be cleared, only changed
    elif data["status"] == "visited" and "visited_on" not in data and not place.visited_on:
        data["visited_on"] = timezone.localdate()
    for key, value in data.items():
        setattr(place, key, value)
    place.save()
    return place


@router.delete("/{uuid:place_id}", response={204: None})
def delete_place(request, place_id: uuid.UUID):
    get_object_or_404(Location, id=place_id, group__owner=request.user).delete()
    return 204, None
