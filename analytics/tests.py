"""Usage analytics: route-level events (no ids/IPs), opt-out signals, rollups, staff-only summary."""

import datetime

from django.test import TestCase, override_settings
from django.utils import timezone

from users.models import ComptechUser

from . import buffer
from .models import ApiDaily, Daily, Event
from .tasks import rollup


@override_settings(ANALYTICS_FLUSH_EVERY=1)
class AnalyticsTests(TestCase):
    def setUp(self):
        self.user = ComptechUser.objects.create_user("jo", password="pw", is_staff=True)
        self.client.force_login(self.user)

    def test_pages_record_route_patterns_and_api_calls_are_daily_counts(self):
        self.client.get("/photos/day/2026/7/31/")
        self.client.get("/api/v2/tasks/overview")
        self.client.get("/api/v2/tasks/00000000-0000-0000-0000-000000000000")
        buffer.flush()
        e = Event.objects.get()
        self.assertEqual((e.app, e.name), ("photos", "photos/day/<int:year>/<int:month>/<int:day>/"))
        a = ApiDaily.objects.get()
        self.assertEqual((a.app, a.user, a.calls, a.client), ("tasks", self.user, 2, "web"))

    def test_skips_static_and_opt_out_signals(self):
        self.client.get("/static/css/theme.css")
        self.client.get("/notifications/", HTTP_SEC_GPC="1")
        self.client.get("/notifications/", HTTP_DNT="1")
        buffer.flush()
        self.assertFalse(Event.objects.exists())

    def test_rollup_and_staff_only_summary(self):
        for status in (200, 200, 500):
            Event.objects.create(ts=timezone.now() - datetime.timedelta(days=1), user=self.user,
                                 app="calendar", name="calendar/", client="web", device="desktop", status=status, ms=40)
        rollup((timezone.localdate() - datetime.timedelta(days=1)).isoformat())
        d = Daily.objects.get()
        self.assertEqual((d.events, d.users, d.errors), (3, 1, 1))
        self.assertEqual(self.client.get("/api/v2/analytics/summary?days=7").status_code, 200)
        self.user.is_staff = False
        self.user.save()
        self.assertEqual(self.client.get("/api/v2/analytics/summary?days=7").status_code, 403)
