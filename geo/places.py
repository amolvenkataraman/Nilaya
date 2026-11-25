"""Place words in search, through placewise: shared by every app that searches things with a location (photos
today, location history next). `resolve(phrase)` turns words into a place term; `place_q(term, ...)` is the
filter for any table with latitude/longitude (and, if it has them, stored place names); a lake or sea first
needs `ids_on_or_near_water(rows, term)` to find the rows taken on or near it.

A phrase becomes a search term only when placewise is confident: a strong score, or a fair one where every
word of the phrase is in the place's name or codes, so "dog" never turns into Dongola. A three-letter
phrase that is an airport's IATA code is that airport ("yyz" is Pearson, not the city it serves).

When several places share a name (Union Square, Chinatown), the caller's `prefer` picks the one it has data at.

What a place matches: a country or state, the stored country or state; a big park, the stored place name
(geo.naming stores national parks); a lake, sea or river, the photos placewise
says were taken on it or near it (water_photo_ids: near is 0.3-5 km by the water's size, so a lake's box
full of shore towns doesn't count); anything else (a town or neighbourhood the vocabulary didn't know, an
airport, a landmark, a postcode, a small park) the photos within its box or a short way around its point."""

import hashlib
import math
import re

from django.core.cache import cache

from . import service

STRONG, FAIR = 0.8, 0.6
PAD_KM = {"airport": 2.0}  # "near" a place: its own radius plus this (an airport's grounds are big)
PAD_KM_DEFAULT = 0.5  # landmarks, buildings, small parks: close by, not the whole district
AREA_MIN_KM = 3.0  # places at least this big (by radius) are searched by their box instead
TOWN_MIN_KM = 5.0  # localities smaller than this are neighbourhoods: searched within NEIGHBOURHOOD_KM of the centre
NEIGHBOURHOOD_KM = 1.0
WATER_NEAR_KM = 5.0  # placewise's widest "near water" (the Great Lakes, seas): the candidate box is padded by it
WATER_MAX_POINTS = 50_000  # distinct spots looked up for one water search
CACHE_S = 24 * 3600


def _words(text):
    """Lowercase words, plural -s dropped ("Toronto Islands" has "island")."""
    return {w[:-1] if len(w) > 3 and w.endswith("s") and not w.endswith("ss") else w
            for w in re.findall(r"[\w]+", text.casefold())}


# One of these alone is a kind of place, not a place ("lake" is not Lake Mead); they still count inside a
# longer phrase ("lake ontario", "bay area").
GENERIC = frozenset("""lake lakes park parks beach beaches river rivers bay bays sea seas ocean oceans gulf coast shore
water waterfront island islands airport station city town village national forest valley canyon hill hills creek
harbour harbor pier bridge tower museum university downtown centre center area region state province country
north south east west""".split())
COMPASS = frozenset({"north", "south", "east", "west"})
CODE_MIN_SCORE = 0.8  # a three-letter word is an airport's code only when placewise is sure ("yyz", not "bay")


def _confident(entity, phrase):
    words = _words(phrase)
    if len(words) == 1 and words <= GENERIC:
        return False
    if _words(entity.place.name) == words:  # exactly its name: a postcode ("M5V"), a short name
        return True
    if entity.place.kind.value == "water" and len(words) > 1 and words <= _words(entity.place.name):
        return True  # "pacific ocean" in "North Pacific Ocean": water names score low but read plainly
    if entity.score >= STRONG:
        return True
    if entity.score < FAIR:
        return False
    known = _words(entity.place.name) | {str(v).casefold() for v in entity.place.codes.values()}
    return words <= known


def _box(entity):
    """[south, west, north, east] to search: a town's or area's own box; a neighbourhood's centre; around a
    point place (airport, landmark) by its size plus a pad."""
    r, kind = entity.radius_km or 0, entity.place.kind.value
    if kind == "locality" and r < TOWN_MIN_KM:
        km = NEIGHBOURHOOD_KM
    elif entity.bbox is not None and r >= AREA_MIN_KM:
        b = entity.bbox
        return [b.south, b.west, b.north, b.east]
    else:
        km = r + PAD_KM.get(kind, PAD_KM_DEFAULT)
    lat, lon = entity.point.lat, entity.point.lon
    dlat = km / 111.32
    dlon = km / (111.32 * max(math.cos(math.radians(lat)), 0.01))
    return [lat - dlat, lon - dlon, lat + dlat, lon + dlon]


def _pick(hits, phrase, prefer=None):
    if len(phrase) == 3 and phrase.isalpha() and phrase.casefold() not in GENERIC:
        code = phrase.upper()
        airport = next((e for e in hits if e.place.codes.get("iata") == code and e.score >= CODE_MIN_SCORE), None)
        if airport is not None:
            return airport
    best = hits[0] if hits else None
    if best is None or not _confident(best, phrase):
        return None
    if prefer is not None:
        # Same name, several places (Union Square in New York and San Francisco): the one the caller has data at.
        same = [e for e in hits if _words(e.place.name) == _words(best.place.name) and _confident(e, phrase)]
        if len(same) > 1:
            return next((e for e in same if prefer(_box(e))), best)
    return best


def _find(phrase):
    """placewise's hits for a phrase, cached a day (the choice among them depends on the caller's data)."""
    from placewise.model.places import Entity

    key = "geo:find:" + hashlib.sha1(re.sub(r"\s+", " ", phrase.casefold()).encode()).hexdigest()
    cached = cache.get(key)
    if cached is not None:
        return [Entity.from_dict(d) for d in cached]
    hits = service.find(phrase, limit=5)
    cache.set(key, [e.to_dict() for e in hits], CACHE_S)
    return hits


def resolve(phrase, prefer=None):
    """(term, label) for a search, or None (also when placewise isn't running). prefer(box) -> bool: whether the
    caller has anything in [south, west, north, east], to choose among same-named places."""
    try:
        hits = _find(phrase)
    except service.Unavailable:
        return None
    entity = _pick(hits, phrase, prefer)
    return (_payload(entity, hits) if entity is not None else None) or None


def _payload(entity, hits=()):
    kind, name = entity.place.kind.value, entity.place.name
    if kind == "country":
        return {"countries": {name}}, name
    if kind == "admin1":
        return {"id": entity.place.id, "admin1": name}, name
    if kind == "water":
        # Every water hit with the same words in its name counts: both outlines of Lake Tahoe, both halves of the
        # Pacific ("pacific ocean").
        core = _words(name) - COMPASS
        waters = [e for e in [entity, *hits] if e.place.kind.value == "water" and e.bbox is not None
                  and core <= _words(e.place.name)]
        if not waters:
            return ()
        south, north = min(e.bbox.south for e in waters), max(e.bbox.north for e in waters)
        west, east = min(e.bbox.west for e in waters), max(e.bbox.east for e in waters)
        dlat = WATER_NEAR_KM / 111.32
        dlon = WATER_NEAR_KM / (111.32 * max(math.cos(math.radians((south + north) / 2)), 0.01))
        box = [south - dlat, west - dlon, north + dlat, east + dlon]
        ids = sorted({e.place.id for e in waters})
        return {"id": entity.place.id, "water": {"box": box, "ids": ids}}, name
    if kind == "park" and (entity.radius_km or 0) >= AREA_MIN_KM:
        return {"id": entity.place.id, "named": name}, name  # big parks are stored as the photos' place
    near = {"kind": kind.replace("_", " "), "box": _box(entity)}
    label = name if (entity.radius_km or 0) >= AREA_MIN_KM else f"Near {name}"
    return {"id": entity.place.id, "near": near}, label


def ids_on_or_near_water(rows, data, *, lat="latitude", lon="longitude"):
    """Ids of the rows (any queryset with latitude/longitude fields) taken on or near the water body in `data`
    (a water term): the rows in its padded box, looked up once per ~10 m spot, kept where placewise names that
    water (`on` it, or `near` it within placewise's distance for its size). [] when placewise isn't running."""
    south, west, north, east = data["water"]["box"]
    rows = (rows.filter(**{f"{lat}__range": (south, north), f"{lon}__range": (west, east)})
            .values_list("id", lat, lon))
    spots = {}
    for pid, la, lo in rows.iterator():
        if la is None or lo is None:
            continue
        lat_, lon_ = la, lo
        spots.setdefault((round(lat_, 4), round(lon_, 4)), []).append(pid)
        if len(spots) > WATER_MAX_POINTS:
            break
    if not spots:
        return []
    keys = list(spots)
    try:
        results = service.lookup_many([k[0] for k in keys], [k[1] for k in keys])
    except service.Unavailable:
        return []
    wanted, out = set(data["water"].get("ids") or [data["id"]]), []
    for key, r in zip(keys, results, strict=True):
        found = {r.water.place.id} if r.water is not None else set()
        found |= {n.place.id for n in r.near if n.place.kind.value == "water"}
        if wanted & found:
            out += spots[key]
    return out


def place_q(data, *, lat="latitude", lon="longitude", place="location_city", admin1="location_admin1",
            country="location_country"):
    """The filter for one placewise term (resolve()'s payload) on a table with these fields: a state matches the
    stored state, a town or big park the stored place name (alone or as "Park, City"), an airport or landmark
    its box, a lake or sea the ids found by ids_on_or_near_water (in data["ids"]). Pass None for a field the
    table doesn't have; its kind of term then matches nothing."""
    from django.db.models import Q

    none = Q(pk__in=[])
    if "admin1" in data:
        return Q(**{admin1: data["admin1"]}) if admin1 else none
    if "named" in data:
        if not place:
            return none
        n = data["named"]
        return Q(**{place: n}) | Q(**{f"{place}__startswith": n + ", "}) | Q(**{f"{place}__endswith": ", " + n})
    if "water" in data:
        return Q(pk__in=data.get("ids", ()))
    if "near" in data:
        b = data["near"]["box"]
        return Q(**{f"{lat}__range": (b[0], b[2]), f"{lon}__range": (b[1], b[3])})
    if "countries" in data:
        return Q(**{f"{country}__in": sorted(data["countries"])}) if country else none
    return none


def term_box(data):
    """The box a term searches ([south, west, north, east]), or None for terms matched by stored names."""
    if "near" in data:
        return data["near"]["box"]
    if "water" in data:
        return data["water"]["box"]
    return None
