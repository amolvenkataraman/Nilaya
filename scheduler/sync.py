from scheduler.models import *
from Comptech.api import GOOGLE_API_KEY

from ics import Calendar as Cal

import requests

def sync_ical(calendar, start=None, end=None):
    r = requests.get(calendar.calendar_url)
    cal = Cal(r.text)
    for i in cal.events:
        try:
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
                e.sync_id = i.uid
                e.startdate = str(i.begin)
                e.enddate = str(i.end)
                e.save()

        except Exception as ex:
            print(f"A(n) {type(ex).__name__} occurred. {ex.args}")

    return True

def sync_google(calendar, start, end, token):
    fields = str("items(kind,summary,start,end)")

    r = requests.get(f"https://www.googleapis.com/calendar/v3/calendars/{calendar.calendar_url}/events?key={GOOGLE_API_KEY}&timeMin={start}&timeMax={end}&singleEvents=true&orderBy=startTime&showDeleted=true", headers= {'Authorization': f'Bearer {token}'} if token != None else None)
    res = r.json()

    for i in res["items"]:
        try:
            e_ = Event.objects.filter(sync_id=i['id'])
            if i['status'] == 'confirmed':
                try: e = e_[0]
                except IndexError: e = Event()

                e.calendar = calendar
                e.name = i['summary']
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
