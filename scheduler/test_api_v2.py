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

    def test_inactive_calendars_are_hidden_unless_asked_for(self):
        Event.objects.create(calendar=self.cal, name="Old plan", startdate=at(5, 9), enddate=at(5, 10))
        Calendar.objects.filter(id=self.cal.id).update(active=False)
        rng = {"start": at(1, 0).isoformat(), "end": at(30, 0).isoformat()}
        names = lambda **q: [e["name"] for e in self.client.get("/api/v2/calendar/events", {**rng, **q}).json()]
        self.assertEqual(names(), [])
        self.assertEqual(names(calendar=self.cal.id), ["Old plan"])
        self.assertEqual(names(include_inactive="true"), ["Old plan"])

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


class InsightsMergeTests(TestCase):
    def test_same_named_categories_from_different_owners_merge(self):
        from .models import EventCategory
        me = ComptechUser.objects.create_user("mia", password="pw", timezone="America/Toronto")
        other = ComptechUser.objects.create_user("ola", password="pw")
        mine = Calendar.objects.create(name="Mine", owner=me)
        family = Calendar.objects.create(name="Family", owner=other)
        Subscriber.objects.create(calendar=mine, user=me, subscribe_type=0)
        Subscriber.objects.create(calendar=family, user=me, subscribe_type=2)
        my_meeting = EventCategory.objects.create(owner=me, name="Meeting", colour="#123456")
        their_meeting = EventCategory.objects.create(owner=other, name="meeting", colour="#abcdef")
        for cal, cat, day in ((mine, my_meeting, 4), (family, their_meeting, 5)):
            e = Event.objects.create(calendar=cal, name="Sync", startdate=at(day, 10), enddate=at(day, 11))
            e.set_category(cat)
            e.save()
        self.client.force_login(me)
        rows = self.client.get("/api/v2/calendar/insights?period=week&date=2026-11-04").json()["by_category"]
        meeting = [r for r in rows if r["name"].lower() == "meeting"]
        self.assertEqual(len(meeting), 1)
        self.assertEqual((meeting[0]["hours"], meeting[0]["events"], meeting[0]["id"], meeting[0]["colour"]),
                         (2, 2, my_meeting.id, "#123456"))



class AvailabilityTests(TestCase):
    def test_availability_only_shows_calendars_shared_as_busy(self):
        me = ComptechUser.objects.create_user("eli", password="pw")
        other = ComptechUser.objects.create_user("fin", password="pw", timezone="America/Toronto")
        shared = Calendar.objects.create(name="Work", owner=other)
        private = Calendar.objects.create(name="Private", owner=other)
        Subscriber.objects.create(calendar=shared, user=other, subscribe_type=0, display_busy=2)
        Subscriber.objects.create(calendar=private, user=other, subscribe_type=0, display_busy=0)
        Event.objects.create(calendar=shared, name="Standup", startdate=at(5, 9), enddate=at(5, 10))
        Event.objects.create(calendar=private, name="Doctor", startdate=at(5, 11), enddate=at(5, 12))
        self.client.force_login(me)
        busy = self.client.get("/api/v2/calendar/availability/fin?date=2026-11-05").json()["busy"]
        self.assertEqual(len(busy), 1)
        self.assertNotIn("name", busy[0])  # only times, never what the event is


class PrivateAndMovedSeriesTests(TestCase):
    def setUp(self):
        self.owner = ComptechUser.objects.create_user("gus", password="pw", timezone="America/Toronto")
        self.sub = ComptechUser.objects.create_user("hal", password="pw", timezone="America/Toronto")
        self.a = Calendar.objects.create(name="A", owner=self.owner)
        self.b = Calendar.objects.create(name="B", owner=self.owner)
        for c in (self.a, self.b):
            Subscriber.objects.create(calendar=c, user=self.owner, subscribe_type=0)
        Subscriber.objects.create(calendar=self.b, user=self.sub, subscribe_type=2)

    def test_private_events_stay_masked_in_tasks_from_event(self):
        e = Event.objects.create(calendar=self.b, name="Doctor", startdate=at(20, 9), enddate=at(20, 10),
                                 visibility="private", created_by=self.owner)
        self.client.force_login(self.sub)
        self.assertEqual(self.client.post(f"/api/v2/tasks/from-event/{e.id}").status_code, 404)
        self.assertFalse(Todo.objects.filter(user=self.sub).exists())

    def test_moving_a_series_takes_its_changed_occurrences_along(self):
        self.client.force_login(self.owner)
        body = {"calendar_id": self.a.id, "name": "Class", "start": at(2, 9).isoformat(), "end": at(2, 10).isoformat(),
                "rrule": "FREQ=WEEKLY;COUNT=4"}
        series = self.client.post("/api/v2/calendar/events", body, content_type="application/json").json()
        occ = f"{series['id']}:{at(9, 9).astimezone(datetime.timezone.utc):%Y-%m-%dT%H:%M:%SZ}"
        r = self.client.patch(f"/api/v2/calendar/events/{occ}?scope=this", {"name": "Class (room 2)"},
                              content_type="application/json")
        self.assertEqual(r.status_code, 200, r.content)
        r = self.client.patch(f"/api/v2/calendar/events/{series['id']}?scope=all", {"calendar_id": self.b.id},
                              content_type="application/json")
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(set(Event.objects.values_list("calendar_id", flat=True)), {self.b.id})
        self.client.force_login(self.sub)  # subscribed to B only: used to be a KeyError (500)
        r = self.client.get("/api/v2/calendar/events", {"start": at(1, 0).isoformat(), "end": at(30, 0).isoformat()})
        self.assertEqual(r.status_code, 200)
        self.assertEqual([e["name"] for e in r.json()], ["Class", "Class (room 2)", "Class", "Class"])

    def test_moving_a_series_a_week_across_dst_keeps_its_exceptions(self):
        self.client.force_login(self.owner)
        local = lambda m, d: TZ.localize(datetime.datetime(2026, m, d, 9))
        key = lambda m, d: local(m, d).astimezone(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        body = {"calendar_id": self.a.id, "name": "W", "start": local(10, 26).isoformat(),
                "end": (local(10, 26) + datetime.timedelta(hours=1)).isoformat(), "rrule": "FREQ=WEEKLY;COUNT=6"}
        sid = self.client.post("/api/v2/calendar/events", body, content_type="application/json").json()["id"]
        for d in (9, 16):  # consecutive overrides: moving by one period used to hit the unique constraint (500)
            self.client.patch(f"/api/v2/calendar/events/{sid}:{key(11, d)}?scope=this", {"name": f"W{d}"},
                              content_type="application/json")
        self.client.delete(f"/api/v2/calendar/events/{sid}:{key(11, 23)}?scope=this")
        r = self.client.patch(f"/api/v2/calendar/events/{sid}?scope=all",  # Oct 26 EDT -> Nov 2 EST: 169 hours
                              {"start": local(11, 2).isoformat(), "end": (local(11, 2) + datetime.timedelta(hours=1)).isoformat()},
                              content_type="application/json")
        self.assertEqual(r.status_code, 200, r.content)
        r = self.client.get("/api/v2/calendar/events", {"start": at(1, 0).isoformat(), "end": local(12, 10).isoformat()})
        got = [(e["name"], datetime.datetime.fromisoformat(e["start"]).astimezone(TZ).strftime("%m-%d %H:%M")) for e in r.json()]
        self.assertEqual(got, [("W", "11-02 09:00"), ("W", "11-09 09:00"), ("W9", "11-16 09:00"), ("W16", "11-23 09:00"),
                               ("W", "12-07 09:00")])  # Nov 30 is the deleted one, moved along
