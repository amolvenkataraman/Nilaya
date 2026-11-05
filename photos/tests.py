import datetime
import json
import re

from django.test import TestCase
from django.utils import timezone

from users.models import ComptechUser

from .models import Album, Album_Subscriber, Photo, ShareAlbum, ShareAlbum_Photo


def _json_script(html, element_id):
    m = re.search(rf'<script id="{element_id}" type="application/json">(.*?)</script>', html, re.S)
    return json.loads(m.group(1))


class PhotosPageTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.user = ComptechUser.objects.create_user("pat", password="pw")
        album = Album.objects.create(name="Phone", owner=cls.user, location="/tmp/")
        Album_Subscriber.objects.create(album=album, user=cls.user, subscribe_type=0)

        def photo(day, **kw):
            when = timezone.make_aware(datetime.datetime(*day, 12, 0))
            return Photo.objects.create(owner=cls.user, album=album, filepath="x.jpg", orientation="", date_taken=when, **kw)

        cls.paris = photo((2024, 3, 10), location_city="Paris", location_country="France",
                          camera_make="Canon", camera_model="R6", size_total=300)
        photo((2024, 3, 2), location_city="Toronto", location_country="Canada")
        photo((2023, 1, 5))

    def setUp(self):
        self.client.force_login(self.user)

    def test_timeline_has_no_right_sidebar_and_ships_month_counts_for_the_scrubber(self):
        r = self.client.get("/photos/")
        self.assertEqual(r.status_code, 200)
        self.assertFalse(r.context["right_sidebar"])
        self.assertEqual(_json_script(r.content.decode(), "ph-months"), [["2024-03", 2], ["2023-01", 1]])

    def test_library_summary_has_every_stat_and_follows_the_filters(self):
        keys = ("ntotal", "nphotos", "nvideos", "countries", "cities", "cameras", "size_kb", "first_date", "last_date")
        c = self.client.get("/photos/").context
        self.assertEqual([c[k] for k in keys], [3, 3, 0, 2, 2, 1, 300, datetime.date(2023, 1, 5), datetime.date(2024, 3, 10)])
        c = self.client.get("/photos/", {"country": "Canada"}).context
        self.assertEqual([c[k] for k in ("ntotal", "cities", "cameras")], [1, 1, 0])

    def test_free_text_search_matches_place_case_insensitively(self):
        r = self.client.get("/photos/date/", {"date": "2024-04-01", "q": "paRI", "nphotos": 50}).json()
        ids = [p["id"] for day in r["photos"] for p in day["photos"]]
        self.assertEqual(ids, [str(self.paris.id)])

    def test_malformed_album_id_is_404(self):
        self.assertEqual(self.client.get("/photos/", {"album": "not-a-uuid"}).status_code, 404)

    def test_map_is_inside_the_photos_shell_with_coords_as_json(self):
        r = self.client.get("/photos/map_new/")
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.context["left_sidebar"])
        self.assertEqual(_json_script(r.content.decode(), "map-coords"), [])

    def test_add_to_album_reports_only_newly_added_ids_so_undo_is_exact(self):
        sa = ShareAlbum.objects.create(owner=self.user, name="Trip")
        ShareAlbum_Photo.objects.create(sharealbum=sa, photo=self.paris)
        other = Photo.objects.exclude(id=self.paris.id).first()
        r = self.client.post("/photos/albums/add/", json.dumps({"share_album_id": str(sa.id), "photo_id": [str(self.paris.id), str(other.id)]}),
                             content_type="application/json").json()
        self.assertEqual(r["data"], {"added": [str(other.id)]})


class HiddenPhotoViewTests(TestCase):
    """views.py side of hidden photos (the V2 API side is in test_hidden.py)."""

    @classmethod
    def setUpTestData(cls):
        cls.owner = ComptechUser.objects.create_user("hal", password="pw")
        cls.friend = ComptechUser.objects.create_user("ivy", password="pw")
        album = Album.objects.create(name="Camera", owner=cls.owner, location="/tmp/")
        for u in (cls.owner, cls.friend):
            Album_Subscriber.objects.create(album=album, user=u, subscribe_type=0 if u == cls.owner else 2)
        when = timezone.make_aware(datetime.datetime(2024, 3, 10, 12))
        cls.shown = Photo.objects.create(owner=cls.owner, album=album, filepath="a.jpg", orientation="", date_taken=when)
        cls.secret = Photo.objects.create(owner=cls.owner, album=album, filepath="b.jpg", orientation="", date_taken=when, hidden=True)

    def timeline(self):
        r = self.client.get("/photos/date/", {"date": "2024-03-11", "nphotos": 50}).json()
        return {p["id"]: p for day in r["photos"] for p in day["photos"]}

    def timeline_ids(self):
        return set(self.timeline())

    def reveal(self):
        self.client.post("/api/v2/photos/hidden-mode", {"show": True}, content_type="application/json")

    def test_timeline_and_info_hide_it_except_for_the_owner_in_show_hidden_mode(self):
        info = f"/photos/photo/{self.secret.id}/info/"
        for user, sees in ((self.friend, False), (self.owner, True)):
            self.client.force_login(user)
            self.assertEqual(self.timeline_ids(), {str(self.shown.id)})
            self.assertEqual(self.client.get(info).status_code, 404)
            self.reveal()
            self.assertEqual(str(self.secret.id) in self.timeline_ids(), sees)
            self.assertEqual(self.client.get(info).status_code, 200 if sees else 404)
        # the owner's tiles carry the flags the Hide/Unhide UI needs
        self.assertEqual({k: self.timeline()[str(self.secret.id)][k] for k in ("hidden", "mine")}, {"hidden": True, "mine": True})

    def test_shared_album_counts_leave_hidden_photos_out(self):
        sa = ShareAlbum.objects.create(owner=self.owner, name="Trip", cover_photo=self.secret)
        for p in (self.shown, self.secret):
            ShareAlbum_Photo.objects.create(sharealbum=sa, photo=p)
        self.client.force_login(self.owner)
        info = self.client.get("/photos/albums/json-list/").json()["albums"][0]
        self.assertEqual((info["photo_count"], info["cover_photo_id"]), (1, str(self.shown.id)))



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
        self.client.post(f"/photos/delete/{self.photo.id}/")
        self.client.post(f"/photos/delete-original/{self.photo.id}/")
        r = self.client.post("/api/v2/photos/delete", {"ids": [str(self.photo.id)]}, content_type="application/json")
        self.assertEqual(r.json(), {"deleted": 0})
        self.assertTrue(Photo.objects.filter(id=self.photo.id).exists())
        self.client.force_login(self.owner)
        r = self.client.post("/api/v2/photos/delete", {"ids": [str(self.photo.id)]}, content_type="application/json")
        self.assertEqual(r.json(), {"deleted": 1})
        self.assertFalse(Photo.objects.filter(id=self.photo.id).exists())

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
        self.client.post("/photos/geoguessr_ent/", {"photo": str(self.untagged.id), **body}, content_type="application/json")
        self.untagged.refresh_from_db()
        self.assertIsNone(self.untagged.latitude)  # the classic tool no longer lets viewers write either
        self.client.force_login(self.owner)
        r = self.client.post(f"/api/v2/photos/{self.untagged.id}/location", body, content_type="application/json")
        self.assertEqual((r.status_code, round(r.json()["lat"], 2)), (200, 48.85))
        bad = self.client.post(f"/api/v2/photos/{self.untagged.id}/location", {"lat": 95, "lng": 0}, content_type="application/json")
        self.assertEqual(bad.status_code, 422)
        r = self.client.post(f"/api/v2/photos/{self.untagged.id}/location", {"lat": None, "lng": None}, content_type="application/json")
        self.assertEqual((r.status_code, r.json()["lat"]), (200, None))  # cleared, like the classic Clear button
