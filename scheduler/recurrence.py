"""Time zones and RFC 5545 recurrence for calendar events.

- Zones are stdlib ``zoneinfo`` (never pytz): dateutil builds occurrences with
  ``replace()``/``combine()``, which keeps the wall-clock time and lets zoneinfo
  pick the right offset on each side of a DST change.
- A recurring event is one row with ``rrule`` (+ ``exdates``/``rdates``); changed or
  cancelled single occurrences are override rows (``recurrence_parent`` +
  ``original_start``). Nothing is stored per occurrence: series are expanded at
  query time, only inside the requested range.
- Occurrence keys are the original start in UTC, ``YYYY-MM-DDTHH:MM:SSZ``; an
  occurrence id is ``<series uuid>:<key>``.
"""

import datetime as dt
from functools import lru_cache
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from dateutil.rrule import rrulestr
from django.conf import settings

UTC = dt.timezone.utc
ALLOWED_FREQ = ("DAILY", "WEEKLY", "MONTHLY", "YEARLY")
MAX_COUNT = 5000          # COUNT=… limit (also the scan cap for the last occurrence)
MAX_PER_SERIES = 1000     # occurrences returned per series per query


@lru_cache(maxsize=128)
def zone(name=None):
    """ZoneInfo for an IANA name; blank/unknown → settings.TIME_ZONE."""
    try:
        return ZoneInfo(name or settings.TIME_ZONE)
    except (ZoneInfoNotFoundError, ValueError, TypeError):
        return ZoneInfo(settings.TIME_ZONE)


def valid_zone(name):
    try:
        ZoneInfo(name)
        return True
    except (ZoneInfoNotFoundError, ValueError, TypeError):
        return False


def local_midnight(day, tz):
    """Aware UTC datetime of 00:00 local time on ``day``."""
    return dt.datetime.combine(day, dt.time(), tzinfo=tz).astimezone(UTC)


def key(moment):
    return moment.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_moment(value, tz=None):
    """ISO date-time (or a date = local midnight in tz) → aware UTC datetime."""
    if isinstance(value, dt.datetime):
        d = value
    elif isinstance(value, dt.date):
        return local_midnight(value, tz or zone())
    else:
        s = str(value).strip()
        if len(s) == 10:
            return local_midnight(dt.date.fromisoformat(s), tz or zone())
        d = dt.datetime.fromisoformat(s.replace("Z", "+00:00"))
    if d.tzinfo is None:
        d = d.replace(tzinfo=tz or UTC)
    return d.astimezone(UTC).replace(microsecond=0)


def normalize_keys(values, tz=None):
    """A list of ISO strings → sorted unique occurrence keys (raises ValueError on junk)."""
    return sorted({key(parse_moment(v, tz)) for v in (values or [])})


def parts(rule):
    out = {}
    for p in (rule or "").split(";"):
        if p:
            k, _, v = p.partition("=")
            out[k.strip().upper()] = v.strip().upper()
    return out


def normalize_rrule(text, tz):
    """Validate an RRULE and return it canonical ("" = not recurring).

    FREQ is limited to DAILY…YEARLY; a floating or date-only UNTIL is read in ``tz``
    and rewritten as UTC (RFC 5545 requires UTC when DTSTART has a zone)."""
    text = (text or "").strip()
    if text.upper().startswith("RRULE:"):
        text = text[6:]
    if not text:
        return ""
    p = {}
    for piece in text.split(";"):
        if not piece.strip():
            continue
        k, sep, v = piece.partition("=")
        if not sep or not k.strip() or not v.strip():
            raise ValueError(f"Malformed RRULE part: {piece!r}")
        p[k.strip().upper()] = v.strip().upper()
    if p.get("FREQ") not in ALLOWED_FREQ:
        raise ValueError("FREQ must be DAILY, WEEKLY, MONTHLY or YEARLY")
    if "UNTIL" in p and "COUNT" in p:
        raise ValueError("Use UNTIL or COUNT, not both")
    if "COUNT" in p and not (p["COUNT"].isdigit() and 1 <= int(p["COUNT"]) <= MAX_COUNT):
        raise ValueError(f"COUNT must be 1–{MAX_COUNT}")
    if "INTERVAL" in p and not (p["INTERVAL"].isdigit() and 1 <= int(p["INTERVAL"]) <= 1000):
        raise ValueError("INTERVAL must be 1–1000")
    if "UNTIL" in p and not p["UNTIL"].endswith("Z"):
        u = p["UNTIL"]
        try:
            local = (dt.datetime.strptime(u, "%Y%m%dT%H%M%S") if "T" in u
                     else dt.datetime.combine(dt.datetime.strptime(u, "%Y%m%d").date(), dt.time(23, 59, 59)))
        except ValueError:
            raise ValueError("UNTIL must look like 20261231 or 20261231T235959Z")
        p["UNTIL"] = local.replace(tzinfo=tz).astimezone(UTC).strftime("%Y%m%dT%H%M%SZ")
    out = ";".join([f"FREQ={p.pop('FREQ')}"] + [f"{k}={v}" for k, v in p.items()])
    try:
        rrulestr(out, dtstart=dt.datetime(2000, 1, 3, 9, tzinfo=tz))
    except (ValueError, TypeError) as ex:
        raise ValueError(f"Invalid RRULE: {ex}")
    return out


def until_rule(rule, before):
    """The rule ended just before ``before`` (UTC aware): COUNT dropped, UNTIL set."""
    p = parts(rule)
    p.pop("COUNT", None)
    p["UNTIL"] = (before.astimezone(UTC) - dt.timedelta(seconds=1)).strftime("%Y%m%dT%H%M%SZ")
    return ";".join([f"FREQ={p.pop('FREQ')}"] + [f"{k}={v}" for k, v in p.items()])


# ---------------------------------------------------------------- expansion

def _dtstart(ev, tz):
    if ev.kind == "all_day" and ev.start_date:
        return dt.datetime.combine(ev.start_date, dt.time(), tzinfo=tz)
    return ev.startdate.astimezone(tz)


def _rule(ev, tz):
    return rrulestr(ev.rrule, dtstart=_dtstart(ev, tz))


def duration(ev):
    """(timedelta or None, days or None): a timed length, or an all-day length in days."""
    if ev.kind == "all_day" and ev.start_date and ev.end_date:
        return None, max(1, (ev.end_date - ev.start_date).days)
    if ev.enddate is None:
        return None, None
    return ev.enddate - ev.startdate, None


def recurrence_end(ev, tz):
    """End (UTC) of the last occurrence, or None for a series without an end."""
    if not ev.rrule:
        return None
    p = parts(ev.rrule)
    rule = _rule(ev, tz)
    last = None
    if "UNTIL" in p or "COUNT" in p:
        for i, d in enumerate(rule):
            last = d
            if i >= MAX_COUNT:
                break
        if last is None:
            last = _dtstart(ev, tz)
    else:
        return None
    for r in ev.rdates or []:
        last = max(last, parse_moment(r))
    td, days = duration(ev)
    if days:
        return local_midnight(last.astimezone(tz).date() + dt.timedelta(days=days), tz)
    return (last + td if td else last).astimezone(UTC)


def starts_between(ev, tz, after, before):
    """Local aware occurrence starts in [after, before] (rule + rdates, before exdates)."""
    base = _dtstart(ev, tz)
    rule = rrulestr(ev.rrule, dtstart=base)
    p = parts(ev.rrule)
    after_l, before_l = after.astimezone(tz), before.astimezone(tz)
    # Fast-forward simple DAILY/WEEKLY rules close to the range: shifting DTSTART by whole
    # periods keeps the same lattice of occurrences (COUNT counts from the real start).
    if "COUNT" not in p and "BYSETPOS" not in p and p["FREQ"] in ("DAILY", "WEEKLY"):
        step = int(p.get("INTERVAL", 1)) * (1 if p["FREQ"] == "DAILY" else 7)
        k = (after_l.date() - base.date()).days // step - 1
        if k > 0:
            rule = rule.replace(dtstart=base + dt.timedelta(days=k * step))
    out = []
    for d in rule.xafter(after_l, inc=True):
        if d > before_l or len(out) >= MAX_PER_SERIES:
            break
        out.append(d)
    for r in ev.rdates or []:
        d = parse_moment(r).astimezone(tz)
        if after_l <= d <= before_l:
            out.append(d)
    return sorted(set(out))


def occurrence(ev, start_local, tz):
    """A copy of the series row moved to one occurrence (read-only, not saved)."""
    from .models import Event  # noqa: avoid a cycle at import time

    o = Event.__new__(Event)
    o.__dict__.update(ev.__dict__)
    td, days = duration(ev)
    if days:
        day = start_local.date()
        o.start_date, o.end_date = day, day + dt.timedelta(days=days)
        o.startdate, o.enddate = local_midnight(day, tz), local_midnight(o.end_date, tz)
    else:
        o.startdate = start_local.astimezone(UTC)
        o.enddate = (start_local + td).astimezone(UTC) if td is not None else None  # wall-clock length
    k = key(o.startdate)
    o.original_start = o.startdate
    o.series_id, o.override_id, o.occurrence_id, o.is_occurrence = ev.id, None, f"{ev.id}:{k}", True
    return o


def expand(ev, start, end, tz, skip=()):
    """Occurrences of a series overlapping [start, end), minus exdates and ``skip`` keys."""
    td, days = duration(ev)
    span = dt.timedelta(days=days) if days else (td or dt.timedelta())
    excluded = set(ev.exdates or []) | set(skip)
    out = []
    for s in starts_between(ev, tz, start - span - dt.timedelta(hours=26 if days else 0), end):
        o = occurrence(ev, s, tz)
        if key(o.original_start) in excluded:
            continue
        if o.startdate < end and ((o.enddate is not None and o.enddate > start)
                                  or (o.enddate is None and o.startdate >= start)):
            out.append(o)
    return out


def occurrence_at(ev, original, tz):
    """The occurrence of a series that starts at ``original`` (UTC aware), or None."""
    for s in starts_between(ev, tz, original - dt.timedelta(seconds=1), original + dt.timedelta(seconds=1)):
        o = occurrence(ev, s, tz)
        if o.startdate == original:
            return o
    return None


_DAYS = {"MO": "Mon", "TU": "Tue", "WE": "Wed", "TH": "Thu", "FR": "Fri", "SA": "Sat", "SU": "Sun"}
_UNITS = {"DAILY": "day", "WEEKLY": "week", "MONTHLY": "month", "YEARLY": "year"}
_ORD = {1: "first", 2: "second", 3: "third", 4: "fourth", 5: "fifth", -1: "last"}


def describe(rule, tz=None):
    """A short English summary of an RRULE ("Every 2 weeks on Mon, Wed until Dec 31, 2026")."""
    if not rule:
        return ""
    p = parts(rule)
    unit = _UNITS.get(p.get("FREQ"), "time")
    n = int(p.get("INTERVAL", "1") or 1)
    text = f"Every {unit}" if n == 1 else f"Every {n} {unit}s"
    if p.get("FREQ") == "DAILY" and p.get("BYDAY") in ("MO,TU,WE,TH,FR",):
        text = "Every weekday"
    elif "BYDAY" in p:
        days = []
        for d in p["BYDAY"].split(","):
            num, code = d[:-2], d[-2:]
            name = _DAYS.get(code, code)
            days.append(f"the {_ORD.get(int(num), num + 'th')} {name}" if num.lstrip("+-").isdigit() else name)
        text += " on " + ", ".join(days)
    if "BYMONTHDAY" in p:
        text += " on day " + ", ".join(p["BYMONTHDAY"].split(","))
    if "COUNT" in p:
        text += f", {p['COUNT']} times"
    if "UNTIL" in p:
        try:
            u = dt.datetime.strptime(p["UNTIL"], "%Y%m%dT%H%M%SZ").replace(tzinfo=UTC).astimezone(tz or zone())
            text += f" until {u:%b} {u.day}, {u.year}"
        except ValueError:
            pass
    return text
