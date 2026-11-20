"""Photo search's place words through placewise (photos.search.parse's `places` resolver).

A phrase becomes a search term only when placewise is confident: a strong score, or a fair one where every
word of the phrase is in the place's name or codes, so "dog" never turns into Dongola. A three-letter
phrase that is an airport's IATA code is that airport ("yyz" is Pearson, not the city it serves).

What a place matches: a country or state, the photos' stored country or state; a town or a big park, the
photos' stored place name (geo.naming stores national parks); anything else (an airport, a landmark, a
postcode, a small park) the photos within its box or a short way around its point. Lakes and seas aren't
search terms: their boxes take in whole shorelines of towns."""

import hashlib
import math
import re

from django.core.cache import cache

from . import service

STRONG, FAIR = 0.8, 0.6
POINT_PAD_KM = 2.0  # "near" an airport or landmark: its own radius plus this
AREA_MIN_KM = 3.0  # places at least this big (by radius) are searched by their box instead
CACHE_S = 24 * 3600


def _words(text):
    return set(re.findall(r"[\w]+", text.casefold()))


# One of these alone is a kind of place, not a place ("lake" is not Lake Mead); they still count inside a
# longer phrase ("lake ontario", "bay area").
GENERIC = frozenset("""lake lakes park parks beach beaches river bay mount mountain mountains falls island islands
airport station city town village national forest valley canyon hill hills creek harbour harbor pier bridge
tower museum university downtown centre center area region state province country""".split())


def _confident(entity, phrase):
    words = _words(phrase)
    if len(words) == 1 and words <= GENERIC:
        return False
    if _words(entity.place.name) == words:  # exactly its name: a postcode ("M5V"), a short name
        return True
    if entity.score >= STRONG:
        return True
    if entity.score < FAIR:
        return False
    known = _words(entity.place.name) | {str(v).casefold() for v in entity.place.codes.values()}
    return words <= known


def _box(entity):
    """[south, west, north, east] to search: the place's box when it's an area, else a circle's box."""
    r = entity.radius_km or 0
    if entity.bbox is not None and r >= AREA_MIN_KM:
        b = entity.bbox
        return [b.south, b.west, b.north, b.east]
    lat, lon = entity.point.lat, entity.point.lon
    km = r + POINT_PAD_KM
    dlat = km / 111.32
    dlon = km / (111.32 * max(math.cos(math.radians(lat)), 0.01))
    return [lat - dlat, lon - dlon, lat + dlat, lon + dlon]


def _pick(hits, phrase):
    if len(phrase) == 3 and phrase.isalpha():
        code = phrase.upper()
        airport = next((e for e in hits if e.place.codes.get("iata") == code), None)
        if airport is not None:
            return airport
    best = hits[0] if hits else None
    return best if best is not None and _confident(best, phrase) else None


def resolve(phrase):
    """(payload, label) for photos.search, or None (also when placewise isn't running)."""
    key = "geo:term:" + hashlib.sha1(re.sub(r"\s+", " ", phrase.casefold()).encode()).hexdigest()
    found = cache.get(key)
    if found is not None:
        return found or None
    try:
        entity = _pick(service.find(phrase, limit=5), phrase)
    except service.Unavailable:
        return None
    found = (_payload(entity) if entity is not None else ()) or ()
    cache.set(key, found, CACHE_S)
    return found or None


def _payload(entity):
    kind, name = entity.place.kind.value, entity.place.name
    if kind == "country":
        return {"countries": {name}}, name
    if kind == "admin1":
        return {"id": entity.place.id, "admin1": name}, name
    if kind == "water":
        return ()
    if kind in ("locality", "park") and (entity.radius_km or 0) >= AREA_MIN_KM:
        return {"id": entity.place.id, "named": name}, name
    near = {"kind": kind.replace("_", " "), "box": _box(entity)}
    label = name if (entity.radius_km or 0) >= AREA_MIN_KM else f"Near {name}"
    return {"id": entity.place.id, "near": near}, label
