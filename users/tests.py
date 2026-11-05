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
