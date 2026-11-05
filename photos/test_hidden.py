"""Hidden photos: invisible everywhere unless the owner turns on show-hidden for this session."""

from django.test import TestCase
from django.utils import timezone

from apikeys.models import ApiKey
from users.models import ComptechUser

from .models import Album, Album_Subscriber, Photo


class HiddenPhotoTests(TestCase):
    def setUp(self):
        self.owner = ComptechUser.objects.create_user("hal", password="pw")
        self.friend = ComptechUser.objects.create_user("ivy", password="pw")
        album = Album.objects.create(name="Camera", owner=self.owner, location="/tmp/p/")
        for u in (self.owner, self.friend):
            Album_Subscriber.objects.create(album=album, user=u, subscribe_type=0 if u == self.owner else 2)
        self.shown = Photo.objects.create(owner=self.owner, album=album, filepath="a.jpg", orientation="1", date_taken=timezone.now())
        self.secret = Photo.objects.create(owner=self.owner, album=album, filepath="b.jpg", orientation="1", date_taken=timezone.now())

    def ids(self):
        return {p["id"] for p in self.client.get("/api/v2/photos/timeline").json()["items"]}

    def test_hide_then_show_hidden_only_for_owner_session(self):
        self.client.force_login(self.owner)
        r = self.client.post("/api/v2/photos/hide", {"ids": [str(self.secret.id)], "hidden": True}, content_type="application/json")
        self.assertEqual(r.json(), {"changed": 1})
        self.assertEqual(self.ids(), {str(self.shown.id)})
        self.assertEqual(self.client.get(f"/api/v2/photos/{self.secret.id}").status_code, 404)
        self.client.post("/api/v2/photos/hidden-mode", {"show": True}, content_type="application/json")
        self.assertEqual(self.ids(), {str(self.shown.id), str(self.secret.id)})
        self.client.force_login(self.friend)  # a subscriber never sees it, even with the mode on
        self.client.post("/api/v2/photos/hidden-mode", {"show": True}, content_type="application/json")
        self.assertEqual(self.ids(), {str(self.shown.id)})

    def test_only_the_owner_can_hide_and_keys_cannot_reveal(self):
        self.client.force_login(self.friend)
        r = self.client.post("/api/v2/photos/hide", {"ids": [str(self.shown.id)], "hidden": True}, content_type="application/json")
        self.assertEqual(r.json(), {"changed": 0})
        self.secret.hidden = True
        self.secret.save()
        _, token = ApiKey.issue(self.owner, "k", ["photos:write"])
        self.client.logout()
        r = self.client.post("/api/v2/photos/hidden-mode", {"show": True}, content_type="application/json",
                             HTTP_AUTHORIZATION=f"Bearer {token}")
        self.assertEqual(r.status_code, 403)

    def test_show_hidden_expires(self):
        self.secret.hidden = True
        self.secret.save()
        self.client.force_login(self.owner)
        self.client.post("/api/v2/photos/hidden-mode", {"show": True}, content_type="application/json")
        session = self.client.session
        session["photos_hidden_until"] = timezone.now().timestamp() - 1
        session.save()
        self.assertEqual(self.ids(), {str(self.shown.id)})
