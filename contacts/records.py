"""Import records: plain dicts with Person's field names, built leniently from untrusted files.

Every importer (vCard, Google/Outlook/LinkedIn/generic CSV) fills records through these helpers,
so labels, dates, URLs and profiles are cleaned the same way. Values are always text; anything
that doesn't validate is dropped (or kept as a custom field) rather than failing the import.
"""

import datetime
import re

from . import profiles

TEXT_MAX = 200
NOTES_MAX = 20000
LIST_MAX = 20
CUSTOM_MAX = 50  # custom fields per contact (imports bring many: Google's Custom Field n, IM n, Relation n)

EMAIL_RE = re.compile(r"^[^@\s<>\"',;]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$")
PHONE_RE = re.compile(r"^[0-9+()#*.,;/ xext\-]{3,40}$", re.I)

LABELS = {"cell": "mobile", "mobile": "mobile", "iphone": "mobile", "cellular": "mobile", "home": "home",
          "work": "work", "business": "work", "office": "work", "fax": "fax", "pager": "pager", "main": "main",
          "other": "other", "school": "school", "personal": "home", "internet": "", "voice": "", "pref": "",
          "text": "", "msg": "", "x400": "", "dom": "", "intl": "", "postal": "", "parcel": ""}


class ImportFailed(ValueError):
    """A file that can't be imported (too big, too many contacts, not a contacts file)."""


def new():
    return {"emails": [], "phones": [], "addresses": [], "profiles": {}, "links": [], "custom_fields": [],
            "tags": [], "groups": []}


def text(v, limit=TEXT_MAX):
    v = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", "", str(v or "")).replace("\r\n", "\n").replace("\r", "\n")
    return v.strip()[:limit]


def split(v, *seps):
    """Split on any of the literal separators and strip the parts. (A regex like \\s*:::\\s* backtracks
    over every run of spaces, which made imports quadratic in the cell size.)"""
    parts = re.split("|".join(re.escape(s) for s in seps), str(v or "")) if seps else [str(v or "")]
    return [p.strip() for p in parts]


def label(raw):
    """vCard TYPEs / CSV labels -> a short lowercase label ('mobile', 'work', ...)."""
    raw = text(raw, 40)
    m = re.match(r"^_\$!<(.+)>!\$_$", raw)  # Apple's built-in labels
    if m:
        raw = m.group(1)
    for part in re.split(r"[,;\s]+", raw.lower()):
        if part.startswith("*"):
            part = part[1:]
        if part in LABELS:
            if LABELS[part]:
                return LABELS[part]
        elif part:
            return raw.lower().lstrip("*").strip()[:40]
    return ""


def clean_email(v):
    v = text(v, 254).strip("<>").strip()
    if v.lower().startswith("mailto:"):
        v = v[7:]
    return v if EMAIL_RE.match(v) else ""


def clean_phone(v):
    v = text(v, 60)
    if v.lower().startswith("tel:"):
        v = v[4:]
    v = re.sub(r"\s+", " ", v).strip()
    return v if PHONE_RE.match(v) and sum(c.isdigit() for c in v) >= 3 else ""


def phone_key(v):
    digits = "".join(c for c in v if c.isdigit())
    return digits[-10:] if len(digits) >= 7 else ""


def _add(lst, item, key):
    if len(lst) >= LIST_MAX:
        return
    k = item[key].lower()
    if any(x[key].lower() == k for x in lst):
        return
    lst.append(item)


def add_email(rec, value, lbl=""):
    for part in split(value, ":::"):  # Google packs several values into one cell
        v = clean_email(part)
        if v:
            _add(rec["emails"], {"label": label(lbl), "value": v}, "value")


def add_phone(rec, value, lbl=""):
    for part in split(value, ":::"):
        v = clean_phone(part)
        if v and not any(phone_key(p["value"]) == phone_key(v) and phone_key(v) for p in rec["phones"]):
            _add(rec["phones"], {"label": label(lbl), "value": v}, "value")


def add_address(rec, lbl="", street="", city="", region="", postcode="", country=""):
    a = {"label": label(lbl), "street": text(street, 300), "city": text(city), "region": text(region),
         "postcode": text(postcode, 32), "country": text(country)}
    if any(v for k, v in a.items() if k != "label") and len(rec["addresses"]) < LIST_MAX:
        rec["addresses"].append(a)


def add_tags(rec, values, kind="tags"):
    for v in values:
        v = text(v, 64).lstrip("*").strip()
        if v and v.lower() not in ("mycontacts", "starred") and v not in rec[kind] and len(rec[kind]) < 50:
            rec[kind].append(v)


def add_profile(rec, network, raw):
    try:
        h = profiles.normalize(network, raw)
    except ValueError:
        return False
    rec["profiles"].setdefault(network, h)
    return True


def add_custom(rec, key, value):
    key, value = text(key, 64), text(value, 1000)
    if key and value and len(rec["custom_fields"]) < CUSTOM_MAX:
        rec["custom_fields"].append({"key": key, "value": value})


def add_url(rec, url, lbl=""):
    """A URL becomes a profile when we recognise the site (or the label names one), else a link.
    The first plain/homepage URL fills the Website field."""
    try:
        net, value = profiles.classify_url(text(url, 500), lbl)
    except ValueError:
        return
    if net:
        rec["profiles"].setdefault(net, value)
        return
    lb = text(lbl, 40).lower()
    if "website" not in rec["profiles"] and lb in ("", "home", "homepage", "home page", "website", "web", "profile",
                                                 "work", "personal", "other", "url"):
        rec["profiles"]["website"] = value
    elif len(rec["links"]) < LIST_MAX and not any(x["url"] == value for x in rec["links"]):
        rec["links"].append({"label": text(lbl, 40).title() or "Website", "url": value})


def parse_date(v):
    """'1985-01-15', '19850115', '--0115', '--01-15', '1/15/1985', '15 Jan 1985', '2026-11-04T..' ->
    (year|None, month, day) or None. Apple's 1604 placeholder year means 'no year'."""
    v = text(v, 40)
    if not v:
        return None
    v = v.split("T")[0].strip()
    m = (re.fullmatch(r"(\d{4})-?(\d{2})-?(\d{2})", v) or re.fullmatch(r"(-)-(\d{2})-?(\d{2})", v))
    if m:
        y, mo, d = (None if m.group(1) == "-" else int(m.group(1))), int(m.group(2)), int(m.group(3))
    else:
        m = re.fullmatch(r"(\d{1,2})/(\d{1,2})/(\d{2,4})", v)
        if m:
            mo, d, y = int(m.group(1)), int(m.group(2)), int(m.group(3))
            if y < 100:
                y += 1900 if y > 30 else 2000
        else:
            for fmt in ("%d %b %Y", "%d %B %Y", "%b %d, %Y", "%B %d, %Y", "%Y/%m/%d", "%d.%m.%Y"):
                try:
                    dt = datetime.datetime.strptime(v, fmt)
                except ValueError:
                    continue
                y, mo, d = dt.year, dt.month, dt.day
                break
            else:
                return None
    if y in (1604, 0) or (y is not None and y < 1000):
        y = None
    try:
        datetime.date(y or 2000, mo, d)
    except ValueError:
        return None
    if y and y > datetime.date.today().year + 1:
        return None
    return y, mo, d


def fmt_date(parts):
    if not parts:
        return ""
    y, m, d = parts
    return f"{y:04d}-{m:02d}-{d:02d}" if y else f"--{m:02d}-{d:02d}"


def split_name(rec, full):
    """'Ada King Lovelace' -> first 'Ada', middle 'King', last 'Lovelace' (only fills blanks)."""
    parts = text(full).split()
    if not parts or rec.get("first_name") or rec.get("last_name"):
        return
    rec["first_name"] = parts[0]
    if len(parts) > 1:
        rec["last_name"] = parts[-1]
    if len(parts) > 2:
        rec["middle_name"] = " ".join(parts[1:-1])


def finish(rec):
    """Drop empty values; return None for a record with nothing to identify the person."""
    out = {k: v for k, v in rec.items() if v not in ("", None, [], {})}
    named = any(out.get(k) for k in ("first_name", "last_name", "display_name", "nickname", "company"))
    if not (named or out.get("emails") or out.get("phones") or out.get("profiles")):
        return None
    for k in ("emails", "phones", "addresses", "profiles", "links", "custom_fields", "tags", "groups"):
        out.setdefault(k, {} if k == "profiles" else [])
    return out
