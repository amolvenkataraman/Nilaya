"""Shared photo browsing helpers (used by the classic search pages and the V2 API).

- object_names(ids) / object_ids(names): YOLO class ids <-> names (photos/AI/objects.py).
- with_objects(qs, ids): photos containing ALL the given objects, on Postgres and SQLite.
- object_counts(qs): {object_id: count} over a queryset.
- browse_items(qs, category): [{display, value, count}] for cities/countries/cameras/objects.
"""

from collections import Counter

from django.db import connection
from django.db.models import Count

from .AI.objects import NAME_TO_ID_MAPPING

ID_TO_NAMES = {}
for _name, _idx in NAME_TO_ID_MAPPING.items():
    ID_TO_NAMES.setdefault(_idx, []).append(_name)


def object_label(object_id):
    return " / ".join(n.replace("_", " ").title() for n in ID_TO_NAMES.get(object_id, [])) or f"Object {object_id}"


def object_ids(names):
    return sorted({NAME_TO_ID_MAPPING[n.strip().lower().replace(" ", "_")] for n in names
                   if n.strip().lower().replace(" ", "_") in NAME_TO_ID_MAPPING})


def _ids_with_object(qs, object_id):
    """Photo ids in qs whose ai_index_info.objects contains object_id (portable)."""
    if connection.vendor == "postgresql":
        return qs.filter(ai_index_info__objects__contains=[object_id]).values("id")
    # SQLite has no JSON containment lookup: match with json_each over the candidate rows.
    sub = qs.values("id").query
    sql, params = sub.sql_with_params()
    with connection.cursor() as c:
        c.execute(f"SELECT p.id FROM photos_photo p, json_each(p.ai_index_info, '$.objects') j "  # noqa: S608
                  f"WHERE j.value = %s AND p.id IN ({sql})", [object_id, *params])
        return [r[0] for r in c.fetchall()]


def with_objects(qs, ids):
    for object_id in ids:
        qs = qs.filter(id__in=_ids_with_object(qs, object_id))
    return qs


def object_counts(qs):
    counts = Counter()
    for info in qs.exclude(ai_index_info__isnull=True).values_list("ai_index_info", flat=True).iterator():
        counts.update(int(o) for o in set((info or {}).get("objects") or []))
    return counts


def browse_items(qs, category):
    if category == "objects":
        return sorted(({"display": object_label(i), "value": ",".join(ID_TO_NAMES.get(i, [])), "count": n}
                       for i, n in object_counts(qs).items() if i in ID_TO_NAMES), key=lambda x: -x["count"])
    if category == "cameras":
        rows = (qs.exclude(camera_model__isnull=True).exclude(camera_model="")
                .values("camera_make", "camera_model").annotate(count=Count("id")).order_by("-count"))
        out = []
        for r in rows:
            make, model = r["camera_make"], r["camera_model"]
            display = model if not make or model.lower().startswith(make.lower()) else f"{model} ({make})"
            out.append({"display": display, "value": model, "count": r["count"]})
        return out
    from .models import PLANE_ALTITUDE_M
    ground = qs.exclude(altitude__gte=PLANE_ALTITUDE_M)  # skip plane photos
    if category == "countries":
        rows = (ground.exclude(location_country__isnull=True).exclude(location_country="")
                .values("location_country").annotate(count=Count("id")).order_by("-count"))
        return [{"display": r["location_country"], "value": r["location_country"], "count": r["count"]} for r in rows]
    if category == "cities":
        rows = (ground.exclude(location_city__isnull=True).exclude(location_city="")
                .values("location_city", "location_country").annotate(count=Count("id")).order_by("-count"))
        return [{"display": f"{r['location_city']}, {r['location_country']}" if r["location_country"] else r["location_city"],
                 "value": r["location_city"], "country": r["location_country"], "count": r["count"]} for r in rows]
    raise ValueError(category)
