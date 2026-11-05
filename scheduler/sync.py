from scheduler.models import *
from Comptech.api import *

from ics import Calendar as Cal

from dateutil import parser
import bleach
import datetime
import requests
import pytz

from django.utils import timezone
from scheduler import recurrence as rec

# Timeout (seconds) for all outbound sync requests
SYNC_TIMEOUT = 30

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
    v = (value or "").lower()
    return v if v in ("tentative", "cancelled") else "confirmed"


def _upsert(calendar, sync_id, existing=None):
    if existing is not None:
        return existing
    e = Event.objects.filter(calendar=calendar, sync_id=sync_id).first()
    return e or Event(calendar=calendar, sync_id=sync_id)


def _set_all_day(e, start_day, end_day):
    """All-day imports keep their dates as-is (no time-zone shifting); end is exclusive."""
    e.kind, e.allday = "all_day", True
    e.start_date = start_day
    e.end_date = end_day if end_day and end_day > start_day else start_day + datetime.timedelta(days=1)
    e.startdate = e.enddate = None  # derived from the dates on save


def _set_timed(e, start, end):
    e.kind, e.allday = ("event" if end is not None else "deadline"), False
    e.start_date = e.end_date = None
    e.startdate, e.enddate = start, end


def sync_ical(calendar, start, end, url=None, conditional=False):
    """Import an ICS feed. Returns True, False (fetch/parse failed) or "not_modified" (HTTP 304).
    Cancelled items are marked cancelled (hidden by default), not deleted."""
    if url == None: url = calendar.calendar_url
    headers = {}
    if conditional:
        if calendar.sync_etag: headers["If-None-Match"] = calendar.sync_etag
        if calendar.sync_last_modified: headers["If-Modified-Since"] = calendar.sync_last_modified
    try:
        r = requests.get(url, timeout=SYNC_TIMEOUT, headers=headers)
        if r.status_code == 304:
            return "not_modified"
        r.raise_for_status()
        cal = Cal(r.text)
    except Exception as ex:
        print(f"iCal fetch/parse failed for {calendar.name}: {type(ex).__name__} {ex.args}")
        return False
    calendar.sync_etag = (r.headers.get("ETag") or "")[:256]
    calendar.sync_last_modified = (r.headers.get("Last-Modified") or "")[:64]
    tz = calendar.tz
    lo, hi = parser.parse(start), parser.parse(end)
    for i in cal.events:
        try:
            sd = i.begin.datetime
            ed = i.end.datetime

            is_all_day = i.all_day or (
                sd.date() == ed.date() and
                sd.time() == datetime.time(0, 0) and
                ed.time() == datetime.time(0, 0)
            )
            if is_all_day:
                first, last = sd.date(), ed.date()
                sd, ed = rec.local_midnight(first, tz), rec.local_midnight(max(last, first + datetime.timedelta(days=1)), tz)

            if (sd >= lo and ed <= hi):
                e = _upsert(calendar, i.uid)
                if e.pk is None and _status(i.status) == "cancelled":
                    continue
                e.name = _clean(i.name)
                e.calendar = calendar
                e.description = _clean_desc(i.description)
                e.status = _status(i.status)
                if is_all_day:
                    _set_all_day(e, first, last)
                else:
                    _set_timed(e, sd, ed)
                e.save()

        except Exception as ex:
            print(f"A(n) {type(ex).__name__} occurred. {ex.args}")

    return True

def sync_google(calendar, start, end, token, url=None):
    if url == None: url = calendar.calendar_url
    try:
        r = requests.get(f"https://www.googleapis.com/calendar/v3/calendars/{url}/events?key={GOOGLE_API_KEY}&timeMin={start}&timeMax={end}&singleEvents=true&orderBy=startTime&showDeleted=true", headers= {'Authorization': f'Bearer {token}'} if token != None else None, timeout=SYNC_TIMEOUT)
        res = r.json()
        items = res["items"]
    except Exception as ex:
        print(f"Google fetch failed for {calendar.name}: {type(ex).__name__} {ex.args}")
        return False

    for i in items:
        try:
            e_ = Event.objects.filter(calendar=calendar, sync_id=i['id']).first()
            status = _status(i.get('status'))
            if status == 'cancelled':
                if e_ is not None:
                    e_.status = 'cancelled'
                    e_.save(update_fields=["status"])
                continue
            e = _upsert(calendar, i['id'], e_)
            e.calendar = calendar
            e.name = _clean(i.get('summary') or 'Untitled')
            if 'description' in i:
                e.description = _clean_desc(i['description'])
            e.status = status
            if i.get('transparency') == 'transparent':
                e.transparency = 'free'
            if 'dateTime' in i['start']:
                _set_timed(e, i['start']['dateTime'], i['end'].get('dateTime'))
            else:
                _set_all_day(e, datetime.date.fromisoformat(i['start']['date']),
                             datetime.date.fromisoformat(i['end']['date']) if i['end'].get('date') else None)
            e.save()

        except Exception as ex:
            print(f"A(n) {type(ex).__name__} occurred. {ex.args}")

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
