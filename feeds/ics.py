"""Minimal RFC 5545 writer (escaping, line folding, UTC times)."""

import datetime


def esc(text):
    return (str(text or "").replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,")
            .replace("\r\n", "\\n").replace("\r", "\\n").replace("\n", "\\n"))


def fold(line):
    raw = line.encode()
    if len(raw) <= 75:
        return line
    out, cur = [], b""
    for ch in line:
        b = ch.encode()
        if len(cur) + len(b) > (75 if not out else 74):
            out.append(cur.decode())
            cur = b""
        cur += b
    out.append(cur.decode())
    return "\r\n ".join(out)


def utc(dt):
    return dt.astimezone(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def calendar(name, events):
    """events: dicts with uid, summary, start, end (datetimes) or date + all_day, and optional location/description/url."""
    now = utc(datetime.datetime.now(datetime.timezone.utc))
    lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//AVNet Superapp//Feeds//EN", "CALSCALE:GREGORIAN",
             f"X-WR-CALNAME:{esc(name)}", "REFRESH-INTERVAL;VALUE=DURATION:PT30M", "X-PUBLISHED-TTL:PT30M"]
    for e in events:
        lines += ["BEGIN:VEVENT", f"UID:{e['uid']}", f"DTSTAMP:{now}", f"SUMMARY:{esc(e['summary'])}"]
        if e.get("all_day"):
            day = e["start"]
            lines += [f"DTSTART;VALUE=DATE:{day:%Y%m%d}", f"DTEND;VALUE=DATE:{(e.get('end') or day + datetime.timedelta(days=1)):%Y%m%d}"]
        else:
            lines += [f"DTSTART:{utc(e['start'])}", f"DTEND:{utc(e['end'] or e['start'])}"]
        for key, prop in (("location", "LOCATION"), ("description", "DESCRIPTION"), ("url", "URL"), ("categories", "CATEGORIES")):
            if e.get(key):
                lines.append(f"{prop}:{esc(e[key]) if prop != 'URL' else e[key]}")
        lines.append("END:VEVENT")
    lines.append("END:VCALENDAR")
    return "\r\n".join(fold(line) for line in lines) + "\r\n"
