import datetime
import json
from unittest import mock

from django.core.cache import cache
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from django.utils import timezone

from photos.models import Album, Album_Subscriber, Photo
from users.models import ComptechUser

from .models import Location, LocationGroup

API = "/api/v2/places"
TZ = timezone.get_default_timezone()


def at(day, hour=12):
    return datetime.datetime(2026, 8, day, hour, tzinfo=TZ)


class PlacesTestCase(TestCase):
    def setUp(self):
        cache.clear()
        self.amol = ComptechUser.objects.create_user("amol", password="x")
        self.alex = ComptechUser.objects.create_user("alex", password="x")
        self.mine = LocationGroup.objects.create(name="Food", owner=self.amol)
        self.public = LocationGroup.objects.create(name="Shared", owner=self.alex, is_public=True)
        self.private = LocationGroup.objects.create(name="Secret", owner=self.alex)
        self.album = Album.objects.create(name="Lib", owner=self.amol, location="/x/")
        Album_Subscriber.objects.create(album=self.album, user=self.amol)
        self.client.force_login(self.amol)

    def place(self, group=None, **kw):
        kw = {"name": "Cafe", "latitude": 43.47, "longitude": -80.54, **kw}
        return Location.objects.create(group=group or self.mine, **kw)

    def photo(self, lat, lon, when, album=None, **kw):
        return Photo.objects.create(owner=self.amol, album=album or self.album, filepath="p.jpg",
                                    orientation="", latitude=lat, longitude=lon, date_taken=when, **kw)

    def upload(self, name, content, **form):
        data = {"group_id": self.mine.id, **form, "file": SimpleUploadedFile(name, content)}
        return self.client.post(f"{API}/import", data)


class ScopeTests(PlacesTestCase):
    def test_others_private_hidden_public_read_only(self):
        secret = self.place(self.private, name="Secret spot")
        shared = self.place(self.public, name="Shared spot")
        names = {p["name"] for p in self.client.get(f"{API}/").json()}
        self.assertEqual(names, {"Shared spot"})
        self.assertEqual(self.client.get(f"{API}/{secret.id}").status_code, 404)
        r = self.client.patch(f"{API}/{shared.id}", {"name": "x"}, content_type="application/json")
        self.assertEqual(r.status_code, 404)
        self.assertEqual(self.client.get(f"{API}/groups/{self.private.id}/export").status_code, 404)
        self.assertEqual(self.upload("a.geojson", b"{}", group_id=self.public.id).status_code, 404)


class StatusTests(PlacesTestCase):
    def test_status_visited_on_and_filters(self):
        r = self.client.post(f"{API}/", {"group_id": self.mine.id, "name": "Pier", "latitude": 1, "longitude": 2,
                                   "status": "visited", "rating": 4}, content_type="application/json")
        self.assertEqual(r.status_code, 201)
        self.assertEqual(r.json()["visited_on"], str(timezone.localdate()))
        self.place(name="Later", status="want_to_go", rating=2)
        self.assertEqual(self.client.post(f"{API}/", {"group_id": self.mine.id, "name": "x", "latitude": 1, "longitude": 2,
                                               "status": "bogus"}, content_type="application/json").status_code, 422)
        self.assertEqual([p["name"] for p in self.client.get(f"{API}/", {"status": "want_to_go"}).json()], ["Later"])
        self.assertEqual([p["name"] for p in self.client.get(f"{API}/", {"min_rating": 3}).json()], ["Pier"])


class PhotosHereTests(PlacesTestCase):
    def test_photos_near_place_and_visits(self):
        p = self.place(latitude=43.47, longitude=-80.54)
        self.photo(43.4701, -80.5401, at(1, 10))
        self.photo(43.4702, -80.5399, at(1, 15))
        self.photo(43.4699, -80.5400, at(3))
        self.photo(43.4730, -80.5400, at(4))  # ~330 m north: too far
        other = Album.objects.create(name="Alex", owner=self.alex, location="/y/")
        self.photo(43.47, -80.54, at(5), album=other)  # not in amol's library
        self.photo(43.47, -80.54, at(6), hidden=True)  # hidden photos never show or count
        data = self.client.get(f"{API}/{p.id}/photos").json()
        self.assertEqual((data["count"], data["visits"], data["last_visit"]), (3, 2, "2026-08-03"))
        self.assertEqual(len(data["photos"]), 3)
        self.assertTrue(data["photos"][0]["thumb_url"].startswith("/private/"))
        near = self.client.get(f"{API}/photos-near", {"latitude": 43.47, "longitude": -80.54}).json()
        self.assertEqual(near["count"], 3)  # same search by coordinates (suggested spots)


class SuggestionTests(PlacesTestCase):
    def test_frequent_unsaved_spots(self):
        for i in range(6):  # 6 photos over 2 days at an unsaved spot
            self.photo(43.5000 + i * 0.0001, -80.5000, at(1 + i % 2), location_city="Waterloo",
                       location_country="Canada")
        for i in range(6):  # frequent, but next to a saved place
            self.photo(43.4700, -80.5400 + i * 0.0001, at(1 + i % 2))
        self.place(latitude=43.4701, longitude=-80.5401)
        for i in range(6):  # one day only
            self.photo(44.0, -79.0, at(7, 8 + i))
        data = self.client.get(f"{API}/suggestions", {"min_photos": 5}).json()
        self.assertEqual(len(data), 1)
        s = data[0]
        self.assertEqual((s["photos"], s["days"], s["city"], s["country"]), (6, 2, "Waterloo", "Canada"))
        self.assertAlmostEqual(s["latitude"], 43.50025, places=3)


class StatsTests(PlacesTestCase):
    def test_counts_and_most_visited(self):
        home = self.place(name="Home", category="house", status="visited")
        self.place(name="Trip", category="park", status="want_to_go", latitude=10, longitude=10)
        self.place(self.public, name="Not mine", category="park")
        for d in (1, 2, 3):
            self.photo(43.4701, -80.5401, at(d))
        data = self.client.get(f"{API}/stats").json()
        self.assertEqual(data["total"], 2)
        self.assertEqual(data["by_status"], {"saved": 0, "want_to_go": 1, "visited": 1})
        self.assertEqual({c["key"]: c["count"] for c in data["by_category"]}, {"house": 1, "park": 1})
        self.assertEqual(data["most_visited"][0]["id"], str(home.id))
        self.assertEqual(data["most_visited"][0]["visits"], 3)


class ExportImportTests(PlacesTestCase):
    def test_export_geojson(self):
        self.place(name="Cafe", latitude=43.5, longitude=-80.5, status="visited")
        r = self.client.get(f"{API}/groups/{self.mine.id}/export")
        self.assertIn("attachment", r["Content-Disposition"])
        f = json.loads(r.content)["features"][0]
        self.assertEqual(f["geometry"]["coordinates"][:2], [-80.5, 43.5])
        self.assertEqual(f["properties"]["status"], "visited")

    def test_geojson_preview_then_import_skips_duplicates(self):
        self.place(name="Cafe", latitude=43.5, longitude=-80.5)
        fc = {"type": "FeatureCollection", "features": [
            {"type": "Feature", "geometry": {"type": "Point", "coordinates": [-80.5002, 43.5001]},
             "properties": {"name": "cafe "}},  # same name within 50 m
            {"type": "Feature", "geometry": {"type": "Point", "coordinates": [-80.6, 43.6]},
             "properties": {"name": "Park", "category": "park", "status": "want_to_go"}},
            {"type": "Feature", "geometry": {"type": "Point", "coordinates": [500, 43.6]}, "properties": {}},
            {"type": "Feature", "geometry": {"type": "LineString", "coordinates": [[0, 0], [1, 1]]}},
        ]}
        body = json.dumps(fc).encode()
        preview = self.upload("p.geojson", body, dry_run="true").json()
        self.assertEqual((preview["new"], preview["duplicates"], preview["invalid"], preview["created"]), (1, 1, 2, 0))
        self.assertEqual(Location.objects.count(), 1)
        self.assertEqual(self.upload("p.geojson", body).json()["created"], 1)
        park = Location.objects.get(name="Park")
        self.assertEqual((park.category, park.status), ("park", "want_to_go"))

    def test_takeout_saved_places(self):
        takeout = {"type": "FeatureCollection", "features": [
            {"type": "Feature", "geometry": {"type": "Point", "coordinates": [0, 0]},
             "properties": {"google_maps_url": "http://maps.google.com/?q=43.25,-79.87",
                            "location": {"name": "Bakery", "address": "1 Main St"}}},
            {"type": "Feature", "geometry": {"type": "Point", "coordinates": [-79.1, 43.1]},
             "properties": {"Title": "Old style", "Location": {"Address": "2 Side St"}}},
        ]}
        r = self.upload("Saved Places.json", json.dumps(takeout).encode()).json()
        self.assertEqual((r["format"], r["created"]), ("takeout", 2))
        b = Location.objects.get(name="Bakery")
        self.assertEqual((float(b.latitude), float(b.longitude), b.address), (43.25, -79.87, "1 Main St"))

    def test_kml_and_dtd_rejected(self):
        kml = b"""<?xml version="1.0"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document>
            <Placemark><name>Falls</name><description>Big</description>
            <Point><coordinates>-79.07,43.08,0</coordinates></Point></Placemark></Document></kml>"""
        self.assertEqual(self.upload("a.kml", kml).json()["created"], 1)
        self.assertEqual(Location.objects.get().description, "Big")
        bomb = b'<?xml version="1.0"?><!DOCTYPE kml [<!ENTITY a "aaaa">]><kml><Placemark><name>&a;</name></Placemark></kml>'
        self.assertEqual(self.upload("b.kml", bomb).status_code, 400)

    @mock.patch("map.api_v2.MAX_IMPORT_BYTES", 10)
    def test_size_limit(self):
        self.assertEqual(self.upload("big.geojson", b"x" * 11).status_code, 413)


class NominatimTests(PlacesTestCase):
    @override_settings(ONLINE_MODE=False)
    def test_offline_mode_makes_no_request(self):
        with mock.patch("map.views.urllib.request.urlopen") as urlopen:
            r = self.client.get("/map/nominatim/search/", {"q": "Waterloo"})
        self.assertEqual(r.status_code, 503)
        urlopen.assert_not_called()



class GeocodeSearchTests(TestCase):
    def test_v2_place_search_is_off_in_offline_mode(self):
        from django.test import override_settings
        u = ComptechUser.objects.create_user("geo", password="pw")
        self.client.force_login(u)
        with override_settings(ONLINE_MODE=False):
            self.assertEqual(self.client.get("/api/v2/places/geocode?q=Toronto").status_code, 503)



class GroupVisibilityTests(TestCase):
    """Places scale by group: per-person visibility (hidden by default), owner archiving, visible-only loading."""

    def setUp(self):
        from .models import Location, LocationGroup
        self.me = ComptechUser.objects.create_user("gv", password="pw")
        self.food = LocationGroup.objects.create(name="Food", owner=self.me)
        self.old = LocationGroup.objects.create(name="Old trips", owner=self.me)
        for g in (self.food, self.old):
            Location.objects.create(group=g, name=f"{g.name} spot", latitude=1, longitude=1)
        self.client.force_login(self.me)

    def names(self, **params):
        return sorted(p["name"] for p in self.client.get("/api/v2/places/", params).json())

    def test_groups_start_hidden_and_visible_only_loads_shown_groups(self):
        groups = {g["name"]: g["visible"] for g in self.client.get("/api/v2/places/groups").json()}
        self.assertEqual(groups, {"Food": False, "Old trips": False})
        self.assertEqual(self.names(visible="true"), [])
        self.client.put(f"/api/v2/places/groups/{self.food.id}/visibility", {"visible": True}, content_type="application/json")
        self.assertEqual(self.names(visible="true"), ["Food spot"])
        self.client.post(f"/api/v2/places/groups/{self.old.id}/only")
        self.assertEqual(self.names(visible="true"), ["Old trips spot"])
        self.assertEqual(self.names(q="spot"), ["Food spot", "Old trips spot"])  # search still finds everything
        pins = self.client.get("/api/v2/places/pins?visible=true").json()  # the map's light load
        self.assertEqual([(p["name"], sorted(p)) for p in pins], [("Old trips spot", sorted(
            ["id", "group_id", "name", "latitude", "longitude", "category", "status", "rating"]))])

    def test_archived_groups_drop_out_unless_asked_for(self):
        self.client.patch(f"/api/v2/places/groups/{self.old.id}", {"archived": True}, content_type="application/json")
        self.assertEqual([g["name"] for g in self.client.get("/api/v2/places/groups").json()], ["Food"])
        listed = self.client.get("/api/v2/places/groups?include_archived=true").json()
        self.assertEqual({g["name"]: g["archived"] for g in listed}, {"Food": False, "Old trips": True})
        self.client.post(f"/api/v2/places/groups/{self.old.id}/only")
        self.assertEqual(self.names(visible="true"), [])  # archived groups never load
