"""ICS and Google import keep repeating events as series (RRULE/EXDATE), changed occurrences as
overrides, cancelled occurrences as EXDATEs, and mark events that left the feed. HTTP is mocked."""

import datetime as dt
import json
from pathlib import Path
from unittest import mock
from zoneinfo import ZoneInfo

from django.test import TestCase

from users.models import ComptechUser

from .models import Calendar, Event, Subscriber
from .sync import sync_google, sync_ical

DATA = Path(__file__).resolve().parent / "testdata"
TZ = ZoneInfo("America/Toronto")
WINDOW = ("2026-10-01T00:00:00-04:00", "2027-06-01T00:00:00-04:00")


def response(body, status=200, headers=None):
    r = mock.Mock(status_code=status, headers=headers or {}, content=body if isinstance(body, bytes) else body.encode())
    r.json.return_value = json.loads(body) if isinstance(body, str) and body.startswith("{") else None
    r.raise_for_status.return_value = None
    return r


class SyncTests(TestCase):
    def setUp(self):
        self.user = ComptechUser.objects.create_user("syn", password="pw")
        self.cal = Calendar.objects.create(name="Feed", owner=self.user, calendar_type=1, calendar_url="https://x/f.ics")
        Subscriber.objects.create(calendar=self.cal, user=self.user, subscribe_type=0)
        self.client.force_login(self.user)

    def local(self, start, end):
        r = self.client.get("/api/v2/calendar/events", {"start": start.isoformat(), "end": end.isoformat()})
        self.assertEqual(r.status_code, 200, r.content)
        return [(e["name"], dt.datetime.fromisoformat(e["start"]).astimezone(TZ).strftime("%m-%d %H:%M"))
                for e in r.json()]

    def ics(self, name, **headers):
        with mock.patch("scheduler.sync.requests.get", return_value=response((DATA / name).read_bytes(), headers=headers)) as g:
            self.assertTrue(sync_ical(self.cal, *WINDOW, conditional=True))
        self.assertEqual(self.cal.last_ingest["skipped"], 0)
        return g

    def test_ics_series_exdate_override_cancelled_yearly_and_removal(self):
        self.ics("feed.ics", ETag='"v1"')
        series = Event.objects.get(sync_id="weekly-1@example.org")
        self.assertEqual((series.rrule, series.time_zone), ("FREQ=WEEKLY;UNTIL=20261215T140000Z", "America/Toronto"))
        self.assertEqual(series.exdates, ["2026-11-10T14:00:00Z", "2026-11-24T14:00:00Z"])  # EXDATE + cancelled one
        self.assertEqual(Event.objects.get(sync_id="weekly-1@example.org|2026-11-17T14:00:00Z").recurrence_parent, series)
        nov = self.local(dt.datetime(2026, 10, 26, tzinfo=TZ), dt.datetime(2026, 12, 1, tzinfo=TZ))
        self.assertEqual(nov, [("Standup", "10-27 09:00"), ("Standup", "11-03 09:00"),  # 9:00 on both sides of DST
                               ("Dentist", "11-05 10:00"), ("Standup (moved)", "11-17 11:00")])
        bday = self.client.get("/api/v2/calendar/events", {"start": "2027-03-01T00:00:00-05:00",
                                                           "end": "2027-04-01T00:00:00-04:00"}).json()
        self.assertEqual([(b["name"], b["start_date"], b["transparency"]) for b in bday],
                         [("Sam's birthday", "2027-03-15", "free")])
        legacy = self.client.get("/calendar/api/events/", {"month": 11, "year": 2026}).json()["data"]["events"]
        self.assertEqual(sorted(x["name"] for x in legacy), ["Dentist", "Standup", "Standup (moved)"])  # Nov 3, 5, 17
        self.assertEqual(self.cal.sync_etag, '"v1"')

        # later: the dentist was deleted at the source and the move was undone
        g = self.ics("feed_later.ics")
        self.assertEqual(g.call_args.kwargs["headers"], {"If-None-Match": '"v1"'})
        dentist = Event.objects.get(sync_id="single-1@example.org")
        self.assertEqual(dentist.status, "cancelled")  # kept, hidden
        self.assertIn("removed_from_source", dentist.custom_info)
        nov = self.local(dt.datetime(2026, 11, 15, tzinfo=TZ), dt.datetime(2026, 12, 1, tzinfo=TZ))
        self.assertEqual(nov, [("Standup", "11-17 09:00")])
        self.assertEqual(Event.objects.filter(calendar=self.cal).count(), 3)  # series, birthday, dentist (no duplicates)

    def test_ics_not_modified_skips_the_import(self):
        with mock.patch("scheduler.sync.requests.get", return_value=response(b"", status=304)):
            self.assertEqual(sync_ical(self.cal, *WINDOW, conditional=True), "not_modified")
        self.assertFalse(Event.objects.exists())

    def test_google_recurring_master_exceptions_and_cancellations(self):
        self.cal.calendar_type = 2
        body = (DATA / "google_events.json").read_text()
        Event.objects.create(calendar=self.cal, name="Old", sync_id="g3", startdate=dt.datetime(2026, 11, 2, 9, tzinfo=TZ),
                             enddate=dt.datetime(2026, 11, 2, 10, tzinfo=TZ))
        with mock.patch("scheduler.sync.requests.get", return_value=response(body)) as g:
            self.assertTrue(sync_google(self.cal, *WINDOW, None))
        self.assertEqual(g.call_args.kwargs["params"]["singleEvents"], "false")
        gym = Event.objects.get(sync_id="g1")
        self.assertEqual((gym.rrule, gym.time_zone), ("FREQ=WEEKLY;BYDAY=TU;UNTIL=20261231T235959Z", "America/Toronto"))
        self.assertEqual(Event.objects.get(sync_id="g3").status, "cancelled")
        nov = self.local(dt.datetime(2026, 10, 26, tzinfo=TZ), dt.datetime(2026, 12, 1, tzinfo=TZ))
        self.assertEqual(nov, [("Gym", "10-27 18:00"), ("Gym", "11-03 18:00"), ("Gym (late)", "11-17 20:00")])
        xmas = self.client.get("/api/v2/calendar/events", {"start": "2026-12-25T00:00:00-05:00",
                                                           "end": "2026-12-26T00:00:00-05:00"}).json()
        self.assertEqual([(x["name"], x["kind"], x["start_date"], x["transparency"]) for x in xmas],
                         [("Holiday", "all_day", "2026-12-25", "free")])
