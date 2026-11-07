"""The app is served at / (Comptech/spa.py): public and private routes, old-URL redirects, headers."""

import contextlib
import tempfile
from pathlib import Path
from unittest import mock

from django.test import TestCase

from users.models import ComptechUser

from . import spa


@contextlib.contextmanager
def built_app():
    """A stand-in for the built index.html (the real build isn't part of the repo)."""
    with tempfile.TemporaryDirectory() as tmp:
        index = Path(tmp) / "index.html"
        index.write_text("<!doctype html><html><head><title>Nilaya</title></head><body></body></html>")
        with mock.patch.object(spa, "INDEX", index):
            yield


class SpaTests(TestCase):
    def setUp(self):
        self.enterContext(built_app())

    def test_private_routes_need_sign_in_and_public_ones_do_not(self):
        r = self.client.get("/tasks/", {"task": "x"})
        self.assertRedirects(r, "/login?next=/tasks/%3Ftask%3Dx", fetch_redirect_response=False)
        for path in ("/login", "/register", "/calendar/public/3/", "/calendar/countdown/x/start/",
                     "/calendar/availability/ann/", "/shared/albums/0b7e9d3c-1b5e-4c55-9a0e-6a1e2b3c4d5e"):
            r = self.client.get(path)
            self.assertEqual(r.status_code, 200, path)
            self.assertContains(r, '<meta name="nilaya-session" content="0">')
        self.assertIn("csrftoken", r.cookies)  # the sign-in form posts with it
        self.assertEqual(r["Cache-Control"], "no-cache")
        self.assertIn("script-src 'self'", r["Content-Security-Policy"])
        self.assertEqual(self.client.get("/photos/upload/").status_code, 404)  # removed upload portal
        self.client.force_login(ComptechUser.objects.create_user("amy", password="pw"))
        self.assertContains(self.client.get("/places"), '<meta name="nilaya-session" content="1">')
        self.assertEqual(self.client.get("/photos/upload").status_code, 404)

    def test_old_urls_redirect_to_their_routes_with_the_query(self):
        album = "0b7e9d3c-1b5e-4c55-9a0e-6a1e2b3c4d5e"
        for old, new in (("/app/", "/"), ("/app/tasks?view=today", "/tasks?view=today"),
                         ("/accounts/login/?next=/habits/", "/login?next=%2Fhabits%2F"), ("/map/", "/places"),
                         ("/settings/api-keys/", "/settings#set-api"), ("/photos/day/2024/3/9/", "/photos/day/2024-03-09"),
                         (f"/photos/?album={album}&date=2024-01-01", f"/shared/albums/{album}?date=2024-01-01"),
                         ("/photos/superlatives/biggest-raw/", "/photos/superlatives?cat=biggest-raw"),
                         ("/photos/geoguessr_ent/", "/photos/locate"), ("/accounts/profile/dan/", "/users/dan")):
            self.assertRedirects(self.client.get(old), new, status_code=301, fetch_redirect_response=False)

    def test_reserved_prefixes_are_never_the_app(self):
        for path in ("/api/v2/nope", "/feeds/nope.ics", "/static/nope.js", "/.well-known/x"):
            self.assertEqual(self.client.get(path).status_code, 404, path)
        self.assertEqual(self.client.get("/admin/").status_code, 302)  # Django admin's own sign-in
