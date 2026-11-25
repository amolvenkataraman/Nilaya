"""V2 profile parity: other people's profiles, profile picture upload, password change."""

import base64
import io

from django.test import TestCase
from PIL import Image

from .models import ComptechUser


def png_bytes():
    buf = io.BytesIO()
    Image.new("RGB", (8, 8), "teal").save(buf, "PNG")
    return buf.getvalue()


class ProfileApiTests(TestCase):
    def setUp(self):
        self.me = ComptechUser.objects.create_user("cat", password="old-pass-123", first_name="Cat")
        ComptechUser.objects.create_user("dan", password="pw", first_name="Dan", description="Hi")
        self.client.force_login(self.me)

    def test_profile_picture_upload_and_others_profiles(self):
        url = "data:image/png;base64," + base64.b64encode(png_bytes()).decode()
        r = self.client.post("/api/v2/me/picture", {"data_url": url}, content_type="application/json")
        self.assertEqual(r.status_code, 200, r.content)
        self.assertTrue(r.json()["profile_picture"].endswith(".jpg"))
        bad = self.client.post("/api/v2/me/picture", {"data_url": "data:image/png;base64,bm90IGFuIGltYWdl"},
                               content_type="application/json")
        self.assertEqual(bad.status_code, 400)
        dan = self.client.get("/api/v2/users/dan").json()
        self.assertEqual((dan["username"], dan["name"], dan["description"]), ("dan", "Dan", "Hi"))
        self.assertNotIn("email", dan)
        self.assertEqual(self.client.get("/api/v2/users/nobody").status_code, 404)

    def test_password_change_checks_the_old_one_and_keeps_you_signed_in(self):
        r = self.client.post("/api/v2/me/password", {"old": "wrong", "new": "N3w-strong-pass!"}, content_type="application/json")
        self.assertEqual(r.status_code, 400)
        r = self.client.post("/api/v2/me/password", {"old": "old-pass-123", "new": "N3w-strong-pass!"}, content_type="application/json")
        self.assertEqual(r.status_code, 204)
        self.assertEqual(self.client.get("/api/v2/me").status_code, 200)  # session kept
        self.me.refresh_from_db()
        self.assertTrue(self.me.check_password("N3w-strong-pass!"))

    def test_username_change_checks_format_and_clashes(self):
        patch = lambda name: self.client.patch("/api/v2/me", {"username": name}, content_type="application/json")
        self.assertEqual(patch("DAN").status_code, 400)  # taken (case-insensitively)
        self.assertEqual(patch("no spaces").status_code, 400)
        self.assertEqual(patch("cat.2").json()["username"], "cat.2")
        me = self.client.get(f"/api/v2/users/{self.me.id}").json()  # by id too
        self.assertEqual((me["username"], me["is_staff"]), ("cat.2", False))


class SignInTests(TestCase):
    """POST /api/v2/auth/login and /logout: CSRF, safe next, failure limit."""

    def setUp(self):
        from django.core.cache import cache
        from django.test import Client

        from Comptech.tests import built_app
        cache.clear()
        self.enterContext(built_app())
        ComptechUser.objects.create_user("eve", password="right-pass-1")
        self.client = Client(enforce_csrf_checks=True)
        self.client.get("/login")  # sets the CSRF cookie

    def post(self, path, body=None, csrf=True):
        headers = {"HTTP_X_CSRFTOKEN": self.client.cookies["csrftoken"].value} if csrf else {}
        return self.client.post(path, body or {}, content_type="application/json", **headers)

    def test_sign_in_needs_csrf_and_only_goes_to_paths_on_this_site(self):
        creds = {"username": "eve", "password": "right-pass-1"}
        self.assertEqual(self.post("/api/v2/auth/login", creds, csrf=False).status_code, 403)
        for nxt, expected in (("/tasks?view=today", "/tasks?view=today"), ("//evil.example/x", "/"),
                              ("https://evil.example/", "/"), ("javascript:alert(1)", "/")):
            r = self.post("/api/v2/auth/login", {**creds, "next": nxt})
            self.assertEqual((r.status_code, r.json()["next"]), (200, expected), nxt)
        self.assertEqual(self.client.get("/api/v2/me").status_code, 200)
        self.assertEqual(self.post("/api/v2/auth/logout").status_code, 204)
        self.assertEqual(self.client.get("/api/v2/me").status_code, 401)

    def test_wrong_passwords_are_400_and_limited_per_username(self):
        for _ in range(10):
            self.assertEqual(self.post("/api/v2/auth/login", {"username": "eve", "password": "x"}).status_code, 400)
        r = self.post("/api/v2/auth/login", {"username": "EVE", "password": "right-pass-1"})
        self.assertEqual(r.status_code, 429)

    def test_failures_are_also_limited_per_address_across_usernames(self):
        from .auth_api import IP_FAIL_LIMIT
        sprayer, other = {"HTTP_X_REAL_IP": "203.0.113.7"}, {"HTTP_X_REAL_IP": "198.51.100.2"}

        def login(username, password, ip):  # signing in rotates the CSRF token, so read it each time
            return self.client.post("/api/v2/auth/login", {"username": username, "password": password},
                                    content_type="application/json",
                                    HTTP_X_CSRFTOKEN=self.client.cookies["csrftoken"].value, **ip)
        for i in range(IP_FAIL_LIMIT - 1):  # one guess per name: the per-username limit never trips
            self.assertEqual(login(f"user{i}", "x", sprayer).status_code, 400)
        self.assertEqual(login("eve", "right-pass-1", sprayer).status_code, 200)  # a success doesn't count
        self.assertEqual(login("last", "x", sprayer).status_code, 400)
        r = login("eve", "right-pass-1", sprayer)
        self.assertEqual(r.status_code, 429)
        self.assertGreater(int(r["Retry-After"]), 0)
        self.assertEqual(login("eve", "right-pass-1", other).status_code, 200)  # another address is unaffected


class PreferencesTests(TestCase):
    """Defaults until changed; only changes are stored; the day start moves late-night moments to the day before."""

    def setUp(self):
        self.user = ComptechUser.objects.create_user("pat", password="pw")
        self.client.force_login(self.user)

    def patch(self, **body):
        return self.client.patch("/api/v2/me/preferences", body, content_type="application/json")

    def test_defaults_changes_and_reset(self):
        p = self.client.get("/api/v2/me").json()["preferences"]
        self.assertEqual((p["week_start"], p["day_starts_at"], p["quiet_hours"]["enabled"]), (0, "05:00:00", False))
        self.assertEqual(self.patch(week_start=1, quiet_hours={"enabled": True, "start": "23:00", "end": "07:00"}).status_code, 200)
        self.user.refresh_from_db()
        self.assertEqual(self.user.preferences, {"week_start": 1, "quiet_hours": {"enabled": True, "start": "23:00:00", "end": "07:00:00"}})
        self.patch(week_start=None)  # back to the default: no longer stored
        self.user.refresh_from_db()
        self.assertNotIn("week_start", self.user.preferences)

    def test_invalid_values_are_rejected(self):
        self.assertEqual(self.patch(day_starts_at="13:00").status_code, 400)
        self.assertEqual(self.patch(work_start="18:00", work_end="09:00").status_code, 400)
        self.assertEqual(self.patch(units="furlongs").status_code, 422)

    def test_day_start(self):
        import datetime

        import pytz

        from . import preferences
        tz = pytz.timezone("America/Toronto")
        late = tz.localize(datetime.datetime(2026, 7, 5, 1, 30))
        self.assertEqual(preferences.local_day(self.user, late, tz), datetime.date(2026, 7, 4))
        start, end = preferences.day_bounds(self.user, datetime.date(2026, 7, 4), tz)
        self.assertEqual((start.hour, end - start), (5, datetime.timedelta(days=1)))
