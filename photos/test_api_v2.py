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

    def test_cursor_does_not_skip_photos_with_the_same_timestamp(self):
        same = self.photos[0].date_taken
        burst = [Photo.objects.create(owner=self.user, album=self.photos[0].album, filepath=f"b{i}.jpg", orientation="1",
                                      date_taken=same) for i in range(3)]
        self.client.force_login(self.user)
        seen, params = [], {"limit": 2}
        while True:
            page = self.client.get("/api/v2/photos/timeline", params).json()
            seen += [p["id"] for p in page["items"]]
            if not page["next_before"]:
                break
            params = {"limit": 2, "before": page["next_before"], "before_id": page["next_before_id"]}
        self.assertEqual(len(seen), len(set(seen)))
        self.assertEqual(len(seen), 3 + len(burst))

    def test_details_browse_and_filters(self):
        p = self.photos[0]
        p.camera_make, p.camera_model, p.location_city, p.location_country = "Google", "Pixel 9", "Toronto", "Canada"
        p.fnumber, p.isospeed, p.size, p.size_total, p.ai_index_info = "f/1.7", "100", 2048, 4096, {"objects": [0, 5]}
        p.save()
        self.client.force_login(self.user)
        d = self.client.get(f"/api/v2/photos/{p.id}/details").json()
        self.assertEqual((d["camera_model"], d["fnumber"], d["city"]), ("Pixel 9", "f/1.7", "Toronto"))
        self.assertEqual(sorted(o["name"] for o in d["objects"]), ["Car", "Person"])
        cams = self.client.get("/api/v2/photos/browse/cameras").json()
        self.assertEqual(cams[0]["display"], "Pixel 9 (Google)")
        objs = {o["display"]: o["count"] for o in self.client.get("/api/v2/photos/browse/objects").json()}
        self.assertEqual(objs["Person"], 1)
        ids = lambda q: [x["id"] for x in self.client.get(f"/api/v2/photos/timeline?{q}").json()["items"]]
        self.assertEqual(ids("camera=Pixel 9"), [str(p.id)])
        self.assertEqual(ids("objects=car"), [str(p.id)])

    def test_stats_and_storage(self):
        Photo.objects.filter(id=self.photos[1].id).update(video=True, size=1000, size_total=1500, length=30)
        self.client.force_login(self.user)
        s = self.client.get("/api/v2/photos/stats").json()
        self.assertEqual((s["totals"]["photos"], s["totals"]["videos"]), (2, 1))
        self.assertEqual(sum(s["by_hour"]), 3)
        st = self.client.get("/api/v2/photos/storage").json()
        self.assertEqual((st["video"]["count"], st["video"]["total_kb"], st["video"]["length_s"]), (1, 1500, 30))

    def test_counts_per_day(self):
        self.client.force_login(self.user)
        day = timezone.localdate().isoformat()
        r = self.client.get("/api/v2/photos/counts", {"start": day, "end": day}).json()
        self.assertEqual(sum(r.values()), sum(1 for p in self.photos if timezone.localdate(p.date_taken).isoformat() == day))

    def test_points_days_and_album_size(self):
        p = self.photos[0]
        Photo.objects.filter(id=p.id).update(latitude=43.47, longitude=-80.54, size_total=500, size=400)
        self.client.force_login(self.user)
        pts = self.client.get("/api/v2/photos/points", {"south": 43, "west": -81, "north": 44, "east": -80}).json()
        self.assertEqual([(round(x["lat"], 2), x["count"]) for x in pts], [(43.47, 1)])
        self.assertEqual(self.client.get("/api/v2/photos/points", {"south": 0, "west": 0, "north": 1, "east": 1}).json(), [])
        day = timezone.localdate(p.date_taken).isoformat()
        days = self.client.get("/api/v2/photos/days", {"start": day, "end": day}).json()
        self.assertEqual(days[day]["size_kb"] >= 500, True)
        self.client.force_login(self.stranger)
        self.assertEqual(self.client.get("/api/v2/photos/points", {"south": 43, "west": -81, "north": 44, "east": -80}).json(), [])

    def test_heatmap_points_leave_out_plane_photos_from_2000m(self):
        album = self.photos[0].album
        base = timezone.now()
        for i, alt in enumerate((1500, 1999, 2000, 9000)):
            Photo.objects.create(owner=self.user, album=album, filepath=f"alt{i}.jpg", orientation="1", date_taken=base,
                                 latitude=10 + i, longitude=10, altitude=alt)
        self.client.force_login(self.user)
        pts = self.client.get("/api/v2/photos/points", {"south": 0, "west": 0, "north": 20, "east": 20}).json()
        self.assertEqual(sorted(round(p["lat"]) for p in pts), [10, 11])  # 1500 m and 1999 m stay

    def test_other_users_cannot_see_the_library(self):
        self.client.force_login(self.stranger)
        self.assertEqual(self.client.get(f"/api/v2/photos/{self.photos[0].id}").status_code, 404)
        self.assertEqual(self.client.get("/api/v2/photos/summary").json()["photos"], 0)
