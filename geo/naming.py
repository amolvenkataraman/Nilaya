"""A photo's place from placewise, stored on the photo for browsing, stats and search:
- location_city: the place's name. The city in towns and cities ("Las Vegas" on the Strip, not the census
  place Paradise; the nearest town out on a lake). In a national park or recreation area, the park
  ("Yosemite National Park"), with the city when the park is inside one ("Golden Gate National Recreation
  Area, San Francisco"). Census-designated places inside parks (Yosemite Valley) don't count as cities.
  Outside every town, the park the point is in ("Sierra National Forest") or the nearest town.
  On the water (a boat, a ferry, a pier at a lake's edge), the lake, bay or sea ("Lake Ontario"). A photo on
  the shore keeps its town; searching the lake still finds it (geo.places.water_photo_ids).
- location_admin1: the state or province, so search understands "Ontario".
- location_country: the country, for stats."""

from . import service

CITY_MAX, ADMIN1_MAX, COUNTRY_MAX = 128, 128, 32  # the photo columns' lengths
FIELDS = ("location_city", "location_admin1", "location_country")
CHANGES_KEPT = 25  # kinds of change a rename run keeps for the Maintenance page


def _name(field, limit):
    return field.name[:limit] if field is not None and field.name else None


NATIONAL = 1  # placewise park tier: national parks, preserves, seashores, NRAs, national urban parks
AT_EDGE_KM = 0.05  # this close to a lake's or reservoir's edge (a pier, a beach) counts as on it


def water_name(result):
    """The water the point is on (placewise `on`/`over`), or a lake or reservoir at whose edge it is."""
    w = result.water
    if w is not None and w.place.name and w.relation.value in ("on", "over"):
        return w.place.name
    return next((n.place.name for n in result.near
                 if n.place.kind.value == "water" and n.place.codes.get("type") in ("lake", "reservoir")
                 and n.distance_km is not None and n.distance_km <= AT_EDGE_KM and n.place.name), None)


def place_name(result):
    """The place's name: the water it's on, else the national park (with the city it's inside, if any), else
    the city. Outside every town (deep in a national forest) the park the point is in, else the nearest town."""
    water = water_name(result)
    if water:
        return water
    park = next((p.name for p in result.within if p.tier == NATIONAL and p.name), None)
    city = result.city.name if result.city is not None else None
    if park is None:
        if city:
            return city
        return next((p.name for p in result.within if p.name), None) or next(
            (n.place.name for n in result.near if n.place.kind.value == "locality" and n.place.name), None)
    real_city = city and result.city_within and result.city.codes.get("class") != "cdp"
    return f"{park}, {city}" if real_city else park


def from_result(result):
    """{location_city, location_admin1, location_country} from a placewise Result."""
    name = place_name(result)
    return {
        "location_city": name[:CITY_MAX] if name else None,
        "location_admin1": _name(result.admin1, ADMIN1_MAX),
        "location_country": _name(result.country, COUNTRY_MAX),
    }


def name_point(lat, lon):
    """The place fields for one point; service.Unavailable when placewise isn't running."""
    return from_result(service.lookup(lat, lon))


def name_photos(photos, *, dry_run=False, progress=None, chunk=2000):
    """Name every photo in `photos` (a queryset of geotagged photos) from placewise, in chunks.

    Points are looked up once per ~1 m (5 decimals), so bursts at one spot cost one lookup. Only photos
    whose names change are written. dry_run: count and sample the changes without writing.
    progress(done, total) is called after each chunk. Returns {total, changed, unchanged, changes, more_kinds}:
    changes is [(old "city, country", new "city, state, country", photos)], the CHANGES_KEPT most common, and
    more_kinds how many other kinds of change there were (kept off the run record: it stays small however big
    the library is).
    Raises service.Unavailable if placewise stops answering."""
    from collections import Counter

    from photos.models import Photo

    ids = list(photos.order_by("id").values_list("id", flat=True))
    total, changed, done = len(ids), 0, 0
    changes = Counter()
    for start in range(0, total, chunk):
        batch = list(Photo.objects.filter(id__in=ids[start:start + chunk])
                     .only("id", "latitude", "longitude", *FIELDS))
        points = sorted({(round(p.latitude, 5), round(p.longitude, 5)) for p in batch})
        results = service.lookup_many([a for a, _ in points], [b for _, b in points])
        named = {pt: from_result(r) for pt, r in zip(points, results, strict=True)}
        dirty = []
        for p in batch:
            new = named[(round(p.latitude, 5), round(p.longitude, 5))]
            if any(getattr(p, f) != new[f] for f in FIELDS):
                old_text = ", ".join(x for x in (p.location_city, p.location_country) if x) or "(none)"
                new_text = ", ".join(x for x in new.values() if x) or "(none)"
                changes[(old_text, new_text)] += 1
                for f, v in new.items():
                    setattr(p, f, v)
                dirty.append(p)
        if dirty and not dry_run:
            Photo.objects.bulk_update(dirty, FIELDS, batch_size=500)
        changed += len(dirty)
        done += len(batch)
        if progress:
            progress(done, total)
    return {"total": total, "changed": changed, "unchanged": total - changed,
            "changes": [(old, new, n) for (old, new), n in changes.most_common(CHANGES_KEPT)],
            "more_kinds": max(0, len(changes) - CHANGES_KEPT)}
