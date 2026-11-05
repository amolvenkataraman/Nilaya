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
import logging
import re
from functools import lru_cache
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from dateutil.rrule import rrulestr
from django.conf import settings

log = logging.getLogger(__name__)

UTC = dt.timezone.utc
ALLOWED_FREQ = ("DAILY", "WEEKLY", "MONTHLY", "YEARLY")
MAX_COUNT = 5000          # COUNT=… limit (also the scan cap for the last occurrence)
MAX_PER_SERIES = 1000     # occurrences returned per series per query
MAX_RULE_LENGTH = 500

# The RRULE parts accepted, each a comma list of values matching the pattern (and in range).
_DAY = r"(?:MO|TU|WE|TH|FR|SA|SU)"
_PART_SYNTAX = {
    "FREQ": (r"DAILY|WEEKLY|MONTHLY|YEARLY", None),
    "INTERVAL": (r"\d{1,4}", None),
    "COUNT": (r"\d{1,4}", None),
    "UNTIL": (r"\d{8}(?:T\d{6}Z?)?", None),
    "WKST": (_DAY, None),
    "BYDAY": (r"(?:[+-]?\d{1,2})?" + _DAY, (1, 53)),
    "BYMONTHDAY": (r"[+-]?\d{1,2}", (1, 31)),
    "BYYEARDAY": (r"[+-]?\d{1,3}", (1, 366)),
    "BYWEEKNO": (r"[+-]?\d{1,2}", (1, 53)),
    "BYSETPOS": (r"[+-]?\d{1,3}", (1, 366)),
    "BYMONTH": (r"\d{1,2}", (1, 12)),
    "BYHOUR": (r"\d{1,2}", (0, 23)),
    "BYMINUTE": (r"\d{1,2}", (0, 59)),
    "BYSECOND": (r"\d{1,2}", (0, 60)),
}
_LISTS = {k for k, (_, rng) in _PART_SYNTAX.items() if rng}
_PART_RE = {k: re.compile(rf"(?:{pat})") for k, (pat, _) in _PART_SYNTAX.items()}
_MONTH_DAYS = (31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31)  # Feb 29 happens (leap years)
_PROBE_YEAR = 9943  # "does it ever happen" probes run from here to year 9999: two 28-year calendar cycles


@lru_cache(maxsize=128)
def zone(name=None):
    """ZoneInfo for an IANA name; blank/unknown → settings.TIME_ZONE."""
    try:
        return ZoneInfo(name or settings.TIME_ZONE)
    except (ZoneInfoNotFoundError, ValueError, TypeError):
        return ZoneInfo(settings.TIME_ZONE)


def event_zone(ev):
    """The zone a series repeats in: the event's own (kept from imports), else its calendar's."""
    return zone(ev.time_zone) if getattr(ev, "time_zone", "") else ev.calendar.tz


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


def check_parts(text):
    """Parse an RRULE value strictly: printable ASCII only (a CR/LF would smuggle other ICS lines
    in), known parts, each once, with well-formed values in range. Returns {PART: VALUE}."""
    if len(text) > MAX_RULE_LENGTH:
        raise ValueError("The repeat rule is too long")
    if any(not (" " <= c <= "~") for c in text):
        raise ValueError("The repeat rule has characters it can't contain")
    p = {}
    for piece in text.split(";"):
        if not piece.strip():
            continue
        k, sep, v = piece.partition("=")
        k, v = k.strip().upper(), v.strip().upper()
        if not sep or not k or not v:
            raise ValueError(f"Malformed RRULE part: {piece!r}")
        if k not in _PART_SYNTAX:
            raise ValueError(f"Unsupported RRULE part: {k}")
        if k in p:
            raise ValueError(f"{k} is given twice")
        values = v.split(",") if k in _LISTS else [v]
        rng = _PART_SYNTAX[k][1]
        for x in values:
            if not _PART_RE[k].fullmatch(x):
                raise ValueError(f"Malformed RRULE part: {piece!r}")
            if rng:
                num = x.rstrip("AEFHMORSTUW")  # BYDAY: the ordinal before the day
                if num not in ("", "+", "-") and not (rng[0] <= abs(int(num)) <= rng[1]
                                                      and (int(num) != 0 or rng[0] == 0)):
                    raise ValueError(f"{k} is out of range: {x}")
        p[k] = v
    return p


def well_formed(rule):
    """True if a stored rule passes check_parts (old rows may predate the strict check)."""
    try:
        return bool(rule) and "FREQ" in check_parts(rule) and parts(rule).get("FREQ") in ALLOWED_FREQ
    except ValueError:
        return False


def _impossible_month_days(p):
    """BYMONTH + BYMONTHDAY that no month can have (e.g. February 30th)."""
    if "BYMONTH" not in p or "BYMONTHDAY" not in p:
        return False
    days = [abs(int(d)) for d in p["BYMONTHDAY"].split(",")]
    return not any(d <= _MONTH_DAYS[int(m) - 1] for m in p["BYMONTH"].split(",") for d in days)


def _without(p, *names):
    q = {k: v for k, v in p.items() if k not in names}
    return ";".join([f"FREQ={q.pop('FREQ')}"] + [f"{k}={v}" for k, v in q.items()])


@lru_cache(maxsize=4096)
def _never(rule, probe_start):
    """True if ``rule`` (no COUNT/UNTIL) yields nothing from ``probe_start`` (naive, late in year 9999's
    century) to the end of the calendar. dateutil looks for a match period by period up to year 9999,
    so a rule that can never match (February 30th, or a Monday on a 7-day step from a Tuesday) costs
    seconds per expansion; from here it costs at most a few milliseconds, once per rule."""
    try:
        return next(iter(rrulestr(rule, dtstart=probe_start)), None) is None
    except (ValueError, TypeError, OverflowError):
        return True


def _probe_start(base, p):
    """``base`` (naive) moved by whole repeat periods to about _PROBE_YEAR, so the rule keeps its phase
    (which weekday a 7-day step lands on, which months a 12-month step visits). None = no probe
    (periods longer than 4 years: few enough to scan anyway)."""
    n = int(p.get("INTERVAL", 1) or 1)
    if p["FREQ"] in ("DAILY", "WEEKLY"):
        step = n * (7 if p["FREQ"] == "WEEKLY" else 1)
        if step > 4 * 366:
            return None
        k = (dt.datetime(_PROBE_YEAR, 1, 1) - base).days // step
        return base + dt.timedelta(days=k * step)
    months = n * (12 if p["FREQ"] == "YEARLY" else 1)
    if months > 48:
        return None
    m0 = base.year * 12 + base.month - 1
    k = (_PROBE_YEAR * 12 - m0) // months
    for j in range(k, k - 12, -1):  # a 31st / Feb 29 start needs a month that has the day
        y, m = divmod(m0 + j * months, 12)
        try:
            return base.replace(year=y, month=m + 1)
        except ValueError:
            continue
    return None


def never_occurs(rule, base=None):
    """True if the rule's pattern can never produce a date (from ``base``, a naive start, keeping its
    phase; without one, ignoring INTERVAL). COUNT/UNTIL are left out: they only end a series."""
    p = parts(rule)
    if base is None:
        return _never(_without(p, "COUNT", "UNTIL", "INTERVAL"), dt.datetime(_PROBE_YEAR, 1, 1, 9))
    start = _probe_start(base.replace(tzinfo=None, microsecond=0), p)
    return start is not None and _never(_without(p, "COUNT", "UNTIL"), start)


def normalize_rrule(text, tz):
    """Validate an RRULE and return it canonical ("" = not recurring).

    FREQ is limited to DAILY…YEARLY; a floating or date-only UNTIL is read in ``tz``
    and rewritten as UTC (RFC 5545 requires UTC when DTSTART has a zone). Rules that can
    never happen (February 30th) are refused."""
    text = (text or "").strip()
    if text.upper().startswith("RRULE:"):
        text = text[6:]
    if not text:
        return ""
    p = check_parts(text)
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
    if _impossible_month_days(p):
        raise ValueError("That repeat rule never happens (no month has that day)")
    out = ";".join([f"FREQ={p.pop('FREQ')}"] + [f"{k}={v}" for k, v in p.items()])
    try:
        rrulestr(out, dtstart=dt.datetime(2000, 1, 3, 9, tzinfo=tz))
    except (ValueError, TypeError) as ex:
        raise ValueError(f"Invalid RRULE: {ex}")
    if never_occurs(out):
        raise ValueError("That repeat rule never happens")
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
    """The series' dateutil rule, or None when its pattern can never match (nothing to expand).
    ValueError for a stored rule that isn't well formed (callers listing many series skip it)."""
    if not well_formed(ev.rrule):
        raise ValueError(f"Unusable repeat rule on event {ev.pk}")
    base = _dtstart(ev, tz)
    if never_occurs(ev.rrule, base):
        return None
    return rrulestr(ev.rrule, dtstart=base)


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
        capped = False
        for i, d in enumerate(rule if rule is not None else ()):
            last = d
            if i >= MAX_COUNT:
                capped = True
                break
        if capped:
            # A very long series (e.g. daily for 20 years): don't stop it at the cap. UNTIL bounds it
            # (a slightly late end only widens range queries); a huge COUNT is treated as open-ended.
            if "UNTIL" not in p:
                return None
            last = max(last, rule._until or last)
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
    rule = _rule(ev, tz)
    p = parts(ev.rrule)
    after_l, before_l = after.astimezone(tz), before.astimezone(tz)
    out = []
    # Fast-forward simple DAILY/WEEKLY rules close to the range: shifting DTSTART by whole
    # periods keeps the same lattice of occurrences (COUNT counts from the real start).
    if rule is not None and "COUNT" not in p and "BYSETPOS" not in p and p["FREQ"] in ("DAILY", "WEEKLY"):
        step = int(p.get("INTERVAL", 1)) * (1 if p["FREQ"] == "DAILY" else 7)
        k = (after_l.date() - base.date()).days // step - 1
        if k > 0:
            rule = rule.replace(dtstart=base + dt.timedelta(days=k * step))
    for d in (rule.xafter(after_l, inc=True) if rule is not None else ()):  # None: never matches
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


def rule_count_before(ev, tz, moment):
    """How many occurrences the rule itself (not RDATEs; EXDATEs count, as for COUNT) has before
    ``moment``: what "this and following" subtracts from COUNT. COUNT ≤ MAX_COUNT bounds the scan."""
    rule = _rule(ev, tz)
    n = 0
    for d in rule if rule is not None else ():
        if d >= moment or n > MAX_COUNT:
            break
        n += 1
    return n


def occurrence_at(ev, original, tz):
    """The occurrence of a series that starts at ``original`` (UTC aware), or None."""
    try:
        starts = starts_between(ev, tz, original - dt.timedelta(seconds=1), original + dt.timedelta(seconds=1))
    except ValueError:
        log.warning("Event %s has an unusable repeat rule %r", ev.pk, ev.rrule)
        return None
    for s in starts:
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
    try:
        return _describe(rule, tz)
    except (ValueError, TypeError):
        return ""


def _describe(rule, tz):
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
