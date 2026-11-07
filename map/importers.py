"""Reading places from uploaded files for POST /api/v2/places/import: GeoJSON (incl. Google Takeout
"Saved Places.json") and KML. Pure parsing: each item is a dict ready for Location(**item), or None
when a feature has no usable point. Safe parsers only (expat with DTDs refused; no external entities)."""

import datetime
import json
import math
import re
from decimal import Decimal
from xml.parsers import expat

from ninja.errors import HttpError

from .models import Location

CATEGORIES = dict(Location.CATEGORY_CHOICES)
STATUSES = dict(Location.STATUS_CHOICES)
MAX_IMPORT_FEATURES = 2000
ALTITUDE_LIMIT = 999.999999  # the column is DECIMAL(9, 6)


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
