"""Calendar import: ICS feeds (icalendar), public Google Calendars (API v3) and UWaterloo WCMS.

ICS and Google share one ingest step (_ingest) that maps the source onto the event model:
- a repeating event is one series row (rrule, exdates, rdates, time_zone), not flattened;
- a changed occurrence (ICS RECURRENCE-ID, Google recurringEventId + originalStartTime) is an
  override row; a cancelled occurrence becomes an EXDATE on its series;
- sync_id is the UID (ICS) or event id (Google); overrides use "<uid>|<original start key>";
- events that disappeared from the source are marked cancelled (custom_info
  "removed_from_source"), never deleted, and come back if the source lists them again;
  only overrides that disappeared are deleted (the occurrence goes back to the rule).
"""

from scheduler.models import *
from Comptech.api import *

from dateutil import parser
import bleach
import copy
import datetime
import icalendar
import requests
import pytz

from django.db import transaction
from django.utils import timezone
from scheduler import recurrence as rec

# Timeout (seconds) for all outbound sync requests
SYNC_TIMEOUT = 30
PREVIEW_MAX_BYTES = 20 * 1024 * 1024  # a preview reads at most this much of a feed


def source_url(url):
    """webcal:// (what calendar apps hand out) is plain HTTP(S); requests can't fetch the scheme itself."""
    url = (url or "").strip()
    low = url.lower()
    if low.startswith("webcals://"):
        return "https://" + url[10:]
    if low.startswith("webcal://"):
        return "https://" + url[9:]
    return url


def _google_events_url(calendar_id):
    from urllib.parse import quote
    return f"https://www.googleapis.com/calendar/v3/calendars/{quote(calendar_id.strip(), safe='@.')}/events"

# Synced descriptions are rendered as HTML by the calendar UI, so keep basic
# formatting but strip scripts, event handlers and javascript: URLs.
_DESC_TAGS = {
    "a", "b", "strong", "i", "em", "u", "br", "p", "div", "span", "ul", "ol", "li",
    "blockquote", "code", "pre", "h1", "h2", "h3", "h4", "h5", "h6",
    "table", "thead", "tbody", "tr", "th", "td",
}
_DESC_ATTRS = {"a": ["href", "title", "target", "rel"]}

def _clean(value):
    return bleach.clean(value) if value else value

def _clean_desc(value):
    if not value:
        return value
    return bleach.clean(value, tags=_DESC_TAGS, attributes=_DESC_ATTRS,
                        protocols=["http", "https", "mailto"], strip=True)


def _status(value):
    v = (str(value) if value else "").lower()
    return v if v in ("tentative", "cancelled") else "confirmed"


# ---------------------------------------------------------------- the shared model mapping

class Item(dict):
    """One source event: uid, recurrence_id (aware UTC or None), status, name, description, location,
    all_day, start/end (aware) or start_day/end_day (dates), tz (IANA name or ""), rrule, exdates, rdates
    (aware moments), transparent."""
    __getattr__ = dict.get


def _zone_name(value):
    """IANA name of a datetime's zone ("" for floating/unknown, "UTC" for Z times)."""
    tzinfo = getattr(value, "tzinfo", None)
    if tzinfo is None:
        return ""
    name = getattr(tzinfo, "key", None) or getattr(tzinfo, "zone", None) or str(tzinfo)
    if name in ("UTC", "Z", "utc") or tzinfo is datetime.timezone.utc:
        return "UTC"
    return name if rec.valid_zone(name) else ""


def _moment(value, tz):
    """date / naive / aware → aware UTC (a date = local midnight, naive = local time in tz)."""
    if isinstance(value, datetime.datetime):
        return (value.replace(tzinfo=tz) if value.tzinfo is None else value).astimezone(datetime.timezone.utc)
    return rec.local_midnight(value, tz)


def _fill(e, it, tz_cal):
    e.name = (_clean(it.name) or "Untitled")[:256]
    e.description = _clean_desc(it.description)
    e.location = (_clean(it.location) or None) and _clean(it.location)[:256]
    e.status = it.status
    e.transparency = "free" if it.transparent else "busy"
    e.time_zone = "" if it.all_day else (it.tz or "")
    if it.all_day:
        e.kind, e.allday = "all_day", True
        e.start_date = it.start_day
        e.end_date = it.end_day if it.end_day and it.end_day > it.start_day else it.start_day + datetime.timedelta(days=1)
        e.startdate = e.enddate = None  # derived from the dates on save
    else:
        e.kind, e.allday = ("event" if it.end is not None else "deadline"), False
        e.start_date = e.end_date = None
        e.startdate, e.enddate = it.start, it.end
    ci = dict(e.custom_info or {})
    ci.pop("removed_from_source", None)
    ci.pop("unsupported_rrule", None)
    if it.recurrence_id is None:
        zone = rec.zone(e.time_zone) if e.time_zone else tz_cal
        rule = ""
        if it.rrule:
            try:
                rule = rec.normalize_rrule(it.rrule, zone)
            except ValueError:
                ci["unsupported_rrule"] = it.rrule[:500]  # kept as its first occurrence only
        e.rrule = rule
        e.exdates = sorted({rec.key(m) for m in it.exdates or []}) if rule else []
        e.rdates = sorted({rec.key(m) for m in it.rdates or []}) if rule else []
    e.custom_info = ci


def _state(e):
    """The stored values of an event, to tell whether a sync changed anything."""
    if e.pk is None:
        return None
    return {f.attname: copy.deepcopy(getattr(e, f.attname)) for f in Event._meta.concrete_fields if f.attname != "updated_on"}


def _save_if_changed(e, before):
    """Write only events the source changed: most syncs change nothing, and saving every event each
    time cost an UPDATE per event and a new updated_on (so the events ETag changed and browsers
    never got a 304 after a sync)."""
    # Each write in its own savepoint: one bad row (say, a UID too long for the column) is skipped by
    # _ingest without aborting the transaction, which would silently drop the whole sync.
    if before is None:
        with transaction.atomic():
            e.save()
        return
    e.normalize()
    changed = [k for k, v in _state(e).items() if v != before[k]]
    if changed:
        with transaction.atomic():
            e.save(update_fields=changed)


def _in_window(it, lo, hi, tz_cal):
    start = rec.local_midnight(it.start_day, tz_cal) if it.all_day else it.start
    end = (rec.local_midnight(it.end_day or it.start_day + datetime.timedelta(days=1), tz_cal) if it.all_day
           else (it.end or it.start))
    return start >= lo and end <= hi


def _ingest(calendar, items, lo, hi):
    """Upsert items into the calendar. Returns counts."""
    tz_cal = calendar.tz
    now = timezone.now()
    counts = {"saved": 0, "series": 0, "overrides": 0, "cancelled_occurrences": 0, "removed": 0, "skipped": 0}
    existing = {e.sync_id: e for e in Event.objects.filter(calendar=calendar, sync_id__isnull=False)}
    present = {it.uid if it.recurrence_id is None else f"{it.uid}|{rec.key(it.recurrence_id)}" for it in items}
    seen_uids = {it.uid for it in items}
    # Cancelled occurrences become EXDATEs of their series: merge them in before the series is
    # compared and saved, so an unchanged feed doesn't rewrite the series twice per sync.
    cancelled_keys = {}
    for it in items:
        if it.recurrence_id is not None and it.status == "cancelled":
            cancelled_keys.setdefault(it.uid, set()).add(rec.key(it.recurrence_id))
    series = {}
    with transaction.atomic():
        for it in (i for i in items if i.recurrence_id is None):
            try:
                e = existing.get(it.uid)
                if it.status == "cancelled":  # a deleted event or series (Google may send no times)
                    if e is not None and e.status != "cancelled":
                        e.status = "cancelled"
                        e.save(update_fields=["status"])
                    continue
                first = rec.local_midnight(it.start_day, tz_cal) if it.all_day else it.start
                if (it.rrule and first >= hi) or (not it.rrule and not _in_window(it, lo, hi, tz_cal)):
                    continue
                e = e or Event(calendar=calendar, sync_id=it.uid)
                before = _state(e)
                e.calendar = calendar
                _fill(e, it, tz_cal)
                if e.rrule and it.uid in cancelled_keys:
                    e.exdates = sorted(set(e.exdates) | cancelled_keys[it.uid])
                _save_if_changed(e, before)
                existing[it.uid] = e  # a UID listed twice updates this row instead of colliding with it
                counts["saved"] += 1
                if e.rrule:
                    series[it.uid] = e
                    counts["series"] += 1
            except Exception as ex:
                counts["skipped"] += 1
                print(f"Skipped {it.uid!r}: {type(ex).__name__} {ex.args}")
        cancelled = {}
        for it in (i for i in items if i.recurrence_id is not None):
            try:
                k = rec.key(it.recurrence_id)
                sid = f"{it.uid}|{k}"
                parent = series.get(it.uid)
                if parent is None:
                    p = existing.get(it.uid)
                    parent = p if p is not None and p.rrule else None
                if parent is None:  # no series here: keep it as a single event
                    if it.status == "cancelled" or not _in_window(it, lo, hi, tz_cal):
                        continue
                    e = existing.get(sid) or Event(calendar=calendar, sync_id=sid)
                    before = _state(e)
                    e.calendar = calendar
                    _fill(e, Item(it, recurrence_id=None, rrule=""), tz_cal)
                    _save_if_changed(e, before)
                    existing[sid] = e
                    counts["saved"] += 1
                    continue
                if it.status == "cancelled":
                    cancelled.setdefault(parent.pk, (parent, set()))[1].add(k)
                    Event.objects.filter(recurrence_parent=parent, original_start=it.recurrence_id).delete()
                    present.discard(sid)
                    continue
                o = existing.get(sid) or Event.objects.filter(recurrence_parent=parent,
                                                              original_start=it.recurrence_id).first() \
                    or Event(calendar=calendar)
                before = _state(o)
                o.calendar, o.sync_id = calendar, sid
                o.recurrence_parent, o.original_start = parent, it.recurrence_id
                _fill(o, it, tz_cal)
                o.event_category_id = o.event_category_id or parent.event_category_id
                _save_if_changed(o, before)
                existing[sid] = o
                counts["overrides"] += 1
            except Exception as ex:
                counts["skipped"] += 1
                print(f"Skipped an occurrence of {it.uid!r}: {type(ex).__name__} {ex.args}")
        for parent, keys in cancelled.values():
            merged = sorted(set(parent.exdates or []) | keys)
            if merged != list(parent.exdates or []):
                parent.exdates = merged
                parent.save(update_fields=["exdates"])
            counts["cancelled_occurrences"] += len(keys)

        # Gone from the source: overrides revert to the rule; everything else is marked cancelled.
        for sid, e in existing.items():
            if sid in present:
                continue
            if e.recurrence_parent_id:
                if sid.split("|", 1)[0] in seen_uids:
                    e.delete()
                    counts["removed"] += 1
                continue
            in_window = bool(e.rrule) or (lo <= e.startdate < hi)
            if in_window and e.status != "cancelled":
                e.status = "cancelled"
                e.custom_info = {**(e.custom_info or {}), "removed_from_source": now.isoformat()}
                e.save(update_fields=["status", "custom_info"])
                counts["removed"] += 1
    return counts


# ---------------------------------------------------------------- ICS

def _ics_dates(comp, prop, tz):
    """EXDATE/RDATE values of a component (one or many lines) as aware UTC moments."""
    raw = comp.get(prop)
    if raw is None:
        return []
    out = []
    for line in raw if isinstance(raw, list) else [raw]:
        for v in getattr(line, "dts", []):
            if isinstance(v.dt, (datetime.datetime, datetime.date)):
                out.append(_moment(v.dt, tz))
    return out


def parse_ics(text, tz_cal):
    """ICS text → Items (masters and RECURRENCE-ID overrides)."""
    cal = icalendar.Calendar.from_ical(text)
    items = []
    for comp in cal.walk("VEVENT"):
        uid = str(comp.get("UID") or "").strip()
        if not uid or comp.get("DTSTART") is None:
            continue
        start = comp.decoded("DTSTART")
        all_day = not isinstance(start, datetime.datetime)
        tzname = "" if all_day else _zone_name(start)
        tz = rec.zone(tzname) if tzname else tz_cal
        if comp.get("DTEND") is not None:
            end = comp.decoded("DTEND")
        elif comp.get("DURATION") is not None:
            end = start + comp.decoded("DURATION")
        else:
            end = start + datetime.timedelta(days=1) if all_day else start
        rid = comp.get("RECURRENCE-ID")
        rrule = comp.get("RRULE")
        it = Item(uid=uid, status=_status(comp.get("STATUS")), name=str(comp.get("SUMMARY") or ""),
                  description=str(comp.get("DESCRIPTION") or "") or None, location=str(comp.get("LOCATION") or "") or None,
                  all_day=all_day, tz=tzname, transparent=str(comp.get("TRANSP") or "").upper() == "TRANSPARENT",
                  recurrence_id=_moment(comp.decoded("RECURRENCE-ID"), tz) if rid is not None else None,
                  rrule=rrule.to_ical().decode() if rrule is not None else "",
                  exdates=_ics_dates(comp, "EXDATE", tz), rdates=_ics_dates(comp, "RDATE", tz))
        if all_day:
            it.update(start_day=start, end_day=end if not isinstance(end, datetime.datetime) else end.date())
        else:
            it.update(start=_moment(start, tz), end=_moment(end, tz))
        items.append(it)
    return items


def sync_ical(calendar, start, end, url=None, conditional=False):
    """Import an ICS feed. Returns True, False (fetch/parse failed) or "not_modified" (HTTP 304)."""
    if url == None: url = calendar.calendar_url
    headers = {}
    if conditional:
        if calendar.sync_etag: headers["If-None-Match"] = calendar.sync_etag
        if calendar.sync_last_modified: headers["If-Modified-Since"] = calendar.sync_last_modified
    try:
        r = requests.get(source_url(url), timeout=SYNC_TIMEOUT, headers=headers)
        if r.status_code == 304:
            return "not_modified"
        r.raise_for_status()
        items = parse_ics(r.content, calendar.tz)
    except Exception as ex:
        print(f"iCal fetch/parse failed for {calendar.name}: {type(ex).__name__} {ex.args}")
        return False
    calendar.sync_etag = (r.headers.get("ETag") or "")[:256]
    calendar.sync_last_modified = (r.headers.get("Last-Modified") or "")[:64]
    calendar.last_ingest = _ingest(calendar, items, parser.parse(start), parser.parse(end))
    print(f"{calendar.name}: {calendar.last_ingest}")
    return True


# ---------------------------------------------------------------- Google

def _google_time(t, tz_cal):
    """A Google start/end/originalStartTime → (aware UTC or None, date or None, zone name)."""
    if t is None:
        return None, None, ""
    if "date" in t and "dateTime" not in t:
        return None, datetime.date.fromisoformat(t["date"]), ""
    name = t.get("timeZone") or ""
    name = name if rec.valid_zone(name) else ""
    return rec.parse_moment(t["dateTime"]), None, name


def _recurrence_lines(lines, tz):
    """Google's recurrence[] (RFC 5545 lines) → (rrule, exdates, rdates)."""
    rule, ex, rd = "", [], []
    for line in lines or []:
        name, _, value = line.partition(":")
        prop, *params = name.split(";")
        prop = prop.upper()
        if prop == "RRULE":
            rule = value
            continue
        if prop not in ("EXDATE", "RDATE"):
            continue
        p = dict(x.split("=", 1) for x in params if "=" in x)
        ztz = rec.zone(p["TZID"]) if p.get("TZID") and rec.valid_zone(p["TZID"]) else tz
        for v in value.split(","):
            v = v.strip()
            if not v or "/" in v:  # PERIOD values aren't supported
                continue
            if len(v) == 8:
                m = rec.local_midnight(datetime.datetime.strptime(v, "%Y%m%d").date(), ztz)
            elif v.endswith("Z"):
                m = datetime.datetime.strptime(v, "%Y%m%dT%H%M%SZ").replace(tzinfo=datetime.timezone.utc)
            else:
                m = datetime.datetime.strptime(v, "%Y%m%dT%H%M%S").replace(tzinfo=ztz).astimezone(datetime.timezone.utc)
            (ex if prop == "EXDATE" else rd).append(m)
    return rule, ex, rd


def parse_google(res_items, tz_cal):
    """Google events.list items (singleEvents=false) → Items."""
    items = []
    for i in res_items:
        status = _status(i.get("status"))
        rec_id = i.get("recurringEventId")
        uid = rec_id or i["id"]
        s, s_day, s_tz = _google_time(i.get("start"), tz_cal)
        e, e_day, _ = _google_time(i.get("end"), tz_cal)
        original = None
        if rec_id:
            o, o_day, o_tz = _google_time(i.get("originalStartTime"), tz_cal)
            original = o or (rec.local_midnight(o_day, tz_cal) if o_day else None)
            if original is None:
                continue
        if s is None and s_day is None:
            if status == "cancelled" and rec_id:  # cancelled instances may carry only originalStartTime
                items.append(Item(uid=uid, recurrence_id=original, status="cancelled", all_day=False, start=original,
                                  end=original))
            elif status == "cancelled":
                items.append(Item(uid=uid, recurrence_id=None, status="cancelled", all_day=False, start=None, end=None))
            continue
        tz = rec.zone(s_tz) if s_tz else tz_cal
        rule, ex, rd = _recurrence_lines(i.get("recurrence"), tz)
        it = Item(uid=uid, recurrence_id=original, status=status, name=i.get("summary") or "",
                  description=i.get("description"), location=i.get("location"), all_day=s_day is not None,
                  tz=s_tz, transparent=i.get("transparency") == "transparent", rrule=rule, exdates=ex, rdates=rd)
        if s_day is not None:
            it.update(start_day=s_day, end_day=e_day)
        else:
            it.update(start=s, end=e)
        items.append(it)
    return items


def sync_google(calendar, start, end, token, url=None):
    """Import a Google Calendar over [start, end): masters come back with their recurrence and
    changed/cancelled instances as exceptions (singleEvents=false), all pages, deleted ones included."""
    if url == None: url = calendar.calendar_url
    raw, page = [], None
    try:
        while True:
            params = {"key": GOOGLE_API_KEY, "timeMin": start, "timeMax": end, "singleEvents": "false",
                      "showDeleted": "true", "maxResults": 2500}
            if page:
                params["pageToken"] = page
            r = requests.get(_google_events_url(url), params=params,
                             headers={'Authorization': f'Bearer {token}'} if token != None else None,
                             timeout=SYNC_TIMEOUT)
            r.raise_for_status()
            res = r.json()
            raw += res.get("items", [])
            page = res.get("nextPageToken")
            if not page:
                break
        items = parse_google(raw, calendar.tz)
    except Exception as ex:
        print(f"Google fetch failed for {calendar.name}: {type(ex).__name__} {ex.args}")
        return False
    calendar.last_ingest = _ingest(calendar, items, parser.parse(start), parser.parse(end))
    print(f"{calendar.name}: {calendar.last_ingest}")
    return True

def sync_uwaterloo(calendar, start, end):
    url = calendar.calendar_url

    r = requests.get(f"https://openapi.data.uwaterloo.ca/v3/Wcms/{url}/events", headers={'x-api-key': UWATERLOO_API_KEY}, timeout=SYNC_TIMEOUT)
    res = r.json()

    try:
        for i in res:
            toronto = pytz.timezone('America/Toronto')
            sd = toronto.localize(parser.parse(i['eventStartDate']))
            ed = toronto.localize(parser.parse(i['eventEndDate']))

            if (sd >= parser.parse(start) and ed <= parser.parse(end)):
                try:
                    e = Event.objects.filter(calendar=calendar, sync_id=i['uniqueKey'])[0]
                except IndexError:
                    e = Event()

                e.name = _clean(i['title'])
                e.calendar = calendar
                e.description = _clean_desc(i['content'])
                e.sync_id = i['uniqueKey']
                e.startdate = str(i['eventStartDate'])
                e.enddate = str(i['eventEndDate'])
                e.save()

    except Exception as ex:
        print(f"A(n) {type(ex).__name__} occurred. {ex.args}")
        return False

    return True


def preview_source(calendar_type, url, tz):
    """Fetch a source without saving anything: its name, how many events it has and the next few,
    so people can check a link before creating a calendar from it. Raises ValueError with a
    readable message when the source can't be read."""
    now = timezone.now()
    if calendar_type == 1:
        try:
            r = requests.get(source_url(url), timeout=SYNC_TIMEOUT, stream=True)
            r.raise_for_status()
            body = r.raw.read(PREVIEW_MAX_BYTES + 1, decode_content=True)
        except requests.RequestException as ex:
            raise ValueError(f"Couldn't download the feed ({type(ex).__name__}).")
        if len(body) > PREVIEW_MAX_BYTES:
            raise ValueError("The feed is too large to preview.")
        try:
            name = str(icalendar.Calendar.from_ical(body).get("X-WR-CALNAME") or "")
            items = parse_ics(body, tz)
        except Exception:
            raise ValueError("That link isn't an iCalendar (.ics) feed.")
        def when(it):
            return rec.local_midnight(it["start_day"], tz) if it.get("all_day") else it.get("start")
        masters = [it for it in items if it.get("recurrence_id") is None and it.get("status") != "cancelled"]
        upcoming = sorted((it for it in masters if it.get("rrule") or (when(it) and when(it) >= now)),
                          key=lambda it: (not it.get("rrule") and when(it)) or now)[:5]
        return {"name": name[:64], "events": len(masters), "series": sum(1 for it in masters if it.get("rrule")),
                "upcoming": [{"name": it.get("name") or "(no title)", "start": when(it), "all_day": it.get("all_day", False),
                              "repeats": bool(it.get("rrule"))} for it in upcoming]}
    if calendar_type == 2:
        try:
            r = requests.get(_google_events_url(url), timeout=SYNC_TIMEOUT, params={
                "key": GOOGLE_API_KEY, "timeMin": now.isoformat(), "singleEvents": "true", "orderBy": "startTime",
                "maxResults": 5})
            r.raise_for_status()
            res = r.json()
        except requests.RequestException as ex:
            code = getattr(getattr(ex, "response", None), "status_code", None)
            raise ValueError("Google says this calendar isn't public or doesn't exist." if code in (403, 404)
                             else f"Couldn't reach Google Calendar ({type(ex).__name__}).")
        upcoming = []
        for e in res.get("items", []):
            start, day, _ = _google_time(e.get("start"), tz)
            upcoming.append({"name": e.get("summary") or "(no title)", "start": start or (rec.local_midnight(day, tz) if day else None),
                             "all_day": day is not None, "repeats": bool(e.get("recurringEventId"))})
        return {"name": (res.get("summary") or "")[:64], "events": None, "series": None, "upcoming": upcoming}
    raise ValueError("Previews are available for iCalendar links and Google calendars.")


def window_strings(cal, now=None):
    """The calendar's sync window as the ISO strings the sync functions take."""
    from scheduler.service import sync_window
    a, b = sync_window(cal, now)
    return a.isoformat(), b.isoformat()


def sync_calendar(cal, start=None, end=None, token=None, conditional=True):
    """Sync one calendar (its window by default) and record the outcome on it.
    Returns True, False or "not_modified". Conditional GET (ETag / If-Modified-Since) is
    used for ICS feeds, but only when the window hasn't moved since the last sync."""
    if start is None or end is None:
        start, end = window_strings(cal)
    now = timezone.now()
    same_month = cal.last_synced_at is not None and \
        timezone.localtime(cal.last_synced_at, cal.tz).strftime("%Y%m") == timezone.localtime(now, cal.tz).strftime("%Y%m")
    try:
        if cal.calendar_type == 1:
            status = sync_ical(cal, start, end, conditional=conditional and same_month and not cal.last_sync_error)
        elif cal.calendar_type == 2:
            status = sync_google(cal, start, end, token)
        elif cal.calendar_type == 50:
            status = sync_uwaterloo(cal, start, end)
        else:
            return False
        error = "" if status else "The source didn't respond or returned an error."
    except Exception as ex:
        status, error = False, f"{type(ex).__name__}"
    if status:
        cal.last_synced_at = now
    cal.last_sync_error = error
    Calendar.objects.filter(pk=cal.pk).update(last_synced_at=cal.last_synced_at, last_sync_error=error,
                                              sync_etag=cal.sync_etag, sync_last_modified=cal.sync_last_modified)
    return status
