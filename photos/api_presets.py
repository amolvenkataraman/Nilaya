"""/api/v2/photos/locate/presets: the location-entry page's default spots, from settings.

They are personal coordinates, so they live in the deployment's settings, not in the code or the
public JS bundle. Both settings are optional lists (empty by default):

    PHOTOS_LOCATE_PRESETS = [{"label": "Home", "lat": 43.65, "lng": -79.38}, ...]   # one-click save
    PHOTOS_LOCATE_FOCUS = [{"label": "TOR", "lat": 43.65, "lng": -79.38, "zoom": 15}, ...]  # map focus
"""

import math
from typing import Optional

from django.conf import settings
from ninja import Router, Schema

router = Router(tags=["photos"])


class Spot(Schema):
    label: str
    lat: float
    lng: float
    zoom: Optional[int] = None


class PresetsOut(Schema):
    presets: list[Spot]
    focus: list[Spot]


def _spots(value, zoom=False):
    out = []
    for s in value or []:
        try:
            lat, lng = float(s["lat"]), float(s["lng"])
            label = str(s["label"])[:12]
        except (KeyError, TypeError, ValueError):
            continue  # a malformed entry in settings: skip it rather than fail the page
        if not (label and math.isfinite(lat) and math.isfinite(lng) and -90 <= lat <= 90 and -180 <= lng <= 180):
            continue
        z = s.get("zoom") if zoom else None
        out.append({"label": label, "lat": lat, "lng": lng,
                    "zoom": max(1, min(19, int(z))) if isinstance(z, (int, float)) else (17 if zoom else None)})
    return out[:30]


@router.get("/presets", response=PresetsOut, summary="Location entry: default presets and map focus spots (from settings)")
def locate_presets(request):
    return {"presets": _spots(getattr(settings, "PHOTOS_LOCATE_PRESETS", [])),
            "focus": _spots(getattr(settings, "PHOTOS_LOCATE_FOCUS", []), zoom=True)}
