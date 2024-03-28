from scheduler.models import *
from Comptech.api import *

from ics import Calendar as Cal

from dateutil import parser
import requests
import pytz

def sync_ical(calendar, start, end, url=None):
    if url == None: url = calendar.calendar_url
    r = requests.get(url)
    cal = Cal(r.text)
    for i in cal.events:
        try:
            sd = i.begin.naive.replace(tzinfo=i.begin.tzinfo)
            ed = i.end.naive.replace(tzinfo=i.end.tzinfo)

            if i.all_day:
                sd = sd.replace(tzinfo=pytz.timezone('America/Toronto'))
                ed = ed.replace(tzinfo=pytz.timezone('America/Toronto'))

            if (sd >= parser.parse(start) and ed <= parser.parse(end)):
                if i.status != None and i.status.lower() == "cancelled":
                    try:
                        e = Event.objects.filter(sync_id=i.uid)[0]
                        e.delete()
                    except IndexError: pass
                else:
                    try:
                        e = Event.objects.filter(sync_id=i.uid)[0]
                    except IndexError:
                        e = Event()

                    e.name = i.name
                    e.calendar = calendar
                    e.description = i.description
                    e.allday = i.all_day
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
    r = requests.get(f"https://www.googleapis.com/calendar/v3/calendars/{url}/events?key={GOOGLE_API_KEY}&timeMin={start}&timeMax={end}&singleEvents=true&orderBy=startTime&showDeleted=true", headers= {'Authorization': f'Bearer {token}'} if token != None else None)
    res = r.json()

    for i in res["items"]:
        try:
            e_ = Event.objects.filter(sync_id=i['id'])
            if i['status'] == 'confirmed':
                try: e = e_[0]
                except IndexError: e = Event()

                e.calendar = calendar
                e.name = i['summary']
                try:
                    e.description = i['description']
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
            return print(f"A(n) {type(ex).__name__} occurred. {ex.args}")

    return True

def sync_uwaterloo(calendar, start, end):
    url = calendar.calendar_url

    r = requests.get(f"https://openapi.data.uwaterloo.ca/v3/Wcms/{url}/events", headers={'x-api-key': UWATERLOO_API_KEY})
    res = r.json()

    try:
        for i in res:
            sd = parser.parse(i['eventStartDate']).replace(tzinfo=pytz.timezone('America/Toronto'))
            ed = parser.parse(i['eventEndDate']).replace(tzinfo=pytz.timezone('America/Toronto'))

            if (sd >= parser.parse(start) and ed <= parser.parse(end)):
                try:
                    e = Event.objects.filter(sync_id=i['uniqueKey'])[0]
                except IndexError:
                    e = Event()

                e.name = i['title']
                e.calendar = calendar
                e.description = i['content']
                e.sync_id = i['uniqueKey']
                e.startdate = str(i['eventStartDate'])
                e.enddate = str(i['eventEndDate'])
                e.save()

    except Exception as ex:
        return print(f"A(n) {type(ex).__name__} occurred. {ex.args}")

    return True
