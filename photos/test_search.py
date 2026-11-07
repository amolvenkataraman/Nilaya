"""Smart search: how free text is read (photos/search.py) and what /api/v2/photos/search may return."""

import datetime
from zoneinfo import ZoneInfo

from django.test import SimpleTestCase, TestCase

from users.models import ComptechUser

from . import search
from .models import PLANE_ALTITUDE_M, Album, Album_Subscriber, Photo

NOW = datetime.datetime(2026, 11, 7, 12, tzinfo=ZoneInfo("America/Toronto"))
VOCAB = search.build_vocab(
    [{"value": "Toronto", "country": "Canada"}, {"value": "Waterloo", "country": "Canada"},
     {"value": "New York City", "country": "United States"}, {"value": "Paris", "country": "France"}],
    [{"value": "Canada"}, {"value": "United States"}, {"value": "France"}],
    [{"value": "Pixel 7", "make": "Google"}, {"value": "Pixel 7 Pro", "make": "Google"},
     {"value": "SM-S908U1", "make": "samsung"}, {"value": "Canon EOS R5", "make": "Canon"}])
NAMES = search.names_vocab([("a1", "Public trip")], [(1, "Phone")])


def read(q):
    terms, unmatched = search.parse(q, VOCAB, NOW, NAMES)
    return [(t.type, t.label) for t in terms], unmatched


class ParseTests(SimpleTestCase):
    def test_reads_each_kind_of_term(self):
        cases = {
            # places: multi-word names, aliases, "US" only in capitals
            "dogs in new york": [("object", "Dog"), ("place", "New York City")],
            "united states": [("place", "United States")],
            "photos of us in the US": [("media", "Photos (no videos)"), ("place", "United States")],
            "kids and puppies": [("object", "Person"), ("object", "Dog")],
            # cameras: exact model beats the prefix, codes have their marketing name, makes
            "pixel 7 paris june 2023": [("camera", "Pixel 7"), ("place", "Paris"), ("date", "June 2023")],
            "pixel": [("camera", "Pixel")],
            "galaxy s22 ultra canon": [("camera", "Galaxy S22 Ultra"), ("camera", "Canon")],
            # dates
            "2018-2020": [("date", "2018–2020")],
            "between 2018 and 2020": [("date", "2018–2020")],
            "5 june 2023": [("date", "Jun 5, 2023")],
            "june": [("date", "June (any year)")],
            "last year": [("date", "Last year (2025)")],
            "last summer": [("date", "Summer 2026")],
            # media, albums and libraries
            "raw videos": [("media", "Has RAW"), ("media", "Videos")],
            "public trip": [("album", "Public trip")],
            "phone library": [("library", "Phone")],
        }
        for q, expected in cases.items():
            with self.subTest(q=q):
                self.assertEqual(read(q), (expected, []))

    def test_typos_unmatched_words_and_the_file_name_fallback(self):
        terms, unmatched = search.parse("tornto pairs blah", VOCAB, NOW, NAMES)
        self.assertEqual([(t.label, t.typo) for t in terms], [("Toronto", "tornto"), ("Paris", "pairs")])
        self.assertEqual(unmatched, ["blah"])
        self.assertEqual(read("IMG_2041"), ([("text", "IMG_2041")], []))
        self.assertEqual(read("canon beach"), ([("camera", "Canon")], ["beach"]))


class SearchApiTests(TestCase):
    def setUp(self):
        self.user = ComptechUser.objects.create_user("fay", password="pw")
        other = ComptechUser.objects.create_user("gus", password="pw")
        mine = Album.objects.create(name="Camera", owner=self.user, location="/tmp/a/")
        theirs = Album.objects.create(name="Theirs", owner=other, location="/tmp/b/")
        Album_Subscriber.objects.create(album=mine, user=self.user, subscribe_type=0)
        Album_Subscriber.objects.create(album=theirs, user=other, subscribe_type=0)
        when = datetime.datetime(2019, 7, 1, 12, tzinfo=datetime.timezone.utc)
        make = lambda album, name, **kw: Photo.objects.create(
            owner=album.owner, album=album, filepath=name, orientation="1", date_taken=when, **kw)
        self.dog = make(mine, "dog.jpg", location_city="Waterloo", location_country="Canada", ai_index_info={"objects": [92]})
        self.cat = make(mine, "cat.jpg", location_city="Waterloo", location_country="Canada", ai_index_info={"objects": [139]})
        make(mine, "hidden.jpg", location_city="Waterloo", location_country="Canada", ai_index_info={"objects": [92]}, hidden=True)
        make(mine, "us.jpg", location_city="Waterloo", location_country="United States", ai_index_info={"objects": [92]})
        make(mine, "plane.jpg", location_city="Somecity", location_country="Canada", altitude=9000)
        make(mine, "ground.jpg", location_city="Elsewhere", location_country="Canada", altitude=PLANE_ALTITUDE_M - 1)
        make(theirs, "theirs.jpg", location_city="Waterloo", location_country="Canada", ai_index_info={"objects": [92]})
        self.client.force_login(self.user)

    def test_only_visible_photos_match_and_types_combine(self):
        r = self.client.get("/api/v2/photos/search", {"q": "dogs cats waterloo canada 2019"}).json()
        # (dog or cat) and Waterloo in Canada and 2019: not the hidden one, the US Waterloo or another user's.
        self.assertEqual({p["id"] for p in r["items"]}, {str(self.dog.id), str(self.cat.id)})
        self.assertEqual(r["count"], 2)
        self.assertEqual([t["kind"] for t in r["interpreted"]], ["Object", "Object", "Place", "Place", "Date"])

    def test_places_leave_out_photos_taken_from_a_plane(self):
        places = {c["name"] for c in self.client.get("/api/v2/photos/sidebar").json()["summary"]["cities"]}
        self.assertIn("Elsewhere", places)
        self.assertNotIn("Somecity", places)
        r = self.client.get("/api/v2/photos/search", {"q": "somecity"}).json()
        self.assertEqual((r["items"], r["interpreted"][0]["type"]), ([], "text"))  # not a place you visited
