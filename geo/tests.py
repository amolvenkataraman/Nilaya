from types import SimpleNamespace as NS

from django.test import SimpleTestCase

from . import naming, places


def _place(name, tier=None, kind="locality", codes=None):
    return NS(name=name, tier=tier, kind=NS(value=kind), codes=codes or {}, id=f"x:{name}")


def _result(city=None, parks=(), within_city=True, cdp=False, near=()):
    c = _place(city, codes={"class": "cdp"} if cdp else {}) if city else None
    return NS(city=c, within=tuple(parks), city_within=within_city, near=tuple(near))


class PlaceNameTests(SimpleTestCase):
    def test_city_national_park_and_both(self):
        park, forest = _place("Yosemite National Park", 1, "park"), _place("Sierra National Forest", 2, "park")
        self.assertEqual(naming.place_name(_result("Toronto")), "Toronto")
        self.assertEqual(naming.place_name(_result("Yosemite Valley", [park], cdp=True)), "Yosemite National Park")
        self.assertEqual(naming.place_name(_result("San Francisco", [park])), "Yosemite National Park, San Francisco")
        self.assertEqual(naming.place_name(_result("Mill Valley", [park], within_city=False)), "Yosemite National Park")
        self.assertEqual(naming.place_name(_result("Fresno", [forest])), "Fresno")  # a forest never replaces a town
        self.assertEqual(naming.place_name(_result(None, [forest])), "Sierra National Forest")
        town = NS(place=_place("Three Rivers"))
        self.assertEqual(naming.place_name(_result(None, near=[NS(place=_place("Lake", kind="water")), town])), "Three Rivers")


class SearchTermTests(SimpleTestCase):
    def hit(self, name, score, kind="landmark", codes=None):
        return NS(place=_place(name, kind=kind, codes=codes), score=score)

    def test_confidence_codes_and_generic_words(self):
        pearson = self.hit("Toronto Pearson International Airport", 0.9, "airport", {"iata": "YYZ"})
        toronto = self.hit("Toronto", 0.91)
        self.assertIs(places._pick([toronto, pearson], "yyz"), pearson)  # a code is the airport, not its city
        self.assertIsNone(places._pick([self.hit("Dongola", 0.69, "locality")], "dog"))  # fuzzy and fair: no
        self.assertIsNone(places._pick([self.hit("Lake Mead National Recreation Area", 0.9, "park")], "lake"))
        self.assertIsNotNone(places._pick([self.hit("M5V", 0.36, "postal_code")], "M5V"))  # exactly its name
        self.assertIsNotNone(places._pick([self.hit("Golden Gate Bridge", 0.7)], "golden gate"))  # words in the name
