"""ICS feeds: private token URLs for calendars and tasks."""

import datetime

from django.test import TestCase
from django.utils import timezone

from scheduler.models import Calendar, Event, Subscriber, Todo
from users.models import ComptechUser


class FeedTests(TestCase):
    def setUp(self):
        self.user = ComptechUser.objects.create_user("kai", password="pw")
        cal = Calendar.objects.create(name="Mine", owner=self.user)
        Subscriber.objects.create(calendar=cal, user=self.user, subscribe_type=0)
        other = Calendar.objects.create(name="Not mine", owner=ComptechUser.objects.create_user("lee", password="pw"))
        soon = timezone.now() + datetime.timedelta(days=2)
        Event.objects.create(calendar=cal, name="Lunch, then\nwalk", startdate=soon, enddate=soon + datetime.timedelta(hours=1))
        Event.objects.create(calendar=other, name="Secret", startdate=soon, enddate=soon + datetime.timedelta(hours=1))
        Todo.objects.create(user=self.user, name="File taxes", complete_by=soon)
        Todo.objects.create(user=self.user, name="Done already", complete_by=soon, completed=True)
        self.client.force_login(self.user)

    def make(self, kind):
        r = self.client.post("/api/v2/feeds/", {"kind": kind, "name": "Phone"}, content_type="application/json")
        self.assertEqual(r.status_code, 201)
        return r.json()["url"].split("://", 1)[-1].split("/", 1)[1]  # path part

    def test_calendar_feed_has_only_my_events_escaped(self):
        path = self.make("calendar")
        self.client.logout()
        r = self.client.get("/" + path)
        body = r.content.decode()
        self.assertEqual(r["Content-Type"], "text/calendar; charset=utf-8")
        self.assertIn("SUMMARY:Lunch\\, then\\nwalk", body)
        self.assertNotIn("Secret", body)
        self.assertTrue(body.startswith("BEGIN:VCALENDAR\r\n"))

    def test_tasks_feed_has_open_due_tasks_and_revoked_feeds_404(self):
        path = self.make("tasks")
        feed_id = self.client.get("/api/v2/feeds/").json()[0]["id"]
        body = self.client.get("/" + path).content.decode()
        self.assertIn("File taxes", body)
        self.assertNotIn("Done already", body)
        self.client.delete(f"/api/v2/feeds/{feed_id}")
        self.assertEqual(self.client.get("/" + path).status_code, 404)
        self.assertEqual(self.client.get("/feeds/f_deadbeef_nope.ics").status_code, 404)

    def test_others_private_events_are_busy_in_my_feed(self):
        other = ComptechUser.objects.get(username="lee")
        cal = Calendar.objects.get(name="Not mine")
        Subscriber.objects.create(calendar=cal, user=self.user, subscribe_type=2)
        soon = timezone.now() + datetime.timedelta(days=3)
        Event.objects.create(calendar=cal, name="Therapy", location="Clinic", description="notes", startdate=soon,
                             enddate=soon + datetime.timedelta(hours=1), visibility="private", created_by=other)
        body = self.client.get("/" + self.make("calendar")).content.decode()
        self.assertIn("SUMMARY:Busy", body)
        for secret in ("Therapy", "Clinic", "notes"):
            self.assertNotIn(secret, body)
