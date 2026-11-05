from scheduler.models import *
from Comptech.api import *

from ics import Calendar as Cal

from dateutil import parser
import bleach
import datetime
import requests
import pytz

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

def sync_ical(calendar, start, end, url=None):
    if url == None: url = calendar.calendar_url
    try:
        r = requests.get(url, timeout=SYNC_TIMEOUT)
        r.raise_for_status()
        cal = Cal(r.text)
    except Exception as ex:
        print(f"iCal fetch/parse failed for {calendar.name}: {type(ex).__name__} {ex.args}")
        return False
    toronto = pytz.timezone('America/Toronto')
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
                sd = toronto.localize(datetime.datetime(sd.year, sd.month, sd.day, 0, 0))
                ed = toronto.localize(datetime.datetime(ed.year, ed.month, ed.day, 0, 0))
                if sd.date() == ed.date(): ed = ed + datetime.timedelta(days=1)

            if (sd >= parser.parse(start) and ed <= parser.parse(end)):
                if i.status != None and i.status.lower() == "cancelled":
                    try:
                        e = Event.objects.filter(calendar=calendar, sync_id=i.uid)[0]
                        e.delete()
                    except IndexError: pass
                else:
                    try:
                        e = Event.objects.filter(calendar=calendar, sync_id=i.uid)[0]
                    except IndexError:
                        e = Event()

                    e.name = _clean(i.name)
                    e.calendar = calendar
                    e.description = _clean_desc(i.description)
                    e.allday = is_all_day
                    e.sync_id = i.uid
                    e.startdate = sd
                    e.enddate = ed
                    e.save()

        except Exception as ex:
            print(f"A(n) {type(ex).__name__} occurred. {ex.args}")

    return True

def sync_google(calendar, start, end, token, url=None):
    fields = str("items(kind,summary,start,end)")

    if url == None: url = calendar.calendar_url
    r = requests.get(f"https://www.googleapis.com/calendar/v3/calendars/{url}/events?key={GOOGLE_API_KEY}&timeMin={start}&timeMax={end}&singleEvents=true&orderBy=startTime&showDeleted=true", headers= {'Authorization': f'Bearer {token}'} if token != None else None, timeout=SYNC_TIMEOUT)
    res = r.json()

    for i in res["items"]:
        try:
            e_ = Event.objects.filter(calendar=calendar, sync_id=i['id'])
            if i['status'] == 'confirmed':
                try: e = e_[0]
                except IndexError: e = Event()

                e.calendar = calendar
                e.name = _clean(i['summary'])
                try:
                    e.description = _clean_desc(i['description'])
                except KeyError: pass

                e.sync_id = i['id']
                try:
                    e.startdate = i['start']['dateTime']
                except KeyError:
                    e.startdate = i['start']['date']
                    e.allday = True
                try:
                    e.enddate = i['end']['dateTime']
                except KeyError:
                    e.enddate = i['end']['date']
                    e.allday = True

                e.save()
            else: e_.delete()

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
