"""V2 parity with the classic Photos actions: albums, sharing, covers, library visibility, ingest."""

import datetime
from unittest import mock

from django.test import TestCase
from django.utils import timezone

from notifications.models import Notification
from users.models import ComptechUser

from .models import Album, Album_Subscriber, Photo, ShareAlbum, ShareAlbum_Photo


class AlbumParityTests(TestCase):
    def setUp(self):
        self.me = ComptechUser.objects.create_user("ali", password="pw")
        self.friend = ComptechUser.objects.create_user("bea", password="pw")
        self.cam = Album.objects.create(name="Camera", owner=self.me, location="/x/")
        self.phone = Album.objects.create(name="Phone", owner=self.me, location="/y/")
        for a in (self.cam, self.phone):
            Album_Subscriber.objects.create(album=a, user=self.me, subscribe_type=0)
        now = timezone.now()
        self.p1 = Photo.objects.create(owner=self.me, album=self.cam, filepath="a.jpg", orientation="1", date_taken=now)
        self.p2 = Photo.objects.create(owner=self.me, album=self.phone, filepath="b.jpg", orientation="1",
                                       date_taken=now - datetime.timedelta(hours=1))
        self.client.force_login(self.me)

    def j(self, method, path, body=None):
        return getattr(self.client, method)("/api/v2/photos" + path, body, content_type="application/json")

    def test_create_edit_cover_share_and_delete_an_album(self):
        a = self.j("post", "/albums", {"name": "Trip", "description": "June", "public": False}).json()
        self.j("post", f"/albums/{a['id']}/photos", {"ids": [str(self.p1.id), str(self.p2.id)]})
        r = self.j("patch", f"/albums/{a['id']}", {"name": "Trip 2026", "cover_photo_id": str(self.p2.id)}).json()
        self.assertEqual((r["name"], r["cover"]["id"]), ("Trip 2026", str(self.p2.id)))
        m = self.j("post", f"/albums/{a['id']}/members", {"username": "bea", "role": "viewer"})
        self.assertEqual(m.status_code, 201)
        self.assertTrue(Notification.objects.filter(user=self.friend, title__contains="Trip 2026").exists())
        self.assertEqual([x["username"] for x in self.j("get", f"/albums/{a['id']}/members").json()], ["bea"])
        self.client.force_login(self.friend)  # viewers can't edit or delete
        self.assertEqual(self.j("patch", f"/albums/{a['id']}", {"name": "x"}).status_code, 404)
        self.client.force_login(self.me)
        self.assertEqual(self.j("delete", f"/albums/{a['id']}").status_code, 204)
        self.assertEqual(Photo.objects.count(), 2)  # deleting an album keeps the photos
        self.assertFalse(ShareAlbum_Photo.objects.exists())

    def test_library_visibility_filters_listings_but_not_direct_access(self):
        ids = lambda: {p["id"] for p in self.j("get", "/timeline").json()["items"]}
        self.assertEqual(ids(), {str(self.p1.id), str(self.p2.id)})
        self.j("post", f"/libraries/{self.phone.id}/only")  # Camera switched off
        self.assertEqual(ids(), {str(self.p2.id)})
        self.assertEqual(self.j("get", f"/{self.p1.id}").status_code, 200)  # still openable
        self.j("patch", f"/libraries/{self.cam.id}", {"visible": True})
        self.assertEqual(ids(), {str(self.p1.id), str(self.p2.id)})

    def test_timeline_range_and_ingest(self):
        after = (timezone.now() - datetime.timedelta(minutes=30)).isoformat()
        got = self.client.get("/api/v2/photos/timeline", {"after": after}).json()["items"]
        self.assertEqual([p["id"] for p in got], [str(self.p1.id)])
        with mock.patch("photos.tasks.ingest_all_photos.delay") as delay:
            self.assertEqual(self.j("post", "/ingest").status_code, 202)
        delay.assert_called_once()
        self.client.force_login(self.friend)  # owns/edits no library
        self.assertEqual(self.j("post", "/ingest").status_code, 403)
