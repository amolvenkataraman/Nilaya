"""Calendar schema overhaul: kinds and all-day dates, categories, colours, recurrence (DST,
exdates, this/following/all edits), reminders, invites, availability, the V2 calendar
management endpoints, attendees, tags and the ICS export."""

import datetime as dt
import json
from zoneinfo import ZoneInfo

from django.test import TestCase, override_settings
from django.utils import timezone

from notifications.models import Notification
from users.models import ComptechUser

from .models import Calendar, Event, EventCategory, EventReminder, Invite, Subscriber

TZ = ZoneInfo("Canada/Eastern")
UTC = dt.timezone.utc


def at(y, m, d, h=0, mi=0):
    return dt.datetime(y, m, d, h, mi, tzinfo=TZ)


class Base(TestCase):
    def setUp(self):
        self.ann = ComptechUser.objects.create_user("ann", password="pw", timezone="America/Toronto")
        self.bob = ComptechUser.objects.create_user("bob", password="pw")
        self.cal = Calendar.objects.create(name="Mine", owner=self.ann, colour="#112233")
        self.ann_sub = Subscriber.objects.create(calendar=self.cal, user=self.ann, subscribe_type=0)
        self.client.force_login(self.ann)

    def api(self, method, path, body=None):
        r = getattr(self.client, method)("/api/v2/calendar" + path, json.dumps(body) if body is not None else None,
                                         content_type="application/json")
        return r

    def weekly(self, **kw):
        """Tuesdays 9:00–10:00 local from Oct 20, 2026 (DST ends Nov 1)."""
        return Event.objects.create(calendar=self.cal, name="Standup", startdate=at(2026, 10, 20, 9),
                                    enddate=at(2026, 10, 20, 10), rrule=kw.pop("rrule", "FREQ=WEEKLY"), **kw)

    def ids_in(self, start, end, **params):
        q = "&".join(f"{k}={v}" for k, v in params.items())
        r = self.client.get("/api/v2/calendar/events", {"start": start.isoformat(), "end": end.isoformat(), **params})
        self.assertEqual(r.status_code, 200, r.content)
        return r.json()


class ModelTests(Base):
    def test_kind_dates_category_and_colour_follow_legacy_fields(self):
        # an old-style all-day save (UTC datetimes, allday flag) gets dates and local midnights
        e = Event.objects.create(calendar=self.cal, name="Trip", allday=True, category=6,
                                 startdate="2026-11-07T05:00:00Z", enddate="2026-11-09T05:00:00Z")
        e.refresh_from_db()
        self.assertEqual((e.kind, e.start_date, e.end_date), ("all_day", dt.date(2026, 11, 7), dt.date(2026, 11, 9)))
        self.assertEqual(e.startdate, at(2026, 11, 7))
        due = Event.objects.create(calendar=self.cal, name="Essay", startdate=at(2026, 11, 10, 23))
        self.assertEqual((due.kind, due.transparency), ("deadline", "free"))
        # categories: lazily created defaults, the old number kept in sync
        self.assertEqual(e.event_category.name, "Personal")
        self.assertEqual(EventCategory.objects.filter(owner=self.ann).count(), 10)  # the defaults
        # retired columns still read/write through properties (custom_info / visibility)
        e.priority, e.completed, e.public = 15, True, True
        e.save()
        e.refresh_from_db()
        self.assertEqual((e.priority, e.completed, e.visibility), (15, True, "public"))
        # colour precedence: event → category → subscriber → calendar
        self.assertEqual(e.display_colour(None), "#112233")
        self.assertEqual(e.display_colour("#445566"), "#445566")
        e.event_category.colour = "#778899"
        self.assertEqual(e.display_colour("#445566"), "#778899")
        e.colour = "#aabbcc"
        self.assertEqual(e.display_colour("#445566"), "#aabbcc")
        # editing the datetimes of an all-day event (legacy UI) moves its dates
        e.startdate, e.enddate = "2026-11-08T05:00:00Z", "2026-11-11T05:00:00Z"
        e.save()
        self.assertEqual((e.start_date, e.end_date), (dt.date(2026, 11, 8), dt.date(2026, 11, 11)))


class RecurrenceTests(Base):
    def test_weekly_event_stays_at_9_local_across_dst_and_skips_exdates(self):
        s = self.weekly(exdates=["2026-11-10T14:00:00Z"])
        got = self.ids_in(at(2026, 10, 26), at(2026, 11, 20))
        local = [dt.datetime.fromisoformat(e["start"]).astimezone(TZ) for e in got]
        self.assertEqual([(d.day, d.hour) for d in local], [(27, 9), (3, 9), (17, 9)])  # Nov 10 excluded
        self.assertEqual(got[1]["id"], f"{s.id}:2026-11-03T14:00:00Z")
        self.assertTrue(all(e["series_id"] == str(s.id) and e["recurring"] for e in got))
        self.assertEqual(got[0]["recurrence_text"], "Every week")
        # the legacy month payload expands too
        r = self.client.get("/calendar/api/events/", {"month": 11, "year": 2026}).json()["data"]["events"]
        self.assertEqual(len(r), 3)
        self.assertTrue({"id", "name", "startdate", "enddate", "allday", "category", "location", "description",
                         "completed", "public", "priority", "calendar"} <= set(r[0]))

    def test_this_following_and_all_edits(self):
        s = self.weekly(rrule="FREQ=WEEKLY;COUNT=6")  # Oct 20 … Nov 24
        occ = f"{s.id}:2026-11-03T14:00:00Z"
        # this: an override row for one occurrence
        r = self.api("patch", f"/events/{occ}?scope=this", {"name": "Moved", "start": at(2026, 11, 3, 11).isoformat(),
                                                             "end": at(2026, 11, 3, 12).isoformat()})
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual((r.json()["id"], r.json()["name"]), (occ, "Moved"))
        names = [(e["name"], dt.datetime.fromisoformat(e["start"]).astimezone(TZ).hour)
                 for e in self.ids_in(at(2026, 11, 1), at(2026, 11, 8))]
        self.assertEqual(names, [("Moved", 11)])
        # delete one occurrence → EXDATE
        self.assertEqual(self.api("delete", f"/events/{s.id}:2026-11-10T14:00:00Z").status_code, 204)
        # following: split at Nov 17, renamed and an hour later
        r = self.api("patch", f"/events/{s.id}:2026-11-17T14:00:00Z?scope=following",
                     {"name": "Late standup", "start": at(2026, 11, 17, 10).isoformat()})
        self.assertEqual(r.status_code, 200, r.content)
        new_id = r.json()["series_id"]
        self.assertNotEqual(new_id, str(s.id))
        got = [(e["name"], dt.datetime.fromisoformat(e["start"]).astimezone(TZ).strftime("%d %H"))
               for e in self.ids_in(at(2026, 10, 1), at(2027, 1, 1))]
        self.assertEqual(got, [("Standup", "20 09"), ("Standup", "27 09"), ("Moved", "03 11"),
                               ("Late standup", "17 10"), ("Late standup", "24 10")])  # COUNT 6 kept in total
        # all: moving one occurrence by +30 min moves the whole (new) series and keeps the override
        r = self.api("patch", f"/events/{new_id}:2026-11-24T15:00:00Z?scope=all",
                     {"start": at(2026, 11, 24, 10, 30).isoformat(), "end": at(2026, 11, 24, 11, 30).isoformat()})
        self.assertEqual(r.status_code, 200, r.content)
        last = self.ids_in(at(2026, 11, 15), at(2027, 1, 1))
        self.assertEqual([dt.datetime.fromisoformat(e["start"]).astimezone(TZ).strftime("%d %H:%M") for e in last],
                         ["17 10:30", "24 10:30"])
        self.assertEqual(self.api("get", f"/events/{occ}").json()["name"], "Moved")


    def test_following_split_keeps_count_when_the_form_resends_the_same_rule(self):
        s = Event.objects.create(calendar=self.cal, name="Daily", startdate=at(2026, 11, 10, 9),
                                 enddate=at(2026, 11, 10, 10), rrule="FREQ=DAILY;COUNT=5")
        r = self.api("patch", f"/events/{s.id}:2026-11-12T14:00:00Z?scope=following",
                     {"name": "Daily (new)", "rrule": "FREQ=DAILY;COUNT=5"})
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(len(self.ids_in(at(2026, 11, 1), at(2026, 12, 1))), 5)  # 2 + 3, not 2 + 5


class ReminderTests(Base):
    def setUp(self):
        super().setUp()
        from tasks import auto_reminders
        self.run = auto_reminders.run
        self.now = timezone.now().replace(second=0, microsecond=0, minute=7)
        self.bob_sub = Subscriber.objects.create(calendar=self.cal, user=self.bob)

    def titles(self, user):
        return list(Notification.objects.filter(user=user).values_list("title", flat=True))

    def test_event_reminders_override_the_global_lead_and_mute_silences_a_calendar(self):
        later = Event.objects.create(calendar=self.cal, name="Dentist", startdate=self.now + dt.timedelta(hours=20),
                                     enddate=self.now + dt.timedelta(hours=21))
        EventReminder.objects.create(event=later, minutes_before=1440)
        EventReminder.objects.create(event=later, minutes_before=60)
        soon = Event.objects.create(calendar=self.cal, name="Standup", startdate=self.now + dt.timedelta(minutes=10),
                                    enddate=self.now + dt.timedelta(minutes=20))
        EventReminder.objects.create(event=soon, minutes_before=5)  # replaces the global 15 min: not yet
        Event.objects.create(calendar=self.cal, name="Off", status="cancelled", startdate=self.now + dt.timedelta(minutes=5),
                             enddate=self.now + dt.timedelta(minutes=30))
        self.bob_sub.notify = False
        self.bob_sub.save()
        self.run(self.now)
        self.run(self.now)
        self.assertEqual([t.split(" ·")[0] for t in self.titles(self.ann)], ["Dentist"])
        self.assertEqual(self.titles(self.bob), [])
        self.run(self.now + dt.timedelta(minutes=6))  # Standup's own 5-minute lead
        self.assertEqual(len(self.titles(self.ann)), 2)

    def test_repeating_events_remind_per_occurrence(self):
        start = self.now + dt.timedelta(minutes=10)
        Event.objects.create(calendar=self.cal, name="Pills", startdate=start - dt.timedelta(days=3),
                             enddate=start - dt.timedelta(days=3) + dt.timedelta(minutes=5), rrule="FREQ=DAILY")
        self.run(self.now)
        self.assertEqual(len(self.titles(self.ann)), 1)


class InviteAndAvailabilityTests(Base):
    def test_invite_expiry_max_uses_and_role_in_both_flows(self):
        inv = Invite.objects.create(calendar=self.cal, code="ONE", max_uses=1, role=1)
        self.client.force_login(self.bob)
        self.assertEqual(self.client.post("/calendar/api/subscribe/?code=ONE").json()["status"], "success")
        self.assertEqual(Subscriber.objects.get(user=self.bob, calendar=self.cal).subscribe_type, 1)
        carl = ComptechUser.objects.create_user("carl", password="pw")
        self.client.force_login(carl)
        self.assertIn("used up", self.client.post("/calendar/api/subscribe/?code=ONE").json()["data"])
        Invite.objects.create(calendar=self.cal, code="OLD", expires_on=timezone.now() - dt.timedelta(minutes=1))
        r = self.client.post("/api/v2/calendar/subscribe?code=OLD")
        self.assertEqual((r.status_code, r.json()["detail"]), (410, "Invite code has expired"))
        inv.refresh_from_db()
        self.assertEqual(inv.uses, 1)

    def test_free_and_cancelled_events_never_block_availability(self):
        self.ann_sub.display_busy = 2
        self.ann_sub.save()
        mk = lambda h, **kw: Event.objects.create(calendar=self.cal, name="x", startdate=at(2026, 11, 5, h),
                                                  enddate=at(2026, 11, 5, h + 1), **kw)
        mk(9)
        mk(11, transparency="free")
        mk(13, status="cancelled")
        mk(15, status="tentative")
        busy = self.client.get("/calendar/api/availability/ann/?date=2026-11-05").json()["data"]["busy"]
        self.assertEqual([dt.datetime.fromisoformat(b[0]).astimezone(TZ).hour for b in busy], [9, 15])


class CalendarManagementTests(Base):
    def test_roles_detail_subscribers_invites_sync_and_delete(self):
        bob_sub = Subscriber.objects.create(calendar=self.cal, user=self.bob, subscribe_type=2)
        self.cal.calendar_type, self.cal.calendar_url = 1, "https://example.com/x.ics"
        self.cal.save()
        d = self.api("get", f"/calendars/{self.cal.id}").json()
        self.assertEqual((d["role"], d["sync"]["url"], d["subscriber_count"]), ("owner", "https://example.com/x.ics", 2))
        r = self.api("patch", f"/calendars/{self.cal.id}", {"icon": "book", "description": "Hi", "notify": False,
                                                             "my_colour": "#00ff00", "sync": {"past_months": 2}})
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual((r.json()["icon"], r.json()["my_colour"], r.json()["notify"], r.json()["sync"]["past_months"]),
                         ("book", "#00ff00", False, 2))
        self.assertEqual(self.api("patch", f"/calendars/{self.cal.id}", {"icon": "nope"}).status_code, 400)
        inv = self.api("post", f"/calendars/{self.cal.id}/invites", {"expires_in_days": 7, "max_uses": 3}).json()
        self.assertTrue(inv["expires_on"] and inv["usable"] and len(inv["code"]) == 8)
        subs = self.api("get", f"/calendars/{self.cal.id}/subscribers").json()
        self.assertEqual([s["role"] for s in subs], ["owner", "subscriber"])
        self.assertEqual(self.api("patch", f"/calendars/{self.cal.id}/subscribers/{bob_sub.id}",
                                  {"role": "admin"}).json()["role"], "admin")
        self.assertEqual(self.api("delete", f"/calendars/{self.cal.id}/subscribers/{self.ann_sub.id}").status_code, 400)
        with override_settings(ONLINE_MODE=False):
            self.assertEqual(self.api("post", f"/calendars/{self.cal.id}/sync").status_code, 503)
        # bob (admin now): sees the URL, can't delete; a stranger gets 404
        self.client.force_login(self.bob)
        self.assertEqual(self.api("get", f"/calendars/{self.cal.id}").json()["sync"]["url"], "https://example.com/x.ics")
        self.assertEqual(self.api("delete", f"/calendars/{self.cal.id}?confirm=Mine").status_code, 403)
        self.client.force_login(ComptechUser.objects.create_user("eve", password="pw"))
        self.assertEqual(self.api("get", f"/calendars/{self.cal.id}/invites").status_code, 404)
        self.client.force_login(self.ann)
        self.assertEqual(self.api("delete", f"/calendars/{self.cal.id}?confirm=mine").status_code, 400)
        self.assertEqual(self.api("delete", f"/calendars/{self.cal.id}?confirm=Mine").status_code, 204)
        self.assertFalse(Calendar.objects.filter(id=self.cal.id).exists())


class EventApiTests(Base):
    def test_create_with_new_fields_filter_by_tag_and_categories(self):
        cat = self.api("post", "/categories", {"name": "Gym", "colour": "#ff0000", "icon": "dumbbell"}).json()
        body = {"calendar_id": self.cal.id, "name": "Lift", "start": at(2026, 11, 5, 18).isoformat(),
                "end": at(2026, 11, 5, 19).isoformat(), "category_id": cat["id"], "tags": ["Health", "health", "gym"],
                "meeting_url": "https://meet.example/x", "reminders": [30, 10], "icon": "run",
                "rrule": "FREQ=WEEKLY;UNTIL=20261130"}
        r = self.api("post", "/events", body)
        self.assertEqual(r.status_code, 201, r.content)
        e = r.json()
        self.assertEqual((e["tags"], e["display_colour"], e["category"]["name"], e["reminders"], e["created_by"]),
                         (["Health", "gym"], "#ff0000", "Gym", [30, 10], str(self.ann.id)))
        self.assertTrue(e["rrule"].endswith("UNTIL=20261201T045959Z"))
        self.assertEqual(self.api("post", "/events", {**body, "meeting_url": "javascript:alert(1)"}).status_code, 400)
        self.assertEqual(len(self.ids_in(at(2026, 11, 1), at(2026, 12, 15), tag="GYM")), 4)
        self.assertEqual(self.ids_in(at(2026, 11, 1), at(2026, 12, 15), tag="work"), [])
        # all-day by dates
        r = self.api("post", "/events", {"calendar_id": self.cal.id, "name": "Off", "start_date": "2026-12-24",
                                         "end_date": "2026-12-27"}).json()
        self.assertEqual((r["kind"], r["start_date"], r["end_date"]), ("all_day", "2026-12-24", "2026-12-27"))
        # deleting a category moves its events to Uncategorized
        self.assertEqual(self.api("delete", f"/categories/{cat['id']}").status_code, 204)
        self.assertEqual(Event.objects.get(id=e["id"]).event_category.legacy_id, 0)

    def test_attendees_from_contacts_update_last_contacted(self):
        from contacts.models import Person
        p = Person.objects.create(owner=self.ann, first_name="Zoe", emails=[{"label": "home", "value": "zoe@x.org"}])
        past = Event.objects.create(calendar=self.cal, name="Coffee", startdate=at(2026, 10, 2, 9),
                                    enddate=at(2026, 10, 2, 10))
        r = self.api("post", f"/events/{past.id}/attendees", {"contact_id": str(p.id), "rsvp": "accepted"})
        self.assertEqual(r.status_code, 201, r.content)
        self.assertEqual((r.json()["name"], r.json()["email"]), ("Zoe", "zoe@x.org"))
        p.refresh_from_db()
        self.assertEqual(p.last_contacted, dt.date(2026, 10, 2))
        self.assertEqual(len(self.api("get", f"/events/{past.id}").json()["attendees"]), 1)
        self.assertEqual(self.api("delete", f"/events/{past.id}/attendees/{r.json()['id']}").status_code, 204)

    def test_private_events_show_as_busy_to_subscribers(self):
        Subscriber.objects.create(calendar=self.cal, user=self.bob)
        Event.objects.create(calendar=self.cal, name="Therapy", visibility="private", created_by=self.ann,
                             startdate=at(2026, 11, 5, 9), enddate=at(2026, 11, 5, 10))
        self.client.force_login(self.bob)
        e = self.ids_in(at(2026, 11, 5), at(2026, 11, 6))[0]
        self.assertEqual((e["name"], e["masked"]), ("Busy", True))


class FeedTests(Base):
    def test_ics_exports_rrule_exdate_override_tags_and_colour(self):
        s = self.weekly(exdates=["2026-11-10T14:00:00Z"], tags=["team"], colour="#abcdef")
        r = self.api("patch", f"/events/{s.id}:2026-11-17T14:00:00Z?scope=this", {"name": "Moved"})
        self.assertEqual(r.status_code, 200)
        url = self.client.post("/api/v2/feeds/", {"kind": "calendar", "name": "Phone"},
                               content_type="application/json").json()["url"]
        body = self.client.get("/" + url.split("://", 1)[-1].split("/", 1)[1]).content.decode().replace("\r\n ", "")
        self.assertIn("DTSTART;TZID=Canada/Eastern:20261020T090000", body)
        self.assertIn("RRULE:FREQ=WEEKLY", body)
        self.assertIn("EXDATE;TZID=Canada/Eastern:20261110T090000", body)
        self.assertIn("RECURRENCE-ID;TZID=Canada/Eastern:20261117T090000", body)
        self.assertIn("CATEGORIES:Mine,team", body)
        self.assertIn("COLOR:#abcdef", body)
        self.assertIn("BEGIN:VTIMEZONE", body)
        self.assertEqual(body.count("BEGIN:VEVENT"), 2)


class LegacyApiTests(Base):
    def test_old_ui_create_edit_occurrence_and_delete(self):
        post = lambda path, body: self.client.post(path, json.dumps(body) if not isinstance(body, str) else body,
                                                   content_type="application/json").json()
        base = {"calendar": self.cal.id, "category": 5, "name": "Shift", "description": "", "public": False,
                "priority": 12, "type": "event", "start": "2026-11-05T14:00:00Z", "end": "2026-11-05T15:00:00Z"}
        self.assertEqual(post("/calendar/api/create/", {**base, "command": "add"})["status"], "success")
        e = Event.objects.get(name="Shift")
        self.assertEqual((e.kind, e.event_category.name, e.priority, e.created_by_id), ("event", "Work", 12, self.ann.id))
        s = self.weekly()
        occ = f"{s.id}:2026-11-03T14:00:00Z"
        r = post("/calendar/api/create/", {**base, "command": "edit", "old_id": occ, "name": "Standup (late)",
                                           "start": "2026-11-03T15:00:00Z", "end": "2026-11-03T16:00:00Z"})
        self.assertEqual(r["status"], "success")
        self.assertEqual(post("/calendar/api/delete/", f"{s.id}:2026-11-10T14:00:00Z")["status"], "success")
        evs = self.client.get("/calendar/api/events/", {"month": 11, "year": 2026}).json()["data"]["events"]
        standups = [(x["name"], x["startdate"][:10]) for x in evs if x.get("series_id") == str(s.id)]
        self.assertEqual(standups, [("Standup (late)", "2026-11-03"), ("Standup", "2026-11-17"), ("Standup", "2026-11-24")])
        self.assertEqual(Event.objects.get(id=s.id).name, "Standup")  # the series itself is untouched
