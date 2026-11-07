"""Per-app API keys: the key works only for its apps and access level, and can't manage keys."""

import datetime

from django.test import TestCase
from django.utils import timezone

from users.models import ComptechUser

from .models import ApiKey


class ApiKeyTests(TestCase):
    def setUp(self):
        self.user = ComptechUser.objects.create_user("kim", password="pw")
        self.client.force_login(self.user)
        r = self.client.post("/api/v2/keys/", {"name": "Phone shortcut", "scopes": ["tasks:write", "calendar:read"]},
                             content_type="application/json")
        self.assertEqual(r.status_code, 201)
        self.token = r.json()["token"]
        self.key_id = r.json()["key"]["id"]
        self.client.logout()

    def call(self, method, path, token=None, header="bearer", **body):
        headers = {}
        if token:
            headers = {"HTTP_AUTHORIZATION": f"Bearer {token}"} if header == "bearer" else {"HTTP_X_API_KEY": token}
        return getattr(self.client, method)(path, body or None, content_type="application/json", **headers)

    def test_cross_app_data_needs_that_apps_scope_too(self):
        self.client.force_login(self.user)
        r = self.client.post("/api/v2/keys/", {"name": "Map", "scopes": ["places:read"]}, content_type="application/json")
        self.client.logout()
        near = self.call("get", "/api/v2/places/photos-near?latitude=43.4&longitude=-80.5", r.json()["token"])
        self.assertEqual(near.status_code, 403)  # photo links need photos:read

    def test_token_is_shown_once_and_stored_hashed(self):
        key = ApiKey.objects.get()
        self.assertTrue(self.token.startswith("nly_"))
        self.assertNotIn(self.token, key.hashed)
        self.client.force_login(self.user)
        listed = self.client.get("/api/v2/keys/").json()
        self.assertNotIn("token", listed[0])
        self.assertEqual(listed[0]["prefix"], key.prefix)

    def test_scopes_are_enforced_per_app_and_access(self):
        self.assertEqual(self.call("get", "/api/v2/tasks/overview", self.token).status_code, 200)
        self.assertEqual(self.call("post", "/api/v2/tasks/quick", self.token, text="Buy milk").status_code, 201)
        self.assertEqual(self.call("get", "/api/v2/calendar/calendars", self.token, header="x-api-key").status_code, 200)
        self.assertEqual(self.call("post", "/api/v2/calendar/calendars", self.token, name="X").status_code, 403)
        self.assertEqual(self.call("get", "/api/v2/photos/summary", self.token).status_code, 403)

    def test_keys_made_before_the_rename_keep_working(self):
        from apikeys.models import _digest
        key = ApiKey.objects.get()
        old = "old_" + self.token[4:]  # any earlier 3-letter prefix; the stored hash covers the whole token
        key.hashed = _digest(old)
        key.save(update_fields=["hashed"])
        self.assertEqual(self.call("get", "/api/v2/tasks/overview", old).status_code, 200)
        self.assertEqual(self.call("get", "/api/v2/tasks/overview", self.token).status_code, 401)

    def test_keys_cannot_manage_keys_and_bad_keys_are_rejected(self):
        self.assertEqual(self.call("get", "/api/v2/keys/", self.token).status_code, 401)
        self.assertEqual(self.call("get", "/api/v2/tasks/overview", self.token[:-2] + "xx").status_code, 401)
        self.assertEqual(self.call("get", "/api/v2/tasks/overview", "nonsense").status_code, 401)

    def test_revoked_expired_and_inactive_keys_stop_working(self):
        key = ApiKey.objects.get()
        key.expires_on = timezone.now() - datetime.timedelta(minutes=1)
        key.save()
        self.assertEqual(self.call("get", "/api/v2/tasks/overview", self.token).status_code, 401)
        key.expires_on = None
        key.save()
        self.client.force_login(self.user)
        self.assertEqual(self.client.delete(f"/api/v2/keys/{self.key_id}").status_code, 204)
        self.client.logout()
        self.assertEqual(self.call("get", "/api/v2/tasks/overview", self.token).status_code, 401)

    def test_creation_validates_scopes_and_records_use(self):
        self.client.force_login(self.user)
        bad = self.client.post("/api/v2/keys/", {"name": "x", "scopes": ["keys:write"]}, content_type="application/json")
        self.assertEqual(bad.status_code, 400)
        self.client.logout()
        self.call("get", "/api/v2/tasks/overview", self.token)
        self.assertIsNotNone(ApiKey.objects.get().last_used_on)

    def test_app_guides_follow_key_scopes(self):
        r = self.call("get", "/api/v2/tasks/guide.md", self.token)
        self.assertEqual(r.status_code, 200)
        self.assertIn("POST /api/v2/tasks/quick", r.content.decode())
        self.assertEqual(self.call("get", "/api/v2/photos/guide.md", self.token).status_code, 403)
