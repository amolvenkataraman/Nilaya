"""Photos V2 API: only photos from albums you subscribe to; cursor paging."""

import datetime

from django.test import TestCase
from django.utils import timezone

from users.models import ComptechUser

from .models import Album, Album_Subscriber, Photo


class PhotosApiTests(TestCase):
    def setUp(self):
        self.user = ComptechUser.objects.create_user("fay", password="pw")
        self.stranger = ComptechUser.objects.create_user("gus", password="pw")
        album = Album.objects.create(name="Camera", owner=self.user, location="/tmp/photos/")
        Album_Subscriber.objects.create(album=album, user=self.user, subscribe_type=0)
        base = timezone.now()
        self.photos = [Photo.objects.create(owner=self.user, album=album, filepath=f"p{i}.jpg", orientation="1",
                                            date_taken=base - datetime.timedelta(hours=i)) for i in range(3)]

    def test_timeline_pages_with_a_cursor(self):
        self.client.force_login(self.user)
        first = self.client.get("/api/v2/photos/timeline?limit=2").json()
        self.assertEqual(len(first["items"]), 2)
        rest = self.client.get("/api/v2/photos/timeline", {"limit": 2, "before": first["next_before"]}).json()
        self.assertEqual([p["id"] for p in rest["items"]], [str(self.photos[2].id)])
        self.assertIsNone(rest["next_before"])

    def test_other_users_cannot_see_the_library(self):
        self.client.force_login(self.stranger)
        self.assertEqual(self.client.get(f"/api/v2/photos/{self.photos[0].id}").status_code, 404)
        self.assertEqual(self.client.get("/api/v2/photos/summary").json()["photos"], 0)
