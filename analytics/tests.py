"""Usage analytics: one row per person, app and day (page views + API calls); staff-only summary."""

from django.test import TestCase
from django.utils import timezone

from Comptech.tests import built_app

from users.models import ComptechUser

from .models import Usage


class UsageTests(TestCase):
    def setUp(self):
        self.user = ComptechUser.objects.create_user("jo", password="pw", is_staff=True)
        self.client.force_login(self.user)
        self.enterContext(built_app())  # pages are the app's index.html

    def test_counts_page_views_and_api_calls_per_app_per_day(self):
        self.client.get("/notifications/")
        self.client.get("/notifications/")
        self.client.get("/api/v2/tasks/overview")
        self.client.get("/static/app/theme.js")
        rows = {(u.app, u.page_views, u.api_calls) for u in Usage.objects.filter(user=self.user, day=timezone.localdate())}
        self.assertEqual(rows, {("notifications", 2, 0), ("tasks", 0, 1)})

    def test_summary_is_staff_only(self):
        self.client.get("/notifications/")
        r = self.client.get("/api/v2/analytics/summary?days=7")
        self.assertEqual(r.json()["apps"][0]["app"], "notifications")
        self.user.is_staff = False
        self.user.save()
        self.assertEqual(self.client.get("/api/v2/analytics/summary?days=7").status_code, 403)
