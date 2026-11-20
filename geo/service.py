"""The placewise service client (settings.PLACEWISE_URL), shared by every request and job in this process.

Calls fail with Unavailable when the service isn't running or doesn't answer in time, so callers can carry
on without place names (a photo keeps its old ones; search skips place words) instead of erroring."""

import functools
import logging

from django.conf import settings
from django.core.cache import cache

log = logging.getLogger(__name__)

INTERACTIVE_TIMEOUT_S = 5  # a search box or a map click
BATCH_TIMEOUT_S = 120  # naming thousands of photos per request


class Unavailable(Exception):
    """The placewise service isn't running, isn't reachable or failed."""


@functools.lru_cache(maxsize=2)
def _client(timeout):
    from placewise.service import Client

    return Client(settings.PLACEWISE_URL, timeout=timeout)


def _call(fn, *args, timeout=INTERACTIVE_TIMEOUT_S, **kwargs):
    from placewise.service.client import ServiceError

    try:
        return fn(_client(timeout), *args, **kwargs)
    except (ServiceError, OSError) as exc:  # ServiceError covers transport errors and the API's error answers
        log.warning("placewise service: %s", exc)
        raise Unavailable(str(exc)) from exc


def lookup(lat, lon):
    """placewise Result for one point."""
    return _call(lambda c: c.lookup(lat, lon))


def lookup_many(lats, lons):
    """placewise Results for many points, in order (the client batches them)."""
    return _call(lambda c: c.lookup_many(lats, lons), timeout=BATCH_TIMEOUT_S)


def find(text, **options):
    """placewise Entities named `text` (names, codes, typos, prefixes); options as placewise.find."""
    return _call(lambda c: c.find(text, **options))


def outline(place_id):
    """GeoJSON FeatureCollection of a place's outline (empty when it has none), rings thinned for drawing.
    None for an unknown id."""
    key = f"geo:outline:{place_id}"
    found = cache.get(key)
    if found is not None:
        return found
    try:
        entity = _call(lambda c: c.get(place_id, geometry=True))
    except KeyError:
        return None
    rings = [] if entity.outline is None else [[[lon, lat] for lat, lon in _thin(r)] for r in entity.outline.rings]
    feature = {"type": "Feature", "properties": {"id": entity.place.id, "name": entity.place.name},
               "geometry": {"type": "MultiPolygon", "coordinates": [[r] for r in rings]}}
    found = {"type": "FeatureCollection", "features": [feature] if rings else []}
    cache.set(key, found, 24 * 3600)
    return found


def health():
    """{status, data_version, uptime_s, cache} from the service."""
    return _call(lambda c: c.health(), timeout=2)


def attribution():
    """The served packs' data sources as registry entries (name, licence, URL, what they're used for)."""
    found = cache.get("geo:attribution")
    if found is None:
        found = _call(lambda c: c.attribution(format="json"))
        cache.set("geo:attribution", found, 3600)
    return found


MAX_RING_POINTS = 4000


def _thin(ring):
    """At most MAX_RING_POINTS of a ring (every n-th point, keeping the last): enough to draw it."""
    if len(ring) <= MAX_RING_POINTS:
        return ring
    step = -(-len(ring) // MAX_RING_POINTS)
    kept = list(ring[::step])
    if kept[-1] != ring[-1]:
        kept.append(ring[-1])
    return kept
