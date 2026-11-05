import datetime
import json

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from django.utils import timezone

from notifications.models import Notification
from users.models import ComptechUser

from . import importers, profiles
from .models import Interaction, Person, Relationship
from .reminders import run as run_reminders
from .vcard import parse_vcards

API = "/api/v2/contacts/"

VCF_21 = (
    "BEGIN:VCARD\r\nVERSION:2.1\r\n"
    "N;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:M=C3=BCller;J=C3=BCrgen;;;\r\n"
    "TEL;WORK;VOICE:+1 (416) 555-0100\r\n"
    "NOTE;ENCODING=QUOTED-PRINTABLE:Line one=0D=0ALine =\r\ntwo\r\n"
    "END:VCARD\r\n"
)
VCF_30_40 = """BEGIN:VCARD
VERSION:3.0
FN:Ada Lovelace
N:Lovelace;Ada;;;
ORG:Analytical Engines\\, Ltd;R&D
EMAIL;TYPE=INTERNET,WORK:ada@example.com
item1.URL:https://github.com/ada-l
item1.X-ABLabel:GitHub
X-SOCIALPROFILE;type=twitter:https://twitter.com/ada
CATEGORIES:math,friends
BDAY:1815-12-10
NOTE:first\\nsecond\\, still second
 folded
END:VCARD
BEGIN:VCARD
VERSION:4.0
FN:Grace Hopper
EMAIL;TYPE="home,pref":grace@example.org
BDAY:--1209
URL:https://hachyderm.io/@grace
TEL;VALUE=uri;TYPE=cell:tel:+1-555-0199
END:VCARD
"""
GOOGLE_CSV = (
    "First Name,Middle Name,Last Name,Nickname,Birthday,Notes,Labels,E-mail 1 - Label,E-mail 1 - Value,"
    "E-mail 2 - Label,E-mail 2 - Value,Phone 1 - Label,Phone 1 - Value,Organization Name,Organization Title,"
    "Website 1 - Label,Website 1 - Value\r\n"
    "Linus,,Torvalds,,1969-12-28,kernel,* myContacts ::: Friends,Work,linus@example.com,"
    "Home,LT@Example.com ::: second@example.com,Mobile,555 0101,Linux Foundation,Fellow,Profile,https://github.com/torvalds\r\n"
)
OUTLOOK_CSV = (
    "First Name,Middle Name,Last Name,Title,Suffix,E-mail Address,E-mail 2 Address,Mobile Phone,"
    "Business Phone,Company,Job Title,Birthday,Web Page,Categories\r\n"
    "Bill,,Gates,Mr.,,bill@example.com,,(416) 555-0102,,Microsoft,Co-founder,10/28/1955,https://gatesnotes.com,Tech;VIP\r\n"
)
LINKEDIN_CSV = (
    "Notes:\r\n"
    "\"When exporting your connection data, you may notice that some of the email addresses are missing.\"\r\n"
    "\r\n"
    "First Name,Last Name,URL,Email Address,Company,Position,Connected On\r\n"
    "Satya,Nadella,https://www.linkedin.com/in/satyanadella,,Microsoft,CEO,04 Nov 2026\r\n"
)


def upload(name, text):
    return SimpleUploadedFile(name, text.encode() if isinstance(text, str) else text, content_type="text/plain")


class Base(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.me = ComptechUser.objects.create_user("me", password="pw")
        cls.other = ComptechUser.objects.create_user("other", password="pw")

    def setUp(self):
        self.client.force_login(self.me)

    def post(self, path, body):
        return self.client.post(API + path, json.dumps(body), content_type="application/json")

    def patch(self, path, body):
        return self.client.patch(API + path, json.dumps(body), content_type="application/json")

    def make(self, **kw):
        r = self.post("", {"first_name": "Test", **kw})
        self.assertEqual(r.status_code, 201, r.content)
        return r.json()


class ParserTests(TestCase):
    def test_vcard_21_quoted_printable_charset_and_bare_types(self):
        [c] = parse_vcards(VCF_21)
        self.assertEqual((c["first_name"], c["last_name"]), ("Jürgen", "Müller"))
        self.assertEqual(c["phones"], [{"label": "work", "value": "+1 (416) 555-0100"}])
        self.assertEqual(c["notes"], "Line one\nLine two")

    def test_vcard_30_and_40_escapes_folding_labels_profiles_birthdays(self):
        ada, grace = parse_vcards(VCF_30_40)
        self.assertEqual((ada["company"], ada["department"]), ("Analytical Engines, Ltd", "R&D"))
        self.assertEqual(ada["emails"], [{"label": "work", "value": "ada@example.com"}])
        self.assertEqual(ada["notes"], "first\nsecond, still secondfolded")
        self.assertEqual(ada["birthday"], "1815-12-10")
        self.assertEqual(ada["tags"], ["math", "friends"])
        self.assertEqual(ada["profiles"], {"github": "ada-l", "twitter": "ada"})
        self.assertEqual(grace["birthday"], "--12-09")
        self.assertEqual(grace["emails"], [{"label": "home", "value": "grace@example.org"}])
        self.assertEqual(grace["phones"], [{"label": "mobile", "value": "+1-555-0199"}])
        self.assertEqual(grace["profiles"], {"mastodon": "grace@hachyderm.io"})

    def test_csv_formats_are_detected_and_mapped(self):
        g = importers.parse("contacts.csv", GOOGLE_CSV.encode())
        self.assertEqual(g.format, "google")
        [linus] = g.records
        self.assertEqual([e["value"] for e in linus["emails"]], ["linus@example.com", "LT@Example.com", "second@example.com"])
        self.assertEqual((linus["groups"], linus["profiles"], linus["birthday"]), (["Friends"], {"github": "torvalds"}, "1969-12-28"))

        o = importers.parse("outlook.csv", OUTLOOK_CSV.encode("cp1252"))
        self.assertEqual(o.format, "outlook")
        [bill] = o.records
        self.assertEqual((bill["prefix"], bill["title"], bill["birthday"], bill["tags"]), ("Mr.", "Co-founder", "1955-10-28", ["Tech", "VIP"]))
        self.assertEqual(bill["profiles"], {"website": "https://gatesnotes.com"})

        li = importers.parse("Connections.csv", LINKEDIN_CSV.encode())
        self.assertEqual(li.format, "linkedin")
        [satya] = li.records
        self.assertEqual((satya["title"], satya["profiles"]), ("CEO", {"linkedin": "in/satyanadella"}))
        self.assertIn("Connected on LinkedIn 2026-11-04", satya["how_met"])

    def test_generic_csv_guesses_and_accepts_a_mapping(self):
        text = "Full name;Mail;Employer;GH\nKen Thompson;ken@example.com;Bell Labs;kenthompson\n"
        g = importers.parse("people.csv", text.encode())
        self.assertEqual(g.format, "csv")
        self.assertEqual(g.mapping, {"Full name": "full_name", "Mail": "email", "Employer": "company", "GH": ""})
        g = importers.parse("people.csv", text.encode(), mapping={**g.mapping, "GH": "github"})
        [ken] = g.records
        self.assertEqual((ken["first_name"], ken["last_name"], ken["profiles"]), ("Ken", "Thompson", {"github": "kenthompson"}))

    def test_limits(self):
        with self.assertRaisesMessage(importers.ImportFailed, "5 MB"):
            importers.parse("big.vcf", b"x" * (importers.MAX_BYTES + 1))
        many = "BEGIN:VCARD\nFN:x\nEND:VCARD\n" * (importers.MAX_CONTACTS + 1)
        with self.assertRaisesMessage(importers.ImportFailed, "5,000"):
            importers.parse("many.vcf", many.encode())


class ProfileTests(TestCase):
    def test_handles_and_urls_normalise_to_canonical_links(self):
        cases = [
            ("github", "https://github.com/Torvalds/linux", "Torvalds", "https://github.com/Torvalds"),
            ("linkedin", "linkedin.com/in/jane-doe/", "in/jane-doe", "https://www.linkedin.com/in/jane-doe"),
            ("twitter", "@jack", "jack", "https://x.com/jack"),
            ("mastodon", "https://hachyderm.io/@grace", "grace@hachyderm.io", "https://hachyderm.io/@grace"),
            ("matrix", "@neo:matrix.org", "@neo:matrix.org", "https://matrix.to/#/@neo:matrix.org"),
            ("orcid", "https://orcid.org/0000-0002-1825-0097", "0000-0002-1825-0097", "https://orcid.org/0000-0002-1825-0097"),
            ("discord", "neo", "neo", None),
            ("website", "example.com/me", "https://example.com/me", "https://example.com/me"),
        ]
        for net, raw, handle, url in cases:
            with self.subTest(net):
                self.assertEqual(profiles.normalize(net, raw), handle)
                self.assertEqual(profiles.link(net, handle), url)

    def test_rejects_unsafe_or_malformed(self):
        for net, raw in [("website", "javascript:alert(1)"), ("website", "https://user:pw@evil.com"),
                         ("github", "https://gitlab.com/x"), ("mastodon", "nobody"), ("orcid", "0000-0002-1825-0098")]:
            with self.subTest(raw), self.assertRaises(ValueError):
                profiles.normalize(net, raw)


class ApiTests(Base):
    def test_create_validates_and_normalises(self):
        c = self.make(emails=[{"label": "Work", "value": " Ada@Example.com "}],
                      profiles={"github": "github.com/ada"}, links=[{"label": "Blog", "url": "https://ada.dev"}],
                      birthday="--12-10", tags=["math"], groups=["Family"])
        self.assertEqual(c["emails"], [{"label": "work", "value": "Ada@Example.com"}])
        self.assertEqual(c["profile_links"][0]["url"], "https://github.com/ada")
        self.assertEqual((c["birthday"], c["tags"], c["groups"]), ("--12-10", ["math"], ["Family"]))
        for bad in ({"emails": [{"label": "", "value": "nope"}]}, {"links": [{"label": "x", "url": "ftp://a.b"}]},
                    {"profiles": {"github": "a b"}}, {"profiles": {"myspace": "x"}}, {"birthday": "1990-02-30"}):
            with self.subTest(bad):
                self.assertEqual(self.post("", {"first_name": "X", **bad}).status_code, 400)

    def test_contacts_are_private_to_their_owner(self):
        mine = self.make()
        self.client.force_login(self.other)
        theirs = self.make()
        self.assertEqual(self.client.get(API).json()["total"], 1)
        for r in (self.client.get(API + mine["id"]), self.patch(mine["id"], {"first_name": "Hacked"}),
                  self.client.delete(API + mine["id"]),
                  self.post(f"{theirs['id']}/relationships", {"other_id": mine["id"], "kind": "friend"}),
                  self.post("merge", {"keep_id": theirs["id"], "other_id": mine["id"], "fields": {}}),
                  self.post(f"{mine['id']}/interactions", {"kind": "call", "date": "2026-01-01", "summary": "x"})):
            self.assertEqual(r.status_code, 404)
        self.assertEqual(Person.objects.get(id=mine["id"]).first_name, "Test")

    def test_search_and_filters(self):
        self.make(first_name="Ada", company="Engines", profiles={"github": "adal"}, tags=["math"], favorite=True)
        self.make(first_name="Bob", emails=[{"label": "", "value": "bob@corp.io"}], groups=["Work"])
        names = lambda **q: [c["name"] for c in self.client.get(API, q).json()["items"]]  # noqa: E731
        self.assertEqual(names(q="engines"), ["Ada"])
        self.assertEqual(names(q="adal"), ["Ada"])
        self.assertEqual(names(q="corp.io"), ["Bob"])
        self.assertEqual(names(tag="math"), ["Ada"])
        self.assertEqual(names(group="Work"), ["Bob"])
        self.assertEqual(names(filter="favorites"), ["Ada"])

    def test_interactions_drive_last_contacted_and_keep_in_touch(self):
        today = timezone.localdate()
        c = self.make(keep_in_touch_days=30)
        self.assertEqual(c["next_due"], str(today + datetime.timedelta(days=30)))
        old = str(today - datetime.timedelta(days=40))
        i = self.post(f"{c['id']}/interactions", {"kind": "call", "date": old, "summary": "Caught up"}).json()
        c = self.client.get(API + c["id"]).json()
        self.assertEqual((c["last_contacted"], c["overdue"]), (old, True))
        self.assertEqual([p["id"] for p in self.client.get(API, {"filter": "overdue"}).json()["items"]], [c["id"]])
        self.client.delete(f"{API}interactions/{i['id']}")
        self.assertIsNone(self.client.get(API + c["id"]).json()["last_contacted"])

    def test_relationships_are_bidirectional(self):
        a, b = self.make(first_name="Ann"), self.make(first_name="Ben")
        r = self.post(f"{a['id']}/relationships", {"other_id": b["id"], "kind": "manager"})
        self.assertEqual(r.status_code, 201)
        ben = self.client.get(API + b["id"]).json()
        self.assertEqual([(x["kind"], x["other_name"]) for x in ben["relationships"]], [("report", "Ann")])
        self.client.delete(f"{API}relationships/{r.json()['id']}")
        self.assertFalse(Relationship.objects.exists())

    def test_import_preview_then_commit_dedupes_and_records_source(self):
        self.make(first_name="Linus", emails=[{"label": "", "value": "LINUS@example.com"}])
        self.make(first_name="Other", phones=[{"label": "", "value": "+1 416 555 0102"}])
        # Linus matches by email; a second Linus row (same GitHub) merges into the first row.
        text = GOOGLE_CSV + "Linus,,T,,,,,,,,,,,,,,https://github.com/torvalds\r\nNew,,Person,,,,,,new@example.com,,,,,,,,\r\n"
        p = self.client.post(API + "import/preview", {"file": upload("g.csv", text)}).json()
        self.assertEqual((p["format"], p["total"], p["new"], p["updated"], p["duplicates"]), ("google", 3, 1, 1, 1))
        self.assertEqual(Person.objects.count(), 2)
        r = self.client.post(API + "import/commit", {"file": upload("g.csv", text)}).json()
        self.assertEqual((r["created"], r["updated"]), (1, 1))
        linus = Person.objects.get(first_name="Linus")
        self.assertEqual(linus.profiles, {"github": "torvalds"})
        self.assertIn("google", linus.sources)
        r = self.client.post(API + "import/commit", {"file": upload("o.csv", OUTLOOK_CSV), "mode": "skip"}).json()
        self.assertEqual((r["created"], r["duplicates"]), (0, 1))
        self.assertEqual(self.client.post(API + "import/preview", {"file": upload("x.vcf", b"\x00\xff garbage")}).status_code, 400)

    def test_export_roundtrips_and_neutralises_csv_formulas(self):
        a = self.make(first_name="Ada", last_name="Lovelace", company="=HYPERLINK(1)", birthday="--12-10",
                      emails=[{"label": "work", "value": "ada@example.com"}], profiles={"github": "ada", "discord": "ada_dev"},
                      tags=["math"])
        self.make(first_name="Skip")
        vcf = self.client.get(API + "export", {"format": "vcf", "ids": a["id"]}).content.decode()
        [back] = parse_vcards(vcf)
        self.assertEqual((back["first_name"], back["birthday"], back["profiles"], back["tags"]),
                         ("Ada", "--12-10", {"github": "ada", "discord": "ada_dev"}, ["math"]))
        csv_text = self.client.get(API + "export", {"format": "csv"}).content.decode()
        self.assertIn("'=HYPERLINK(1)", csv_text)
        self.assertEqual(importers.parse("e.csv", csv_text.encode()).format, "google")

    def test_duplicates_and_merge(self):
        a = self.make(first_name="Ada", emails=[{"label": "", "value": "ada@x.io"}], notes="A")
        b = self.make(first_name="Ada L", emails=[{"label": "", "value": "ADA@x.io"}, {"label": "", "value": "b@x.io"}], notes="B")
        self.make(first_name="Unrelated")
        self.post(f"{b['id']}/interactions", {"kind": "email", "date": "2026-01-02", "summary": "hi"})
        [pair] = self.client.get(API + "duplicates").json()
        self.assertEqual({pair["a"]["id"], pair["b"]["id"]}, {a["id"], b["id"]})
        r = self.post("merge", {"keep_id": a["id"], "other_id": b["id"], "fields": {"first_name": "other"}}).json()
        self.assertEqual((r["first_name"], r["notes"]), ("Ada L", "A"))
        self.assertEqual([e["value"] for e in r["emails"]], ["ada@x.io", "b@x.io"])
        self.assertFalse(Person.objects.filter(id=b["id"]).exists())
        self.assertEqual(Interaction.objects.get().person_id.hex, a["id"].replace("-", ""))
        self.assertEqual(self.client.get(API + "duplicates").json(), [])


class ReminderTests(Base):
    def test_birthdays_and_keep_in_touch_notify_once(self):
        today = datetime.date(2026, 11, 4)
        tomorrow = today + datetime.timedelta(days=1)
        Person.objects.create(owner=self.me, first_name="Bday", birthday_month=tomorrow.month, birthday_day=tomorrow.day,
                              birthday_year=1990)
        for i in range(2):
            p = Person(owner=self.me, first_name=f"Late{i}", keep_in_touch_days=7, last_contacted=today - datetime.timedelta(days=30))
            p.save()
        Person.objects.create(owner=self.other, first_name="NotMine", birthday_month=tomorrow.month, birthday_day=tomorrow.day)
        run_reminders(today=today)
        run_reminders(today=today)
        titles = sorted(Notification.objects.filter(user=self.me).values_list("title", flat=True))
        self.assertEqual(titles, ["Bday turns 36 tomorrow", "Catch up with Late0", "Catch up with Late1"])
        for i in range(4):  # a batch of newly-overdue people becomes one digest
            Person(owner=self.me, first_name=f"Batch{i}", keep_in_touch_days=1, last_contacted=today - datetime.timedelta(days=9)).save()
        run_reminders(today=today)
        self.assertEqual(Notification.objects.filter(user=self.me, title="4 people to catch up with").count(), 1)


class PageTests(Base):
    def test_page_boots(self):
        r = self.client.get("/contacts/")
        self.assertContains(r, "contacts/contacts.js")
        self.assertContains(r, 'id="ct-boot"')



class BirthdaysTests(TestCase):
    def test_birthdays_in_range_with_age_and_leap_day(self):
        import datetime
        user = ComptechUser.objects.create_user("bday", password="pw")
        Person.objects.create(owner=user, first_name="Ada", birthday_year=1990, birthday_month=3, birthday_day=10)
        Person.objects.create(owner=user, first_name="Leap", birthday_month=2, birthday_day=29)
        Person.objects.create(owner=ComptechUser.objects.create_user("other", password="pw"), first_name="Nope",
                              birthday_month=3, birthday_day=10)
        self.client.force_login(user)
        r = self.client.get("/api/v2/contacts/birthdays?start=2027-02-01&end=2027-03-31").json()
        self.assertEqual([(b["name"], b["date"], b["age"]) for b in r],
                         [("Leap", "2027-02-28", None), ("Ada", "2027-03-10", 37)])
