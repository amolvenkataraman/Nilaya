import datetime
from unittest import mock

from django.test import TestCase
from django.utils import timezone

from users.models import ComptechUser

from .models import Album, Album_Subscriber, Photo, ShareAlbum, ShareAlbum_Photo


class TimelineFilterTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.user = ComptechUser.objects.create_user("pat", password="pw")
        album = Album.objects.create(name="Phone", owner=cls.user, location="/tmp/")
        Album_Subscriber.objects.create(album=album, user=cls.user, subscribe_type=0)

        def photo(day, **kw):
            when = timezone.make_aware(datetime.datetime(*day, 12, 0))
            return Photo.objects.create(owner=cls.user, album=album, filepath=f"{day}.jpg", orientation="",
                                        date_taken=when, **kw)

        cls.paris = photo((2024, 3, 10), location_city="Paris", location_country="France", latitude=48.85,
                          longitude=2.35, camera_make="Canon", camera_model="R6", size_total=300)
        cls.toronto = photo((2024, 3, 2), location_city="Toronto", location_country="Canada", latitude=43.65,
                            longitude=-79.38)
        cls.old = photo((2023, 1, 5))

    def ids(self, **q):
        self.client.force_login(self.user)
        r = self.client.get("/api/v2/photos/timeline", q)
        self.assertEqual(r.status_code, 200, r.content)
        return [p["id"] for p in r.json()["items"]]

    def test_free_text_camera_make_map_area_and_oldest_first(self):
        self.assertEqual(self.ids(q="paRI"), [str(self.paris.id)])
        self.assertEqual(self.ids(camera_make="can"), [str(self.paris.id)])
        self.assertEqual(self.ids(north=50, south=40, east=5, west=-90), [str(self.paris.id), str(self.toronto.id)])
        first = self.client.get("/api/v2/photos/timeline", {"order": "oldest", "limit": 2}).json()
        self.assertEqual([p["id"] for p in first["items"]], [str(self.old.id), str(self.toronto.id)])
        rest = self.ids(order="oldest", before=first["next_before"], before_id=first["next_before_id"])
        self.assertEqual(rest, [str(self.paris.id)])


class SuperlativesTests(TestCase):
    def test_rankings_count_an_imported_original_once_and_rank_days(self):
        user = ComptechUser.objects.create_user("sup", password="pw")
        album = Album.objects.create(name="Camera", owner=user, location="/tmp/")
        Album_Subscriber.objects.create(album=album, user=user, subscribe_type=0)
        day = timezone.make_aware(datetime.datetime(2024, 5, 1, 12))
        mk = lambda name, **kw: Photo.objects.create(owner=user, album=album, filepath=name, orientation="", date_taken=day, **kw)
        clip = mk("clip.mp4", video=True, length=90, size=1000, size_total=5000, orig_filepath="clip_orig.mov")
        mk("clip_orig.mov", video=True, length=90, size=4000, size_total=4000)  # the original, imported again
        raw = mk("p.jpg", size=200, size_total=900, raw_filepath="p.cr2", megapixels=24.0)
        self.client.force_login(user)
        get = lambda cat: self.client.get(f"/api/v2/photos/superlatives/{cat}", {"limit": 20}).json()
        self.assertEqual([i["id"] for i in get("biggest-files")["items"]], [str(clip.id), str(raw.id)])
        self.assertEqual([i["id"] for i in get("biggest-orig-videos")["items"]], [str(clip.id)])
        self.assertEqual([i["id"] for i in get("biggest-raw")["items"]], [str(raw.id)])
        self.assertEqual(get("biggest-overhead")["summary"]["count"], 2)
        days = get("day-longest-video-time")["days"]
        self.assertEqual([(d["date"], d["videos"], d["length_s"]) for d in days], [("2024-05-01", 1, 90)])


class PublicAlbumTests(TestCase):
    """What signed-out visitors may use: public shared albums."""

    @classmethod
    def setUpTestData(cls):
        cls.owner = ComptechUser.objects.create_user("ann", password="pw", first_name="Ann")
        album = Album.objects.create(name="Camera", owner=cls.owner, location="/tmp/")
        when = timezone.make_aware(datetime.datetime(2024, 3, 10, 12))
        cls.shown = Photo.objects.create(owner=cls.owner, album=album, filepath="a.jpg", orientation="", date_taken=when)
        secret = Photo.objects.create(owner=cls.owner, album=album, filepath="b.jpg", orientation="", date_taken=when,
                                      hidden=True)
        cls.album = ShareAlbum.objects.create(owner=cls.owner, name="Trip", public=True, cover_photo=secret)
        for p in (cls.shown, secret):
            ShareAlbum_Photo.objects.create(sharealbum=cls.album, photo=p)

    def test_public_albums_show_without_hidden_photos_and_private_ones_only_to_members(self):
        info = self.client.get(f"/api/v2/photos/public/albums/{self.album.id}").json()
        self.assertEqual((info["name"], info["owner"], info["photos"], info["member"]), ("Trip", "Ann", 1, False))
        self.assertIn(str(self.shown.id), info["cover_url"])  # not the hidden cover
        items = self.client.get(f"/api/v2/photos/public/albums/{self.album.id}/photos").json()["items"]
        self.assertEqual([p["id"] for p in items], [str(self.shown.id)])
        ShareAlbum.objects.filter(id=self.album.id).update(public=False)
        self.assertEqual(self.client.get(f"/api/v2/photos/public/albums/{self.album.id}").status_code, 404)
        self.client.force_login(self.owner)
        self.assertTrue(self.client.get(f"/api/v2/photos/public/albums/{self.album.id}").json()["member"])


class DeletePermissionTests(TestCase):
    """Deleting removes files from disk: only library owners/editors may, never viewers."""

    def setUp(self):
        self.owner = ComptechUser.objects.create_user("own", password="pw")
        self.viewer = ComptechUser.objects.create_user("vie", password="pw")
        self.album = Album.objects.create(name="Camera", owner=self.owner, location="/nonexistent/")
        Album_Subscriber.objects.create(album=self.album, user=self.owner, subscribe_type=0)
        Album_Subscriber.objects.create(album=self.album, user=self.viewer, subscribe_type=2)
        self.photo = Photo.objects.create(owner=self.owner, album=self.album, filepath="a.jpg", orientation="1",
                                          date_taken=timezone.now())

    def test_viewers_cannot_delete_but_owners_can(self):
        self.client.force_login(self.viewer)
        self.assertEqual(self.client.post(f"/api/v2/photos/{self.photo.id}/delete-original").status_code, 403)
        r = self.client.post("/api/v2/photos/delete", {"ids": [str(self.photo.id)]}, content_type="application/json")
        self.assertEqual(r.json(), {"deleted": 0})
        self.assertTrue(Photo.objects.filter(id=self.photo.id).exists())
        self.client.force_login(self.owner)
        r = self.client.post("/api/v2/photos/delete", {"ids": [str(self.photo.id)]}, content_type="application/json")
        self.assertEqual(r.json(), {"deleted": 1})
        self.assertFalse(Photo.objects.filter(id=self.photo.id).exists())

    def test_deletes_and_location_saves_refresh_the_summary_views(self):
        Photo.objects.filter(id=self.photo.id).update(latitude=48.85, longitude=2.35, location_city="Paris", location_country="FR")
        self.client.force_login(self.owner)
        with mock.patch("photos.cache.schedule_matview_refresh") as refresh, self.captureOnCommitCallbacks(execute=True):
            self.client.post(f"/api/v2/photos/{self.photo.id}/location", {"lat": None, "lng": None},
                             content_type="application/json")
            self.photo.refresh_from_db()
            self.assertEqual((self.photo.latitude, self.photo.location_city), (None, None))  # the place went too
            self.client.post("/api/v2/photos/delete", {"ids": [str(self.photo.id)]}, content_type="application/json")
        self.assertEqual([c.args for c in refresh.call_args_list], [(("photos_photo_location_cache",),), ()])

    def test_add_and_remove_from_a_shared_album(self):
        sa = ShareAlbum.objects.create(owner=self.owner, name="Best")
        self.client.force_login(self.viewer)  # not an editor of the album
        r = self.client.post(f"/api/v2/photos/albums/{sa.id}/photos", {"ids": [str(self.photo.id)]}, content_type="application/json")
        self.assertEqual(r.status_code, 404)
        self.client.force_login(self.owner)
        r = self.client.post(f"/api/v2/photos/albums/{sa.id}/photos", {"ids": [str(self.photo.id)]}, content_type="application/json")
        self.assertEqual(r.json(), {"added": [str(self.photo.id)]})
        r = self.client.delete(f"/api/v2/photos/albums/{sa.id}/photos", {"ids": [str(self.photo.id)]}, content_type="application/json")
        self.assertEqual(r.json(), {"removed": 1})



class GeoGamesTests(TestCase):
    """Geoguessr (guess where a photo was taken) and the location-entry tool (set locations for photos without one)."""

    def setUp(self):
        self.owner = ComptechUser.objects.create_user("geo1", password="pw")
        self.viewer = ComptechUser.objects.create_user("geo2", password="pw")
        album = Album.objects.create(name="Camera", owner=self.owner, location="/nonexistent/")
        Album_Subscriber.objects.create(album=album, user=self.owner, subscribe_type=0)
        Album_Subscriber.objects.create(album=album, user=self.viewer, subscribe_type=2)
        now = timezone.now()
        self.tagged = Photo.objects.create(owner=self.owner, album=album, filepath="t.jpg", orientation="1",
                                           date_taken=now, latitude=43.47, longitude=-80.54)
        self.untagged = Photo.objects.create(owner=self.owner, album=album, filepath="u.jpg", orientation="1", date_taken=now)

    def test_game_round_and_next_photo_to_locate(self):
        self.client.force_login(self.viewer)
        self.assertEqual(self.client.get("/api/v2/photos/game/round").json()["id"], str(self.tagged.id))
        self.assertEqual(self.client.get("/api/v2/photos/locate/next").json()["id"], str(self.untagged.id))
        self.assertEqual(self.client.get(f"/api/v2/photos/locate/next?exclude={self.untagged.id}").status_code, 404)  # skipped
        broken = Photo.objects.create(owner=self.owner, album=self.tagged.album, filepath="b.jpg", orientation="1",
                                      date_taken=timezone.now(), latitude=43.46, longitude=0.0)  # phone GPS bug
        self.assertEqual(self.client.get("/api/v2/photos/locate/next?zero=true").json()["id"], str(broken.id))
        self.assertEqual(self.client.get("/api/v2/photos/points", {"south": 40, "west": -1, "north": 50, "east": 1}).json(), [])

    def test_only_owners_and_editors_can_set_a_location(self):
        body = {"lat": 48.85, "lng": 2.35}
        self.client.force_login(self.viewer)
        r = self.client.post(f"/api/v2/photos/{self.untagged.id}/location", body, content_type="application/json")
        self.assertEqual(r.status_code, 404)
        self.untagged.refresh_from_db()
        self.assertIsNone(self.untagged.latitude)
        self.client.force_login(self.owner)
        r = self.client.post(f"/api/v2/photos/{self.untagged.id}/location", body, content_type="application/json")
        self.assertEqual((r.status_code, round(r.json()["lat"], 2)), (200, 48.85))
        bad = self.client.post(f"/api/v2/photos/{self.untagged.id}/location", {"lat": 95, "lng": 0}, content_type="application/json")
        self.assertEqual(bad.status_code, 422)
        r = self.client.post(f"/api/v2/photos/{self.untagged.id}/location", {"lat": None, "lng": None}, content_type="application/json")
        self.assertEqual((r.status_code, r.json()["lat"]), (200, None))  # cleared
