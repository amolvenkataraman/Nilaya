"""Calendar V2 API: roles, event validation, insights arithmetic, agenda merge."""

import datetime

import pytz
from django.test import TestCase

from users.models import ComptechUser

from .models import Calendar, Event, Subscriber, Todo

TZ = pytz.timezone("America/Toronto")


def at(day, hour, minute=0):
    return TZ.localize(datetime.datetime(2026, 11, day, hour, minute))


class CalendarApiTests(TestCase):
    def setUp(self):
        self.user = ComptechUser.objects.create_user("dee", password="pw", timezone="America/Toronto")
        self.cal = Calendar.objects.create(name="Mine", owner=self.user, colour="#123456")
        Subscriber.objects.create(calendar=self.cal, user=self.user, subscribe_type=0)
        shared_owner = ComptechUser.objects.create_user("eve", password="pw")
        self.shared = Calendar.objects.create(name="Shared", owner=shared_owner)
        Subscriber.objects.create(calendar=self.shared, user=self.user, subscribe_type=2)
        self.client.force_login(self.user)

    def test_subscribers_are_read_only_and_bad_ranges_rejected(self):
        body = {"calendar_id": self.shared.id, "name": "x", "start": at(5, 9).isoformat()}
        self.assertEqual(self.client.post("/api/v2/calendar/events", body, content_type="application/json").status_code, 403)
        body = {"calendar_id": self.cal.id, "name": "x", "start": at(5, 9).isoformat(), "end": at(5, 8).isoformat()}
        self.assertEqual(self.client.post("/api/v2/calendar/events", body, content_type="application/json").status_code, 400)

    def test_insights_split_hours_across_days_and_categories(self):
        Event.objects.create(calendar=self.cal, name="Late meeting", category=1, startdate=at(4, 23), enddate=at(5, 1))
        Event.objects.create(calendar=self.cal, name="Focus", category=2, startdate=at(5, 9), enddate=at(5, 10, 30))
        Event.objects.create(calendar=self.cal, name="Essay", startdate=at(6, 23, 59))
        r = self.client.get("/api/v2/calendar/insights?period=week&date=2026-11-04").json()
        self.assertEqual(r["totals"]["hours"], 3.5)
        self.assertEqual(r["totals"]["deadlines"], 1)
        self.assertEqual(r["totals"]["meeting_hours"], 2)
        wed, thu = r["per_day"][2], r["per_day"][3]
        self.assertEqual((wed["hours"], thu["hours"]), (1, 2.5))
        self.assertEqual(r["by_hour"][23], 1)

    def test_agenda_merges_events_and_todos_and_flags_copied_deadlines(self):
        from django.utils import timezone
        soon = timezone.now() + datetime.timedelta(days=1)
        e = Event.objects.create(calendar=self.cal, name="Essay", startdate=soon)
        Todo.objects.create(user=self.user, name="Essay", complete_by=soon, custom_info={"event_id": str(e.id)})
        kinds = {(i["kind"], i["has_todo"]) for i in self.client.get("/api/v2/calendar/agenda?days=3").json()}
        self.assertEqual(kinds, {("deadline", True), ("todo", False)})
