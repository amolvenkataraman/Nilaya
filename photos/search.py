"""Smart photo search: free text ("dog toronto 2019", "pixel 7 paris june 2023") -> exact, indexed filters.

parse(q, vocab, now) reads the query left to right, longest phrase first (up to MAX_WORDS words), against:
- dates: years, "june 2023", "jun 5 2023", "5 june", ISO dates, ranges ("2018-2020", "2018 to 2020",
  "between 2018 and 2020"), decades ("2010s"), seasons ("summer 2019"), today/yesterday, this/last
  week/month/year, "last 3 months";
- media: video(s), photo(s)/picture(s), raw, screenshot(s);
- places: the cities and countries in the user's library (from the cached browse lists, plane photos left out),
  plus aliases (usa/america/"US" -> United States, uk/england -> United Kingdom, nyc, sf...);
- cameras: makes, models, model prefixes ("pixel 7", "iphone", "canon eos"), Galaxy names for Samsung codes;
- objects: the Objects365 classes the indexer detects, with plurals and synonyms (puppies -> dog, kids -> person,
  food, animals...);
- shared albums and libraries by name ("highlights", "phone library").
A phrase found in several vocabularies goes to the first of: place, camera, object, album, library
("orange" is a city if you have photos there, else the fruit). Words that match nothing get a fuzzy try
(typos, difflib ratio >= FUZZY_CUTOFF); the rest are reported as not understood, never dropped silently.
When nothing at all is understood, the words are looked up in file names and folders instead.

Semantics: OR within a type, AND across types: "dog cat 2019 2021" = (dog or cat) and (2019 or 2021).
Places are the exception that makes sense: a country next to one of its cities narrows it
("waterloo canada" = Waterloo in Canada, not all of Canada). Media words are attributes, so they AND
("raw photos"); "photos and videos" cancels out. A shared album or library term searches that album or
library (a library switched off in Sources included, since it was asked for by name).

query(base, terms, ...) turns the terms into filters: equality on city/country/camera, GIN containment for
objects on Postgres, date ranges on the (date_taken, id) index.
"""

import calendar
import datetime
import difflib
import re
import unicodedata
from dataclasses import dataclass, field

from django.db import connection
from django.db.models import Q
from django.db.models.expressions import RawSQL

MAX_WORDS = 4
MAX_NAME_WORDS = 8          # album/library names may be longer
FUZZY_CUTOFF = 0.84
FUZZY_MIN_LEN = 4

PRIORITY = ("place", "camera", "object", "album", "library")
KIND = {"place": "Place", "camera": "Camera", "object": "Object", "album": "Album", "library": "Library",
        "media": "Type", "date": "Date", "text": "File name"}

STOP = {
    "a", "an", "the", "in", "at", "of", "on", "from", "with", "and", "or", "my", "our", "me", "i", "we", "us",
    "by", "for", "to", "taken", "shot", "during", "near", "around", "between", "show", "find", "all", "any",
    "some", "when", "where", "was", "were", "is", "are", "that", "this", "these", "those", "using", "via",
    "trip", "into", "inside", "outside", "about",
}

MONTHS = {}
for _i, _name in enumerate(calendar.month_name):
    if _i:
        MONTHS[_name.lower()] = _i
        MONTHS[_name[:3].lower()] = _i
MONTHS["sept"] = 9
SEASONS = {"spring": (3, 4, 5), "summer": (6, 7, 8), "fall": (9, 10, 11), "autumn": (9, 10, 11), "winter": (12, 1, 2)}
RANGE_WORDS = {"to", "until", "till", "through", "thru"}
UNITS = {"day": "days", "days": "days", "week": "weeks", "weeks": "weeks", "month": "months", "months": "months",
         "year": "years", "years": "years"}

MEDIA = {}
for _w in ("video", "videos", "movie", "movies", "clip", "clips"):
    MEDIA[_w] = "video"
for _w in ("photo", "photos", "picture", "pictures", "pic", "pics", "image", "images", "photograph", "photographs", "still", "stills"):
    MEDIA[_w] = "photo"
for _w in ("raw", "raws", "dng"):
    MEDIA[_w] = "raw"
for _w in ("screenshot", "screenshots", "screen shot", "screen shots", "screengrab", "screengrabs"):
    MEDIA[_w] = "screenshot"
MEDIA_LABEL = {"video": "Videos", "photo": "Photos (no videos)", "raw": "Has RAW", "screenshot": "Screenshots"}

COUNTRY_ALIASES = {
    "United States": ["usa", "america", "united states of america", "the states"],
    "United Kingdom": ["uk", "britain", "great britain", "england", "scotland", "wales", "northern ireland"],
    "Korea, Republic of": ["south korea", "korea"],
    "Korea, Democratic People's Repub": ["north korea"],
    "Russian Federation": ["russia"],
    "Iran, Islamic Republic of": ["iran"],
    "Czech Republic": ["czechia"],
    "Vietnam": ["viet nam"],
    "Lao People's Democratic Republic": ["laos"],
    "Syrian Arab Republic": ["syria"],
    "Tanzania, United Republic of": ["tanzania"],
    "Moldova, Republic of": ["moldova"],
    "Holy See (Vatican City State)": ["vatican", "vatican city"],
    "Brunei Darussalam": ["brunei"],
    "Macedonia": ["north macedonia"],
    "Turkey": ["turkiye"],
    "Netherlands": ["holland", "the netherlands"],
    "United Arab Emirates": ["uae", "emirates"],
    "Palestinian Territory": ["palestine"],
    "Congo, The Democratic Republic o": ["drc", "dr congo"],
}
# City aliases apply only when the city is in the library (so "la" isn't Los Angeles for everyone).
CITY_ALIASES = {
    "New York City": ["nyc", "new york"], "San Francisco": ["sf"], "Los Angeles": ["la"],
    "Washington, D.C.": ["dc", "washington dc"], "Philadelphia": ["philly"], "Las Vegas": ["vegas"],
    "Mumbai": ["bombay"], "Kolkata": ["calcutta"], "Chennai": ["madras"], "Bengaluru": ["bangalore"],
    "Bangalore": ["bengaluru"], "Beijing": ["peking"], "Montreal": ["montréal"], "Kyiv": ["kiev"],
}
# Samsung reports model codes; people say "galaxy s22 ultra".
SAMSUNG_CODES = {
    "SM-G981": "Galaxy S20", "SM-G986": "Galaxy S20 Plus", "SM-G988": "Galaxy S20 Ultra",
    "SM-G991": "Galaxy S21", "SM-G996": "Galaxy S21 Plus", "SM-G998": "Galaxy S21 Ultra",
    "SM-S901": "Galaxy S22", "SM-S906": "Galaxy S22 Plus", "SM-S908": "Galaxy S22 Ultra",
    "SM-S911": "Galaxy S23", "SM-S916": "Galaxy S23 Plus", "SM-S918": "Galaxy S23 Ultra",
    "SM-S921": "Galaxy S24", "SM-S926": "Galaxy S24 Plus", "SM-S928": "Galaxy S24 Ultra",
    "SM-S931": "Galaxy S25", "SM-S936": "Galaxy S25 Plus", "SM-S938": "Galaxy S25 Ultra",
    "SM-F936": "Galaxy Z Fold4", "SM-F946": "Galaxy Z Fold5", "SM-F721": "Galaxy Z Flip4", "SM-F731": "Galaxy Z Flip5",
}
MAKE_ALIASES = {"galaxy": "samsung", "moto": "motorola", "iphone": "apple", "ipad": "apple"}

# Objects365 names -> extra words. Plurals are added automatically.
OBJECT_SYNONYMS = {
    "person": ["people", "persons", "man", "men", "woman", "women", "kid", "kids", "child", "children", "baby",
               "babies", "boy", "girl", "friends", "family", "selfie", "selfies", "portrait", "human", "humans"],
    "dog": ["puppy", "puppies", "pup", "doggy", "doggo"],
    "cat": ["kitten", "kittens", "kitty"],
    "cell_phone": ["phone", "smartphone", "mobile", "cellphone", "iphone"],
    "tv": ["television"],
    "bicycle": ["bike", "cycle"],
    "motorcycle": ["motorbike"],
    "airplane": ["plane", "aeroplane", "aircraft", "jet"],
    "couch": ["sofa"],
    "potted_plant": ["plant", "houseplant"],
    "stuffed_toy": ["toy", "teddy", "teddy bear", "plush"],
    "luggage": ["suitcase"],
    "skiboard": ["ski", "skis", "skiing"],
    "snowboard": ["snowboarding"],
    "surfboard": ["surfing"],
    "head_phone": ["headphones", "headphone"],
    "trash_bin_can": ["trash", "bin", "trash can", "garbage"],
    "other_fish": ["fish"],
    "hot-air_balloon": ["hot air balloon"],
    "glasses": ["sunglasses", "spectacles"],
}
OBJECT_GROUPS = {
    "bird": ["wild_bird", "pigeon", "duck", "goose", "swan", "penguin", "chicken"],
    "car": ["car", "suv", "sports_car"],
    "vehicle": ["car", "suv", "van", "bus", "truck", "pickup_truck", "heavy_truck", "sports_car", "motorcycle",
                "fire_truck", "ambulance", "machinery_vehicle"],
    "truck": ["truck", "pickup_truck", "heavy_truck", "fire_truck"],
    "boat": ["boat", "sailboat", "ship"],
    "table": ["dining_table", "coffee_table", "side_table", "desk"],
    "computer": ["laptop", "monitor", "computer_box", "keyboard"],
    "shoes": ["sneakers", "other_shoes", "leather_shoes", "boots", "sandals", "high_heels", "slippers"],
    "ball": ["other_balls", "soccer", "basketball", "baseball", "volleyball", "tennis", "golf_ball", "american_football"],
    "bag": ["handbag", "backpack", "luggage", "briefcase"],
    "food": ["bread", "cake", "dessert", "pizza", "hamburger", "hot_dog", "french_fries", "donut", "cookies", "pie",
             "sausage", "egg", "rice", "ice_cream", "candy"],
    "fruit": ["apple", "banana", "orange", "lemon", "strawberry", "grape", "pear", "peach", "watermelon", "mango",
              "pineapple", "tomato"],
    "vegetable": ["green_vegetables", "tomato", "broccoli", "carrot", "cucumber", "potato", "pumpkin", "onion", "cabbage",
                  "lettuce", "corn", "garlic", "pepper", "green_beans", "green_onion"],
    "veggies": ["green_vegetables", "broccoli", "carrot", "cucumber", "lettuce", "cabbage"],
    "animal": ["dog", "cat", "horse", "cow", "sheep", "elephant", "zebra", "giraffe", "deer", "wild_bird", "duck",
               "goose", "swan", "penguin", "pigeon", "chicken", "other_fish"],
    "pet": ["dog", "cat"],
    "lights": ["lamp", "street_lights", "lantern"],
}


def norm(s):
    """Lowercase, accents stripped, apostrophes and dots dropped, other punctuation -> spaces, collapsed."""
    s = unicodedata.normalize("NFKD", s)
    s = "".join(c for c in s if not unicodedata.combining(c)).lower()
    s = re.sub(r"['’.]", "", s)
    return " ".join(re.sub(r"[^0-9a-z]+", " ", s).split())


def plurals(word):
    """Simple English plurals of the last word of a phrase."""
    head, _, last = word.rpartition(" ")
    pre = head + " " if head else ""
    if last.endswith("s") or len(last) < 3:
        return []
    if last.endswith("y") and last[-2:-1] not in "aeiou":
        forms = [last[:-1] + "ies"]
    elif last.endswith(("sh", "ch", "x", "o")):
        forms = [last + "es", last + "s"]
    elif last.endswith("fe"):
        forms = [last[:-2] + "ves", last + "s"]
    else:
        forms = [last + "s"]
    return [pre + f for f in forms]


@dataclass
class Term:
    type: str
    value: str
    label: str
    span: tuple
    data: dict = field(default_factory=dict)
    typo: str = ""      # the words as typed, when matched fuzzily
    detail: str = ""    # tooltip (e.g. the camera models a prefix covers)

    def out(self):
        return {"type": self.type, "kind": KIND[self.type], "value": self.value, "label": self.label,
                "span": list(self.span), "typo": self.typo or None, "detail": self.detail or None}


# ---------------------------------------------------------------- vocabularies
# Entries: {phrase: {type: (payload, label)}}; payloads are merged sets so one phrase can mean several values.

def _add(entries, phrase, type_, key, values, label):
    if not phrase:
        return
    slot = entries.setdefault(phrase, {})
    payload, old = slot.get(type_, ({}, label))
    payload = {k: set(v) for k, v in payload.items()}
    payload.setdefault(key, set()).update(values)
    slot[type_] = (payload, old)


def _static_entries():
    from .AI.objects import NAME_TO_ID_MAPPING
    e = {}
    label = lambda n: n.replace("_", " ").replace("-", " ").capitalize()
    for name, idx in NAME_TO_ID_MAPPING.items():
        p = norm(name.replace("_", " "))
        for form in [p, *plurals(p)]:
            _add(e, form, "object", "ids", {idx}, label(name))
    for name, words in OBJECT_SYNONYMS.items():
        for w in words:
            for form in [norm(w), *plurals(norm(w))]:
                _add(e, form, "object", "ids", {NAME_TO_ID_MAPPING[name]}, label(name))
    for group, names in OBJECT_GROUPS.items():  # a group replaces a single class of the same name ("car")
        ids = {NAME_TO_ID_MAPPING[n] for n in names}
        for form in [group, *plurals(group)]:
            e.setdefault(form, {})["object"] = ({"ids": ids}, group.capitalize())
    for name, aliases in COUNTRY_ALIASES.items():
        for a in aliases:
            _add(e, norm(a), "place", "countries", {name}, name.split(",")[0])
    return e


STATIC = _static_entries()


def build_vocab(cities, countries, cameras):
    """The per-library vocabulary from the browse lists (cached by the caller).
    cities: [{"value", "country"}], countries: [{"value"}], cameras: [{"value": model, "make"}]."""
    e = {}
    city_countries = {}
    for c in countries:
        _add(e, norm(c["value"]), "place", "countries", {c["value"]}, c["value"])
    for c in cities:
        city, country = c["value"], c.get("country") or ""
        city_countries.setdefault(city, set()).add(country)
        p = norm(city)
        _add(e, p, "place", "cities", {city}, city)
        if p.endswith(" city") and len(p) > 8:  # "new york city" -> "new york", "quebec city" -> "quebec"
            _add(e, p[:-5], "place", "cities", {city}, city)
    for canonical, aliases in CITY_ALIASES.items():
        if canonical in city_countries:
            for a in aliases:
                _add(e, norm(a), "place", "cities", {canonical}, canonical)

    makes = {}
    prefixes = {}  # phrase -> (set of models, the original name it was cut from)
    for c in cameras:
        model, make = c["value"], c.get("make") or ""
        if make:
            makes.setdefault(norm(make), set()).add(make)
            first = norm(make).split(" ")[0]
            if len(first) >= 3:
                makes.setdefault(first, set()).add(make)
        names = [norm(model)]
        if make and names[0].startswith(norm(make) + " "):
            names.append(names[0][len(norm(make)) + 1:])  # "canon eos r5" -> "eos r5"
        code = next((n for k, n in SAMSUNG_CODES.items() if model.upper().startswith(k)), None)
        if code:
            names.append(norm(code))
        for n in names:
            _add(e, n, "camera", "models", {model}, code if code and n == norm(code) else model)
            words = n.split(" ")
            source = code if code and n == norm(code) else model
            for k in range(1, len(words)):
                pre = " ".join(words[:k])
                if not words[0].isdigit() and len(pre) >= 3:
                    prefixes.setdefault(pre, (set(), source))[0].add(model)
    for p, (models, source) in prefixes.items():
        if p in e and "camera" in e[p]:
            continue  # an exact model name wins over the models it prefixes ("pixel 7" vs "pixel 7 pro")
        _add(e, p, "camera", "models", models, _cut(source, p))
    for p, ms in makes.items():
        label = sorted(ms)[0]
        _add(e, p, "camera", "makes", ms, label.title() if label.islower() or label.isupper() else label)
    for alias, make in MAKE_ALIASES.items():
        if make in makes and alias not in e:
            _add(e, alias, "camera", "makes", makes[make], alias.capitalize() if alias != "iphone" else "iPhone")
    return {"entries": e, "city_countries": city_countries}


def _cut(name, phrase):
    """The start of a model name, as written, that reads as phrase: ("iPhone 13 Pro", "iphone") -> "iPhone"."""
    for pos in range(1, len(name) + 1):
        if (pos == len(name) or not name[pos].isalnum()) and norm(name[:pos]) == phrase:
            return name[:pos]
    return phrase.title()


def names_vocab(albums, libraries):
    """Shared albums and libraries the user can see: [(id, name)] each."""
    e = {}
    for i, name in albums:
        _add(e, norm(name), "album", "ids", {str(i)}, name)
    for i, name in libraries:
        _add(e, norm(name), "library", "ids", {i}, name)
    return e


# ---------------------------------------------------------------- dates

def _tz_dt(tz, y, m=1, d=1):
    return datetime.datetime(y, m, d, tzinfo=tz)


def _next_month(y, m):
    return (y + 1, 1) if m == 12 else (y, m + 1)


def _year(w, now):
    return int(w) if len(w) == 4 and w.isdigit() and 1900 <= int(w) <= now.year + 1 else None


def _day(w):
    m = re.fullmatch(r"(\d{1,2})(st|nd|rd|th)?", w)
    return int(m.group(1)) if m and 1 <= int(m.group(1)) <= 31 else None


def _range(start, end, value, label):
    return {"ranges": [(start, end)]}, value, label


def match_date(words, i, now, prev=""):
    """(payload, value, label, words used) for a date phrase starting at words[i], or None.
    payload: {"ranges": [(start, end)]} (indexed) or {"months": (..), "day": d} (any year)."""
    tz = now.tzinfo
    w = lambda k: words[i + k] if i + k < len(words) else ""
    w0 = w(0)

    iso = re.fullmatch(r"iso(\d{4})(\d{2})(\d{2})?", w0)
    if iso:
        y, m = int(iso.group(1)), int(iso.group(2))
        if 1 <= m <= 12:
            if iso.group(3):
                d = int(iso.group(3))
                try:
                    start = _tz_dt(tz, y, m, d)
                except ValueError:
                    return None
                return (*_range(start, start + datetime.timedelta(days=1), start.date().isoformat(),
                                start.strftime("%b %-d, %Y")), 1)
            ny, nm = _next_month(y, m)
            return (*_range(_tz_dt(tz, y, m), _tz_dt(tz, ny, nm), f"{y}-{m:02d}", f"{calendar.month_name[m]} {y}"), 1)

    dec = re.fullmatch(r"(\d{2}|\d{4})s", w0)
    if dec:
        y = int(dec.group(1))
        y = y if y >= 1000 else (1900 + y if y >= 30 else 2000 + y)
        if y % 10 == 0 and 1900 <= y <= now.year:
            return (*_range(_tz_dt(tz, y), _tz_dt(tz, y + 10), f"{y}s", f"{y}s"), 1)

    y0 = _year(w0, now)
    if y0:
        # Ranges: "2018 to 2020", "2018-2020" (normalised to "2018 to 2020"), "between 2018 and 2020".
        y2 = _year(w(2), now)
        if y2 and (w(1) in RANGE_WORDS or (w(1) == "and" and prev == "between")):
            a, b = sorted((y0, y2))
            return (*_range(_tz_dt(tz, a), _tz_dt(tz, b + 1), f"{a}..{b}", f"{a}–{b}"), 3)
        if w(1) in MONTHS:  # "2023 june"
            m = MONTHS[w(1)]
            ny, nm = _next_month(y0, m)
            return (*_range(_tz_dt(tz, y0, m), _tz_dt(tz, ny, nm), f"{y0}-{m:02d}", f"{calendar.month_name[m]} {y0}"), 2)
        if w(1) in SEASONS:
            return (*_season(tz, w(1), y0), 2)
        return (*_range(_tz_dt(tz, y0), _tz_dt(tz, y0 + 1), str(y0), str(y0)), 1)

    # "june 5 2023", "june 5", "june 2023", "june"; "5 june 2023", "5 june".
    m, d, used = None, None, 0
    if w0 in MONTHS:
        m, used = MONTHS[w0], 1
        if _day(w(1)) and not _year(w(1), now):
            d, used = _day(w(1)), 2
    elif _day(w0) and w(1) in MONTHS:
        d, m, used = _day(w0), MONTHS[w(1)], 2
    if m:
        y = _year(w(used), now)
        name = calendar.month_name[m]
        if y:
            used += 1
            if d:
                try:
                    start = _tz_dt(tz, y, m, d)
                except ValueError:
                    return None
                return (*_range(start, start + datetime.timedelta(days=1), start.date().isoformat(),
                                start.strftime("%b %-d, %Y")), used)
            ny, nm = _next_month(y, m)
            return (*_range(_tz_dt(tz, y, m), _tz_dt(tz, ny, nm), f"{y}-{m:02d}", f"{name} {y}"), used)
        if d:
            return {"months": (m,), "day": d}, f"--{m:02d}-{d:02d}", f"{name} {d} (any year)", used
        return {"months": (m,)}, f"--{m:02d}", f"{name} (any year)", used

    if w0 in SEASONS:
        y = _year(w(1), now)
        if y:
            return (*_season(tz, w0, y), 2)
        return {"months": SEASONS[w0]}, w0, f"{w0.capitalize()} (any year)", 1

    today = now.replace(hour=0, minute=0, second=0, microsecond=0)
    if w0 == "today":
        return (*_range(today, today + datetime.timedelta(days=1), "today", "Today"), 1)
    if w0 == "yesterday":
        return (*_range(today - datetime.timedelta(days=1), today, "yesterday", "Yesterday"), 1)
    if w0 in ("this", "last", "past"):
        unit = w(1)
        if w0 != "past" and unit in ("week", "month", "year"):
            if unit == "week":
                start = today - datetime.timedelta(days=today.weekday())
                start, end = (start, start + datetime.timedelta(days=7)) if w0 == "this" else (start - datetime.timedelta(days=7), start)
                label = f"{w0.capitalize()} week"
            elif unit == "month":
                y, mo = today.year, today.month
                if w0 == "last":
                    y, mo = (y - 1, 12) if mo == 1 else (y, mo - 1)
                ny, nm = _next_month(y, mo)
                start, end = _tz_dt(tz, y, mo), _tz_dt(tz, ny, nm)
                label = f"{w0.capitalize()} month ({calendar.month_name[mo]} {y})"
            else:
                y = today.year - (w0 == "last")
                start, end = _tz_dt(tz, y), _tz_dt(tz, y + 1)
                label = f"{w0.capitalize()} year ({y})"
            return (*_range(start, end, f"{w0}-{unit}", label), 2)
        if unit in SEASONS:  # "this summer": this year's; "last summer": the most recent one that has ended
            for y in range(today.year, today.year - 3, -1):
                payload, value, label = _season(tz, unit, y)
                start, end = payload["ranges"][0]
                if (start <= today if w0 == "this" else end <= today):
                    return payload, value, label, 2
        n = int(unit) if unit.isdigit() and 0 < int(unit) <= 100 else None
        if n and w(2) in UNITS:
            u = UNITS[w(2)]
            days = {"days": 1, "weeks": 7, "months": 30.44, "years": 365.25}[u] * n
            start = today - datetime.timedelta(days=round(days))
            return (*_range(start, today + datetime.timedelta(days=1), f"last-{n}-{u}", f"Last {n} {u if n > 1 else u[:-1]}"), 3)
    return None


def _season(tz, season, y):
    months = SEASONS[season]
    start = _tz_dt(tz, y, months[0])
    ey, em = (y + 1, 3) if season == "winter" else _next_month(y, months[-1])
    label = f"{season.capitalize()} {y}" + (f"–{str(y + 1)[2:]}" if season == "winter" else "")
    return {"ranges": [(start, _tz_dt(tz, ey, em))]}, f"{season}-{y}", label


# ---------------------------------------------------------------- parsing

def tokenize(q):
    """[(normalised word, index of the original whitespace token)]; spans refer to q.split()."""
    out = []
    for idx, tok in enumerate(q.split()):
        t = re.sub(r"\b(\d{4})\s*[-–/]\s*(\d{4})\b", r"\1 to \2", tok)  # 2018-2020
        t = re.sub(r"\b(\d{4})-(\d{2})(?:-(\d{2}))?\b", lambda m: "iso" + "".join(g or "" for g in m.groups()), t)
        for w in norm(t).split(" "):
            if w:
                out.append((w, idx))
        if tok.strip(".,;:!?()") in ("US", "U.S.", "U.S.A.", "U.S", "USA") and out and out[-1][1] == idx:
            out[-1] = ("usa", idx)  # "US" in capitals is the country; "us" is a pronoun
    return out


def _lookup(layers, phrase, only=None):
    found = {}
    for layer in layers:
        for t, (payload, label) in layer.get(phrase, {}).items():
            if only and t != only:
                continue
            if t in found:
                merged = {k: set(v) for k, v in found[t][0].items()}
                for k, v in payload.items():
                    merged.setdefault(k, set()).update(v)
                found[t] = (merged, found[t][1])
            else:
                found[t] = (payload, label)
    for t in PRIORITY:
        if t in found:
            return t, found[t]
    return None


def parse(q, vocab, now, names=None, fallback=True):
    """-> (terms, unmatched original words). vocab: build_vocab() output; names: names_vocab() output."""
    words = tokenize(q[:200])
    raw = q.split()
    layers = [vocab["entries"], STATIC, names or {}]
    longest = MAX_NAME_WORDS if names else MAX_WORDS
    plain = [w for w, _ in words]
    terms, unmatched = [], []
    i = 0

    def span(a, b):
        return (words[a][1], words[b - 1][1] + 1)

    while i < len(words):
        w = plain[i]
        d = match_date(plain, i, now, plain[i - 1] if i else "")
        if d:
            payload, value, label, used = d
            terms.append(Term("date", value, label, span(i, i + used), payload))
            i += used
            continue
        two = " ".join(plain[i:i + 2]) if i + 1 < len(plain) else ""
        if two in MEDIA or w in MEDIA:
            n = 2 if two in MEDIA else 1
            terms.append(Term("media", MEDIA[two if n == 2 else w], MEDIA_LABEL[MEDIA[two if n == 2 else w]], span(i, i + n)))
            i += n
            continue
        # "album <name>", "<name> library": force that type.
        forced = w if w in ("album", "library") else None
        start = i + 1 if forced else i
        hit = None
        for n in range(min(longest, len(words) - start), 0, -1):
            found = _lookup(layers, " ".join(plain[start:start + n]), forced)
            if found:
                hit = (found, n)
                break
        if hit:
            (t, (payload, label)), n = hit
            end = start + n
            nxt = plain[end] if end < len(plain) else ""
            if not forced and nxt in ("album", "library"):
                alt = _lookup(layers, " ".join(plain[start:end]), nxt)
                if alt:
                    t, (payload, label) = alt
                    end += 1
            terms.append(_term(t, payload, label, span(i, end)))
            i = end
            continue
        if w in STOP or forced:
            i += 1
            continue
        unmatched.append(i)
        i += 1

    # Typos: fuzzy-match runs of unmatched words (longest first), against every name vocabulary.
    still = []
    if unmatched:
        keys = {}
        for layer in layers:
            for k in layer:
                if len(k) >= FUZZY_MIN_LEN and not k.isdigit():
                    keys.setdefault(len(k), []).append(k)
        j = 0
        while j < len(unmatched):
            run = [unmatched[j]]
            while j + len(run) < len(unmatched) and unmatched[j + len(run)] == run[-1] + 1:
                run.append(unmatched[j + len(run)])
            k = 0
            while k < len(run):
                done = False
                for n in range(min(3, len(run) - k), 0, -1):
                    idxs = run[k:k + n]
                    phrase = " ".join(plain[x] for x in idxs)
                    if len(phrase) < FUZZY_MIN_LEN or phrase.isdigit():
                        continue
                    # ratio >= cutoff needs similar lengths: 2 * shorter / (a + b) >= cutoff
                    lo, hi = len(phrase) * FUZZY_CUTOFF / (2 - FUZZY_CUTOFF), len(phrase) * (2 - FUZZY_CUTOFF) / FUZZY_CUTOFF
                    cands = [c for n_ in range(int(lo), int(hi) + 1) for c in keys.get(n_, ())]
                    # Swapped neighbours ("pairs" for "paris") score low on ratio: try them exactly first.
                    best = [v for v in (phrase[:p] + phrase[p + 1] + phrase[p] + phrase[p + 2:] for p in range(len(phrase) - 1))
                            if _lookup(layers, v)][:1] or difflib.get_close_matches(phrase, cands, n=1, cutoff=FUZZY_CUTOFF)
                    if best:
                        t, (payload, label) = _lookup(layers, best[0])
                        term = _term(t, payload, label, span(idxs[0], idxs[-1] + 1))
                        term.typo = " ".join(raw[term.span[0]:term.span[1]])
                        terms.append(term)
                        k += n
                        done = True
                        break
                if not done:
                    still.append(run[k])
                    k += 1
            j += len(run)

    # Dedupe (same type and value), keep query order.
    seen, out = set(), []
    for t in sorted(terms, key=lambda t: t.span):
        if (t.type, t.value) not in seen:
            seen.add((t.type, t.value))
            out.append(t)
    words_left = []
    for x in still:
        word = raw[words[x][1]]
        if word not in words_left:
            words_left.append(word)
    if fallback and not out and still:
        # Nothing understood: look the words up in file names and folders ("IMG_2041", "wedding").
        toks = sorted({words[x][1] for x in still})
        out = [Term("text", raw[k].strip("\"'.,;:!?()").lower(), raw[k].strip("\"'.,;:!?()"), (k, k + 1)) for k in toks
               if len(raw[k].strip("\"'.,;:!?()")) >= 2]
        words_left = [w for w in words_left if len(w.strip("\"'.,;:!?()")) < 2]
    return out, words_left


def _term(t, payload, label, span):
    if t == "camera":
        models = sorted(payload.get("models", ()))
        makes = sorted(payload.get("makes", ()))
        detail = ", ".join(models) if len(models) > 1 else ""
        value = "|".join(makes + models)
        return Term(t, value, label, span, payload, detail=detail)
    if t == "place":
        vals = sorted(payload.get("cities", ())) + sorted(payload.get("countries", ()))
        return Term(t, "|".join(vals), label, span, payload)
    if t == "object":
        return Term(t, label.lower(), label, span, payload)
    return Term(t, "|".join(sorted(str(v) for v in payload["ids"])), label, span, payload)


# ---------------------------------------------------------------- querying

def objects_q(ids):
    """Photos containing any of the objects. Postgres: ai_index_info @> {"objects": [id]} uses the GIN index."""
    ids = sorted(ids)
    if not ids:
        return Q(pk__in=[])
    if connection.vendor == "postgresql":
        q = Q()
        for i in ids:
            q |= Q(ai_index_info__contains={"objects": [i]})
        return q
    marks = ",".join(["%s"] * len(ids))
    return Q(id__in=RawSQL(f"SELECT p.id FROM photos_photo p, json_each(p.ai_index_info, '$.objects') j "  # noqa: S608
                           f"WHERE j.value IN ({marks})", ids))


def filters(terms, city_countries):
    """Q for every understood term except albums/libraries (those pick the base queryset)."""
    from .models import PLANE_ALTITUDE_M
    by = {}
    for t in terms:
        by.setdefault(t.type, []).append(t)
    q = Q()
    places = by.get("place", [])
    if places:
        # A country next to one of its cities narrows that city rather than adding the whole country.
        qualifiers = {}
        used = set()
        for t in places:
            for c in t.data.get("cities", ()):
                for o in places:
                    if o is t:
                        continue
                    ks = {k for k in o.data.get("countries", ()) if k in city_countries.get(c, ())}
                    if ks:
                        qualifiers.setdefault(c, set()).update(ks)
                        used.add(id(o))
        pq = Q()
        for t in places:
            for c in t.data.get("cities", ()):
                pq |= Q(location_city=c, location_country__in=sorted(qualifiers[c])) if c in qualifiers else Q(location_city=c)
            if id(t) not in used:
                for k in t.data.get("countries", ()):
                    pq |= Q(location_country=k)
        q &= pq & ~Q(altitude__gte=PLANE_ALTITUDE_M)  # a flyover isn't a visit (like the Places lists)
    if by.get("object"):
        q &= objects_q(set().union(*(t.data["ids"] for t in by["object"])))
    if by.get("camera"):
        cq = Q()
        makes = set().union(*(t.data.get("makes", set()) for t in by["camera"]))
        models = set().union(*(t.data.get("models", set()) for t in by["camera"]))
        if makes:
            cq |= Q(camera_make__in=sorted(makes))
        if models:
            cq |= Q(camera_model__in=sorted(models))
        q &= cq
    if by.get("date"):
        dq = Q()
        for t in by["date"]:
            for a, b in t.data.get("ranges", ()):
                dq |= Q(date_taken__gte=a, date_taken__lt=b)
            if "months" in t.data:
                dq |= Q(date_taken__month__in=t.data["months"], **({"date_taken__day": t.data["day"]} if "day" in t.data else {}))
        q &= dq
    media = {t.value for t in by.get("media", [])}
    if {"video", "photo"} <= media:
        media -= {"video", "photo"}
    if "video" in media:
        q &= Q(video=True)
    if "photo" in media:
        q &= Q(video=False)
    if "raw" in media:
        q &= Q(raw_filepath__isnull=False) & ~Q(raw_filepath="")
    if "screenshot" in media:
        q &= Q(filepath__icontains="screenshot") | Q(filepath__iendswith=".png")
    for t in by.get("text", []):
        q &= Q(filepath__icontains=t.value)
    return q
