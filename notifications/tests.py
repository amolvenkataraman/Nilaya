"""Notifications: delivery filtering, online-mode guard, secrets, inbox API, automatic reminders."""

import datetime
from unittest import mock

from django.test import TestCase, override_settings
from django.utils import timezone

from scheduler.models import Calendar, Event, Subscriber, Todo
from users.models import ComptechUser

from . import channels
from .models import Notification, NotificationChannel, ReminderSettings
from .service import Priority, deliver, notify


class DeliveryTests(TestCase):
    def setUp(self):
        self.user = ComptechUser.objects.create_user("ana", password="pw")

    def test_deliver_respects_min_priority_and_records_errors(self):
        quiet = NotificationChannel.objects.create(user=self.user, kind="webhook", name="HA",
                                                   config={"url": "http://127.0.0.1:9/x"}, min_priority=Priority.HIGH)
        loud = NotificationChannel.objects.create(user=self.user, kind="webhook", name="Log",
                                                  config={"url": "http://127.0.0.1:9/y"})
        with mock.patch.object(channels, "send", side_effect=[channels.DeliveryError("down")]) as send:
            deliver(notify(self.user, "Hi", deliver_now=False))
        self.assertEqual(send.call_count, 1)  # only the channel whose minimum the notification meets
        loud.refresh_from_db()
        quiet.refresh_from_db()
        self.assertEqual(loud.last_error, "down")
        self.assertIsNone(quiet.last_sent_at)

    @override_settings(ONLINE_MODE=False)
    def test_offline_mode_only_allows_lan_destinations(self):
        channels._check_destination("http://127.0.0.1:8123/api/webhook/x")
        with mock.patch("socket.getaddrinfo", return_value=[(None, None, None, None, ("93.184.216.34", 0))]):
            with self.assertRaises(channels.DeliveryError):
                channels._check_destination("https://example.com/hook")

    def test_secrets_are_masked_and_kept_on_blank_patch(self):
        self.client.force_login(self.user)
        r = self.client.post("/api/v2/notifications/channels", {"kind": "gotify", "name": "Phone",
                             "config": {"url": "http://10.0.0.5", "token": "supersecrettoken"}}, content_type="application/json")
        self.assertEqual(r.status_code, 201)
        self.assertNotIn("supersecrettoken", r.content.decode())
        cid = r.json()["id"]
        self.client.patch(f"/api/v2/notifications/channels/{cid}", {"config": {"token": ""}}, content_type="application/json")
        self.assertEqual(NotificationChannel.objects.get(id=cid).config["token"], "supersecrettoken")

    def test_inbox_is_per_user_and_read_state_updates(self):
        mine = notify(self.user, "Mine", deliver_now=False)
        other = ComptechUser.objects.create_user("bo", password="pw")
        theirs = notify(other, "Theirs", deliver_now=False)
        self.client.force_login(self.user)
        data = self.client.get("/api/v2/notifications/").json()
        self.assertEqual([i["title"] for i in data["items"]], ["Mine"])
        self.assertEqual(self.client.post(f"/api/v2/notifications/{theirs.id}/read").status_code, 404)
        self.client.post(f"/api/v2/notifications/{mine.id}/read")
        self.assertEqual(self.client.get("/api/v2/notifications/unread-count").json()["unread"], 0)


class AutoReminderTests(TestCase):
    def setUp(self):
        from tasks import auto_reminders
        self.run = auto_reminders.run
        self.user = ComptechUser.objects.create_user("cy", password="pw")
        self.cal = Calendar.objects.create(name="Work", owner=self.user)
        Subscriber.objects.create(calendar=self.cal, user=self.user, subscribe_type=0)
        self.now = timezone.now().replace(second=0, microsecond=0, minute=7)

    def titles(self):
        return list(Notification.objects.filter(user=self.user).values_list("title", flat=True))

    def test_events_deadlines_and_todos_remind_once_within_their_lead(self):
        Event.objects.create(calendar=self.cal, name="Standup", startdate=self.now + datetime.timedelta(minutes=10),
                             enddate=self.now + datetime.timedelta(minutes=25))
        Event.objects.create(calendar=self.cal, name="Later", startdate=self.now + datetime.timedelta(hours=3),
                             enddate=self.now + datetime.timedelta(hours=4))
        Event.objects.create(calendar=self.cal, name="Essay", startdate=self.now + datetime.timedelta(hours=20))
        Todo.objects.create(user=self.user, name="Pay rent", complete_by=self.now + datetime.timedelta(minutes=30))
        self.run(self.now)
        self.run(self.now)  # second run sends nothing new
        titles = self.titles()
        self.assertEqual(len(titles), 3)
        self.assertTrue(any("Standup" in t for t in titles) and any("Essay" in t for t in titles)
                        and any("Pay rent" in t for t in titles))

    def test_zero_minutes_turns_a_reminder_type_off(self):
        ReminderSettings.objects.create(user=self.user, event_minutes=0)
        Event.objects.create(calendar=self.cal, name="Standup", startdate=self.now + datetime.timedelta(minutes=5),
                             enddate=self.now + datetime.timedelta(minutes=20))
        self.run(self.now)
        self.assertEqual(self.titles(), [])
