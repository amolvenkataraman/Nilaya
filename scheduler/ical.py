"""VEVENT lines for the calendar ICS feed (feeds/views.py).

Repeating events are exported as one VEVENT with RRULE/EXDATE/RDATE (not expanded),
in their calendar's zone (DTSTART;TZID=… plus a VTIMEZONE built from zoneinfo) so
"9:00 every Monday" stays at 9:00 across DST in the subscriber's app; changed
occurrences are extra VEVENTs with the same UID and a RECURRENCE-ID.
"""

import datetime as dt

from feeds.ics import esc, fold, utc

from . import recurrence as rec

UTC = dt.timezone.utc


def _local(d, tz):
    return d.astimezone(tz).strftime("%Y%m%dT%H%M%S")


def _offset(td):
    total = int(td.total_seconds())
    sign = "-" if total < 0 else "+"
    total = abs(total)
    return f"{sign}{total // 3600:02d}{total % 3600 // 60:02d}"


def vtimezone(name, tz, first_year, last_year):
    """A VTIMEZONE listing the zone's actual transitions between the years (from zoneinfo)."""
    lines = ["BEGIN:VTIMEZONE", f"TZID:{name}"]
    start = dt.datetime(first_year, 1, 1, tzinfo=UTC)
    end = dt.datetime(last_year + 1, 1, 1, tzinfo=UTC)
    prev = start.astimezone(tz).utcoffset()
    comps = []
    t = start
    step = dt.timedelta(hours=6)
    while t < end:
        n = t + step
        off = n.astimezone(tz).utcoffset()
        if off != prev:  # bisect to the minute
            lo, hi = t, n
            while hi - lo > dt.timedelta(minutes=1):
                mid = lo + (hi - lo) / 2
                if mid.astimezone(tz).utcoffset() == prev:
                    lo = mid
                else:
                    hi = mid
            at = hi.replace(second=0, microsecond=0)
            local = (at + prev).replace(tzinfo=None)  # wall time just before the change, per RFC 5545
            comps.append(("DAYLIGHT" if off > prev else "STANDARD", local, prev, off, hi.astimezone(tz).tzname()))
            prev = off
        t = n
    if not comps:
        comps.append(("STANDARD", dt.datetime(1970, 1, 1), prev, prev, start.astimezone(tz).tzname()))
    for kind, local, frm, to, tzname in comps:
        lines += [f"BEGIN:{kind}", f"DTSTART:{local:%Y%m%dT%H%M%S}", f"TZOFFSETFROM:{_offset(frm)}",
                  f"TZOFFSETTO:{_offset(to)}", f"TZNAME:{esc(tzname or '')}", f"END:{kind}"]
    lines.append("END:VTIMEZONE")
    return lines


def _time_lines(e, tz, tzid, recurring):
    if e.kind == "all_day" and e.start_date:
        return [f"DTSTART;VALUE=DATE:{e.start_date:%Y%m%d}",
                f"DTEND;VALUE=DATE:{(e.end_date or e.start_date + dt.timedelta(days=1)):%Y%m%d}"]
    end = e.enddate or e.startdate
    if recurring:
        return [f"DTSTART;TZID={tzid}:{_local(e.startdate, tz)}", f"DTEND;TZID={tzid}:{_local(end, tz)}"]
    return [f"DTSTART:{utc(e.startdate)}", f"DTEND:{utc(end)}"]


def _rule_lines(e, tz, tzid):
    rule = e.rrule
    if e.kind == "all_day":  # UNTIL must be a DATE when DTSTART is one
        p = rec.parts(rule)
        if "UNTIL" in p:
            u = dt.datetime.strptime(p["UNTIL"], "%Y%m%dT%H%M%SZ").replace(tzinfo=UTC).astimezone(tz)
            p["UNTIL"] = u.strftime("%Y%m%d")
            rule = ";".join([f"FREQ={p.pop('FREQ')}"] + [f"{k}={v}" for k, v in p.items()])
    out = [f"RRULE:{rule}"]
    for prop, keys in (("EXDATE", e.exdates), ("RDATE", e.rdates)):
        if keys:
            moments = [rec.parse_moment(k) for k in keys]
            if e.kind == "all_day":
                out.append(f"{prop};VALUE=DATE:" + ",".join(m.astimezone(tz).strftime("%Y%m%d") for m in moments))
            else:
                out.append(f"{prop};TZID={tzid}:" + ",".join(_local(m, tz) for m in moments))
    return out


def vevent(e, *, calendar_name, colour, tz, tzid, stamp, extra_exdates=(), masked=False):
    """VEVENT lines for a single event, a series (with RRULE) or an override (RECURRENCE-ID).
    masked: someone else's private event seen by a plain subscriber, sent as "Busy" with times only."""
    uid = f"{e.recurrence_parent_id or e.id}@avnet"
    recurring = bool(e.rrule) or bool(e.recurrence_parent_id)
    name = "Busy" if masked else e.name
    summary = name if e.kind != "deadline" else f"Due: {name}"
    lines = ["BEGIN:VEVENT", f"UID:{uid}", f"DTSTAMP:{utc(stamp)}", f"LAST-MODIFIED:{utc(e.updated_on or stamp)}",
             f"SUMMARY:{esc(summary)}"]
    lines += _time_lines(e, tz, tzid, recurring)
    if e.rrule:
        if extra_exdates:
            e.exdates = sorted(set(e.exdates or []) | set(extra_exdates))
        lines += _rule_lines(e, tz, tzid)
    if e.recurrence_parent_id and e.original_start:
        if e.kind == "all_day":
            lines.append(f"RECURRENCE-ID;VALUE=DATE:{e.original_start.astimezone(tz):%Y%m%d}")
        else:
            lines.append(f"RECURRENCE-ID;TZID={tzid}:{_local(e.original_start, tz)}")
    for value, prop in ((e.location, "LOCATION"), (e.description, "DESCRIPTION")):
        if value and not masked:
            lines.append(f"{prop}:{esc(value)}")
    if e.meeting_url and not masked:
        lines.append(f"URL:{e.meeting_url}")
        lines.append(f"CONFERENCE;VALUE=URI;FEATURE=VIDEO:{e.meeting_url}")
    cats = [calendar_name]
    if e.event_category_id and e.event_category.legacy_id != 0 and not masked:
        cats.append(e.event_category.name)
    cats += [] if masked else list(e.tags or [])
    lines.append("CATEGORIES:" + ",".join(esc(c) for c in cats if c))
    if colour:
        lines.append(f"COLOR:{colour}")  # RFC 7986 allows CSS colour names; #rrggbb is widely accepted
    if e.status != "confirmed":
        lines.append(f"STATUS:{e.status.upper()}")
    if e.transparency == "free":
        lines.append("TRANSP:TRANSPARENT")
    if e.visibility != "default":
        lines.append(f"CLASS:{'PUBLIC' if e.visibility == 'public' else 'PRIVATE'}")
    lines.append("END:VEVENT")
    return lines


def calendar_text(name, header_extra, bodies):
    lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//AVNet Superapp//Feeds//EN", "CALSCALE:GREGORIAN",
             f"X-WR-CALNAME:{esc(name)}", "REFRESH-INTERVAL;VALUE=DURATION:PT30M", "X-PUBLISHED-TTL:PT30M"]
    lines += header_extra
    lines += bodies
    lines.append("END:VCALENDAR")
    return "\r\n".join(fold(line) for line in lines) + "\r\n"
