"""Notifications: delivery filtering, online-mode guard, secrets, inbox API, automatic reminders."""

import datetime
from unittest import mock

from django.test import TestCase, override_settings
from django.utils import timezone

from Comptech import netguard
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

    @override_settings(ONLINE_MODE=True)
    def test_destinations_never_this_server_or_link_local_even_online(self):
        addr = lambda ip: mock.patch("socket.getaddrinfo", return_value=[(None, None, None, None, (ip, 0))])
        for ip in ("127.0.0.1", "169.254.169.254", "::ffff:127.0.0.1", "0.0.0.0"):
            with addr(ip), self.assertRaises(channels.DeliveryError):
                channels._check_destination("http://hook.example/x")
        with addr("192.168.1.20"), mock.patch.object(netguard, "_is_own_address", return_value=False):
            channels._check_destination("http://ntfy.lan/topic")  # LAN stays allowed...
        with addr("192.168.1.20"), mock.patch.object(netguard, "_is_own_address", return_value=True):
            with self.assertRaises(channels.DeliveryError):  # ...but not this server's own LAN address
                channels._check_destination("http://ntfy.lan/topic")
        with override_settings(ONLINE_MODE=False), addr("93.184.216.34"), self.assertRaises(channels.DeliveryError):
            channels._check_destination("https://example.com/hook")

    def test_api_keys_cannot_set_up_channels_and_links_must_be_http_or_paths(self):
        from apikeys.models import ApiKey
        _key, token = ApiKey.issue(self.user, "script", ["notifications:write"])
        auth = {"HTTP_AUTHORIZATION": f"Bearer {token}"}
        r = self.client.post("/api/v2/notifications/channels", {"kind": "webhook", "name": "Out",
                             "config": {"url": "https://attacker.example/x"}}, content_type="application/json", **auth)
        self.assertEqual(r.status_code, 403)
        send = lambda url: self.client.post("/api/v2/notifications/send", {"title": "Hi", "url": url},
                                            content_type="application/json", **auth)
        self.assertEqual(send("javascript:alert(1)").status_code, 400)
        self.assertEqual(send("//evil.example/").status_code, 400)
        self.assertEqual(send("/tasks/").json()["url"], "/tasks/")
        self.assertEqual(notify(self.user, "x", url="JavaScript:alert(1)", deliver_now=False).url, "")

    def test_secrets_are_masked_and_kept_on_blank_patch(self):
        self.client.force_login(self.user)
        r = self.client.post("/api/v2/notifications/channels", {"kind": "gotify", "name": "Phone",
                             "config": {"url": "http://10.0.0.5", "token": "supersecrettoken"}}, content_type="application/json")
        self.assertEqual(r.status_code, 201)
        self.assertNotIn("supersecrettoken", r.content.decode())
        cid = r.json()["id"]
        self.client.patch(f"/api/v2/notifications/channels/{cid}", {"config": {"token": ""}}, content_type="application/json")
        self.assertEqual(NotificationChannel.objects.get(id=cid).config["token"], "supersecrettoken")

    def test_inbox_search_source_filter_and_clear_read(self):
        notify(self.user, "Dentist tomorrow", source="Calendar", deliver_now=False)
        read = notify(self.user, "Backup done", source="Tasks", deliver_now=False)
        notify(self.user, "Read later", source="Tasks", deliver_now=False)
        self.client.force_login(self.user)
        titles = lambda q: [i["title"] for i in self.client.get(f"/api/v2/notifications/?{q}").json()["items"]]
        self.assertEqual(titles("q=dentist"), ["Dentist tomorrow"])
        self.assertEqual(sorted(titles("source=Tasks")), ["Backup done", "Read later"])
        self.client.post(f"/api/v2/notifications/{read.id}/read")
        self.assertEqual(self.client.post("/api/v2/notifications/clear-read").json(), {"deleted": 1})
        self.assertEqual(len(titles("")), 2)

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
