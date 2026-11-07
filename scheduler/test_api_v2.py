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

    def test_only_the_owner_can_touch_admin_invites(self):
        from .models import Invite
        admin = ComptechUser.objects.create_user("ada", password="pw")
        Subscriber.objects.create(calendar=self.cal, user=admin, subscribe_type=1)
        inv = Invite.objects.create(calendar=self.cal, code="ADMCODE1", role=1)
        self.client.force_login(admin)
        url = f"/api/v2/calendar/calendars/{self.cal.id}/invites/{inv.id}"
        self.assertEqual(self.client.patch(url, {"max_uses": None}, content_type="application/json").status_code, 403)
        self.assertEqual(self.client.delete(url).status_code, 403)

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
        Event.objects.create(calendar=shared, name="Conference", kind="all_day", allday=True,  # all-day: not busy
                             startdate=at(5, 0), enddate=at(6, 0))
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


class ReviewFixTests(TestCase):
    """One test per bug found in the phase-1 review (privacy and robustness)."""

    def setUp(self):
        self.owner = ComptechUser.objects.create_user("ivy", password="pw", timezone="America/Toronto")
        self.sub = ComptechUser.objects.create_user("jon", password="pw", timezone="America/Toronto")
        self.cal = Calendar.objects.create(name="Family", owner=self.owner, public=True)
        Subscriber.objects.create(calendar=self.cal, user=self.owner, subscribe_type=0)
        Subscriber.objects.create(calendar=self.cal, user=self.sub, subscribe_type=2)

    def private(self, **kw):  # no created_by, like synced and pre-migration events
        return Event.objects.create(calendar=self.cal, name="Doctor", location="Clinic", startdate=at(20, 9),
                                    enddate=at(20, 10), visibility="private", **kw)

    def events(self, **q):
        r = self.client.get("/api/v2/calendar/events", {"start": at(1, 0).isoformat(), "end": at(30, 0).isoformat(), **q})
        self.assertEqual(r.status_code, 200, r.content)
        return r.json()

    def test_public_countdown_and_calendar_mask_private_events_and_hide_private_calendars(self):
        e = self.private()
        countdown = f"/api/v2/calendar/public/countdown/{e.id}?which=start"
        self.assertEqual(self.client.get(countdown).json()["name"], "Busy")  # anonymous
        r = self.client.get(f"/api/v2/calendar/public/calendars/{self.cal.id}/events",
                            {"start": at(1, 0).isoformat(), "end": at(30, 0).isoformat()})
        self.assertEqual([(x["name"], x["location"], x["busy"]) for x in r.json()], [("Busy", None, True)])
        self.assertIsNone(self.client.get(f"/api/v2/calendar/public/calendars/{self.cal.id}").json()["subscribed"])
        self.client.force_login(self.owner)
        self.assertEqual(self.client.get(countdown).json()["name"], "Doctor")
        self.client.logout()
        Calendar.objects.filter(id=self.cal.id).update(public=False)
        self.assertEqual(self.client.get(f"/api/v2/calendar/public/calendars/{self.cal.id}").status_code, 404)
        self.assertEqual(self.client.get(countdown).status_code, 404)  # private event, private calendar
        self.client.force_login(self.sub)  # a plain subscriber neither
        self.assertEqual(self.client.get(countdown).status_code, 404)

    def test_subscribing_to_a_public_calendar_by_id(self):
        other = ComptechUser.objects.create_user("lea", password="pw")
        self.client.force_login(other)
        url = f"/api/v2/calendar/public/calendars/{self.cal.id}/subscribe"
        self.assertEqual(self.client.post(url).status_code, 201)
        self.assertTrue(self.client.get(f"/api/v2/calendar/public/calendars/{self.cal.id}").json()["subscribed"])
        Calendar.objects.filter(id=self.cal.id).update(public=False)
        self.client.force_login(ComptechUser.objects.create_user("max", password="pw"))
        self.assertEqual(self.client.post(url).status_code, 404)

    def test_search_and_tag_never_match_a_masked_event(self):
        self.private(tags=["health"])
        self.client.force_login(self.sub)
        self.assertEqual([x["name"] for x in self.events()], ["Busy"])
        self.assertEqual((self.events(q="Doc"), self.events(tag="health")), ([], []))
        self.client.force_login(self.owner)
        self.assertEqual([x["name"] for x in self.events(q="Doc")], ["Doctor"])

    def test_automatic_reminders_mask_private_events_and_never_copy_them_to_others(self):
        from django.utils import timezone
        from notifications.models import Notification, ReminderSettings
        from tasks import auto_reminders
        now = timezone.now().replace(second=0, microsecond=0, minute=0)
        Event.objects.create(calendar=self.cal, name="Doctor", location="Clinic", visibility="private",
                             startdate=now + datetime.timedelta(minutes=10), enddate=now + datetime.timedelta(minutes=40))
        Event.objects.create(calendar=self.cal, name="Secret essay", description="notes", visibility="private",
                             startdate=now + datetime.timedelta(days=3))
        for u in (self.owner, self.sub):
            ReminderSettings.objects.create(user=u, deadlines_to_todos=True)
        auto_reminders.run(now)
        mine = Notification.objects.filter(user=self.sub).values_list("title", "description")
        self.assertTrue(mine and all("Doctor" not in t and "Clinic" not in (d or "") for t, d in mine), list(mine))
        self.assertIn("Doctor", Notification.objects.filter(user=self.owner).values_list("title", flat=True)[0])
        self.assertEqual(list(Todo.objects.values_list("user__username", flat=True)), ["ivy"])

    def test_rules_with_line_breaks_are_refused_and_a_bad_stored_rule_is_skipped(self):
        from tasks import auto_reminders
        self.client.force_login(self.owner)
        body = {"calendar_id": self.cal.id, "name": "x", "start": at(5, 9).isoformat(),
                "rrule": "FREQ=DAILY;BYDAY=MO\nRDATE:20261110T090000Z"}
        self.assertEqual(self.client.post("/api/v2/calendar/events", body, content_type="application/json").status_code, 400)
        Event.objects.create(calendar=self.cal, name="Fine", startdate=at(5, 9), enddate=at(5, 10))
        bad = Event.objects.create(calendar=self.cal, name="Bad", startdate=at(5, 9), enddate=at(5, 10), rrule="FREQ=DAILY")
        Event.objects.filter(id=bad.id).update(rrule="FREQ=DAILY;BYDAY=MO\nRDATE:20261110T090000Z")  # an old row
        with self.assertLogs("scheduler.service", "ERROR"):
            self.assertEqual([x["name"] for x in self.events()], ["Fine"])
            auto_reminders.run()

    def test_rules_that_never_match_are_refused_and_cheap_to_list(self):
        import time
        from . import recurrence as rec
        with self.assertRaises(ValueError):
            rec.normalize_rrule("FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=30", TZ)
        # a 7-day step from a Thursday never lands on a Monday: stored anyway (e.g. by an old client)
        Event.objects.create(calendar=self.cal, name="Never", startdate=at(5, 9), enddate=at(5, 10),
                             rrule="FREQ=DAILY;INTERVAL=7;BYDAY=MO")
        Subscriber.objects.filter(calendar=self.cal, user=self.owner).update(display_busy=2)
        t = time.monotonic()
        r = self.client.get("/api/v2/calendar/availability/ivy", {"date": "2026-11-09"})  # anyone, signed out too
        self.assertEqual((r.status_code, r.json()["busy"]), (200, []))
        self.client.force_login(self.owner)
        self.assertEqual(self.events(), [])
        self.assertLess(time.monotonic() - t, 0.3)

    def test_times_without_a_zone_are_local_not_a_500(self):
        self.client.force_login(self.owner)
        r = self.client.get("/api/v2/calendar/events", {"start": "2026-11-01T00:00:00", "end": "2026-11-30T00:00:00"})
        self.assertEqual(r.status_code, 200)
        body = {"calendar_id": self.cal.id, "name": "Naive", "start": "2026-11-05T09:00:00", "end": "2026-11-05T10:00:00"}
        r = self.client.post("/api/v2/calendar/events", body, content_type="application/json")
        self.assertEqual(r.status_code, 201, r.content)
        self.assertEqual(Event.objects.get(name="Naive").startdate, at(5, 9))

    def test_a_moved_occurrence_does_not_reappear_at_its_old_time_in_availability_or_search(self):
        Subscriber.objects.filter(calendar=self.cal, user=self.owner).update(display_busy=2)
        s = Event.objects.create(calendar=self.cal, name="Gym", startdate=at(2, 9), enddate=at(2, 10), rrule="FREQ=DAILY")
        self.client.force_login(self.owner)
        occ = f"{s.id}:{at(5, 9).astimezone(datetime.timezone.utc):%Y-%m-%dT%H:%M:%SZ}"
        r = self.client.patch(f"/api/v2/calendar/events/{occ}?scope=this", {"name": "Swim", "transparency": "free"},
                              content_type="application/json")
        self.assertEqual(r.status_code, 200, r.content)
        busy = self.client.get("/api/v2/calendar/availability/ivy?date=2026-11-05").json()["busy"]
        self.assertEqual(busy, [])
        day = {"start": at(5, 0).isoformat(), "end": at(6, 0).isoformat()}
        found = lambda q: [x["name"] for x in self.client.get("/api/v2/calendar/events", {**day, "q": q}).json()]
        self.assertEqual((found("Gym"), found("Swim")), ([], ["Swim"]))

    def test_this_and_following_keeps_count_with_rdates(self):
        s = Event.objects.create(calendar=self.cal, name="Class", startdate=at(2, 9), enddate=at(2, 10),
                                 rrule="FREQ=DAILY;COUNT=5", rdates=["2026-11-01T14:00:00Z"])
        self.client.force_login(self.owner)
        r = self.client.patch(f"/api/v2/calendar/events/{s.id}:2026-11-04T14:00:00Z?scope=following", {"name": "Class 2"},
                              content_type="application/json")
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(Event.objects.get(name="Class 2").rrule, "FREQ=DAILY;COUNT=3")  # Nov 4, 5, 6

    def test_only_the_owner_can_reactivate_an_admin_invite(self):
        from .models import Invite
        admin = ComptechUser.objects.create_user("kim", password="pw")
        Subscriber.objects.create(calendar=self.cal, user=admin, subscribe_type=1)
        inv = Invite.objects.create(calendar=self.cal, code="ADM00001", role=1, active=False)
        self.client.force_login(admin)
        r = self.client.patch(f"/api/v2/calendar/calendars/{self.cal.id}/invites/{inv.id}", {"active": True},
                              content_type="application/json")
        self.assertEqual(r.status_code, 403)
        inv.refresh_from_db()
        self.assertFalse(inv.active)
