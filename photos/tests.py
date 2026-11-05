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
