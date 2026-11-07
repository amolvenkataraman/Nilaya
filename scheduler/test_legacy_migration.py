"""Legacy-data torture test: data written by older versions of the app migrates cleanly.

Migrates a fresh database to production's schema (master @ 3b9be79: scheduler 0031,
photos 0023, map 0003, notifications 0002, users 0004; tasks, habits, contacts, apikeys,
feeds and analytics don't exist yet), writes every odd shape old code could have stored
through the historical models, migrates every app to the latest state, then checks the
converted values and that the APIs serve them. SQLite only (no Postgres-specific steps).
"""

import datetime as dt
from zoneinfo import ZoneInfo

from django.contrib.auth.hashers import make_password
from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from django.test import TransactionTestCase

PROD = {"scheduler": "0031_jsonfield_default_dict", "photos": "0023_jsonfield_default_dict",
        "map": "0003_alter_location_category_alter_location_id",
        "notifications": "0002_notification_device_group_notification_expires_on",
        "users": "0004_alter_friendrequest_id_alter_usergroup_id"}
NOT_YET = {"analytics", "apikeys", "contacts", "feeds", "habits", "tasks"}
TZ = ZoneInfo("Canada/Eastern")
UTC = dt.timezone.utc


def local(y, m, d, h=0, mi=0):
    return dt.datetime(y, m, d, h, mi, tzinfo=TZ)


def utc(y, m, d, h=0):
    return dt.datetime(y, m, d, h, tzinfo=UTC)


class LegacyDataMigrationTests(TransactionTestCase):
    def _executor(self):
        ex = MigrationExecutor(connection)
        ex.loader.build_graph()
        return ex

    def tearDown(self):
        ex = self._executor()
        ex.migrate(ex.loader.graph.leaf_nodes())

    def to_production(self):
        ex = self._executor()
        targets = []
        for app in sorted({n[0] for n in ex.loader.graph.nodes}):
            if app in PROD:
                targets.append((app, PROD[app]))
            elif app in NOT_YET:
                targets.append((app, None))
            else:
                targets += [n for n in ex.loader.graph.leaf_nodes() if n[0] == app]
        ex.migrate(targets)
        return self._executor().loader.project_state([t for t in targets if t[1]]).apps

    def to_latest(self):
        ex = self._executor()
        ex.migrate(ex.loader.graph.leaf_nodes())

    # ------------------------------------------------------------ legacy rows

    def write_legacy(self, apps):
        M = lambda app, name: apps.get_model(app, name)
        User, Calendar, Subscriber, Invite = (M("users", "ComptechUser"), M("scheduler", "Calendar"),
                                              M("scheduler", "Subscriber"), M("scheduler", "Invite"))
        Event, Todo = M("scheduler", "Event"), M("scheduler", "Todo")
        pw = make_password("pw")
        self.amy = User.objects.create(username="amy", password=pw, dark_mode=True)
        self.ben = User.objects.create(username="ben", password=pw, timezone="Mars/Olympus")  # junk zone
        self.cat = User.objects.create(username="cat", password=pw)
        amy, ben, cat = self.amy, self.ben, self.cat
        C = lambda name, owner, **kw: Calendar.objects.create(name=name, owner=owner, **kw)
        self.c_local = C("Local", amy, colour="#000000")
        self.c_ics = C("ICS", amy, colour="#abc", calendar_type=1, calendar_url="https://x/a.ics", auto_sync=True,
                       auto_sync_sm=-1, auto_sync_sy=-1, auto_sync_em=12, auto_sync_ey=2026)
        self.c_google = C("Google", amy, colour="red", calendar_type=2, calendar_url="a@group", auto_sync_sm=1,
                          auto_sync_sy=2026)
        self.c_uw = C("UW", amy, colour="", calendar_type=50, calendar_url="123")
        self.c_ben = C("Ben's", ben, colour="#ABCDEF")  # ben has no subscriber row
        self.c_old = C("Old", amy, colour="#123456", active=False)
        for c in (self.c_local, self.c_ics, self.c_google, self.c_uw, self.c_old):
            Subscriber.objects.create(calendar=c, user=amy, subscribe_type=0, colour=None)
        Subscriber.objects.create(calendar=self.c_ben, user=amy, subscribe_type=0, colour="blue")  # non-owner "owner"
        Subscriber.objects.create(calendar=self.c_local, user=cat, subscribe_type=2, colour="nonsense", display_busy=2)
        Subscriber.objects.create(calendar=self.c_local, user=cat, subscribe_type=2)  # duplicate row
        Invite.objects.create(calendar=self.c_local, code="USED5", uses=5)
        Invite.objects.create(calendar=self.c_local, code="OFF", active=False)

        E = lambda name, start, end=None, cal=None, **kw: Event.objects.create(
            calendar=cal or self.c_local, name=name, startdate=start, enddate=end, **kw)
        for cat_no in (0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 100, 42):
            E(f"cat {cat_no}", local(2026, 11, 2, 9), local(2026, 11, 2, 10), category=cat_no)
        E("allday no end", local(2026, 11, 3), None, allday=True)
        E("end before start", local(2026, 11, 4, 10), local(2026, 11, 4, 9))
        E("zero length", local(2026, 11, 4, 12), local(2026, 11, 4, 12))
        E("utc midnight allday", utc(2026, 3, 8), utc(2026, 3, 9), allday=True)        # meant as Mar 8 (UTC date)
        E("utc midnight timed", utc(2026, 3, 8), utc(2026, 3, 8, 1))
        E("dst start allday", local(2026, 3, 8), local(2026, 3, 9), allday=True)        # local midnights across DST
        E("dst end allday", local(2026, 11, 1), local(2026, 11, 2), allday=True)
        E("multi-day", local(2026, 11, 20), local(2026, 11, 23), allday=True, category=6)
        E("", local(2026, 11, 5, 9), local(2026, 11, 5, 10), description=None, location=None)
        E("empty strings", local(2026, 11, 5, 11), local(2026, 11, 5, 12), description="", location="")
        E("Tea &amp; cake <b>bold</b>", local(2026, 11, 6, 15), local(2026, 11, 6, 16))
        E("L" * 256, local(2026, 11, 6, 17), local(2026, 11, 6, 18))
        E("weird priority", local(2026, 11, 7, 9), local(2026, 11, 7, 10), priority=999, custom_info=None)
        E("negative priority", local(2026, 11, 7, 11), local(2026, 11, 7, 12), priority=-5, completed=True, public=True)
        E("repeats", local(2026, 11, 2, 7), local(2026, 11, 2, 8), repeat_every=7, repeat_end=dt.date(2026, 11, 30))
        E("repeats forever", local(2026, 11, 2, 6), local(2026, 11, 2, 7), repeat_every=1)
        E("repeat zero", local(2026, 11, 9, 7), local(2026, 11, 9, 8), repeat_every=0)
        E("repeat ends before", local(2026, 11, 9, 9), local(2026, 11, 9, 10), repeat_every=2,
          repeat_end=dt.date(2026, 10, 1))
        E("deadline", local(2026, 11, 10, 23, 59))
        E("list info", local(2026, 11, 10, 9), local(2026, 11, 10, 10), custom_info=["x", 1], priority=3)
        E("allday end before start", local(2026, 11, 14), local(2026, 11, 13), allday=True)
        for cal in (self.c_ics, self.c_ics, self.c_google):  # a duplicate sync id in ICS, the same id in Google
            E("synced", local(2026, 11, 11, 9), local(2026, 11, 11, 10), cal=cal, sync_id="uid-1")
        E("uw event", local(2026, 11, 12, 9), local(2026, 11, 12, 10), cal=self.c_uw, sync_id="uw-1")
        E("ben's event", local(2026, 11, 12, 9), local(2026, 11, 12, 10), cal=self.c_ben)
        E("inactive", local(2026, 11, 12, 9), local(2026, 11, 12, 10), cal=self.c_old)

        T = lambda name, **kw: Todo.objects.create(user=amy, name=name, **kw)
        for st in (0, 1, 2, 3, 11, 12, 13, 100):
            T(f"status {st}", status=st)
        T("done, no date", completed=True, completed_on=None)
        top = T("parent")
        mid = T("child", parent=top)
        T("grandchild", parent=mid, complete_by=local(2026, 11, 6, 23, 59))

        N = M("notifications", "Notification")
        for p in (10, 5, 99, -3):
            N.objects.create(user=amy, title=f"p{p}", source="Calendar", description=None, priority=p)
        Album, AlbumSub, Photo = M("photos", "Album"), M("photos", "Album_Subscriber"), M("photos", "Photo")
        album = Album.objects.create(name="Trip", owner=amy, location="Trip")
        AlbumSub.objects.create(album=album, user=amy, subscribe_type=0)
        Photo.objects.create(owner=amy, album=album, filepath="a.jpg", orientation="", date_taken=None,
                             file_not_available=True)
        Photo.objects.create(owner=amy, album=album, filepath="b.jpg", orientation="", latitude=43.5, longitude=-80.5,
                             date_taken=local(2026, 11, 2, 12))
        G, L = M("map", "LocationGroup"), M("map", "Location")
        L.objects.create(name="Home", latitude=43.4, longitude=-80.5, group=G.objects.create(name="Mine", owner=amy))

        self.before = {f"{a}.{m}": apps.get_model(a, m).objects.count() for a, m in (
            ("scheduler", "Event"), ("scheduler", "Calendar"), ("scheduler", "Subscriber"), ("scheduler", "Invite"),
            ("scheduler", "Todo"), ("notifications", "Notification"), ("photos", "Photo"), ("users", "ComptechUser"),
            ("map", "Location"))}

    # ------------------------------------------------------------ the test

    def test_every_legacy_shape_migrates_and_is_served(self):
        self.write_legacy(self.to_production())
        self.to_latest()

        from django.apps import apps as current
        from scheduler.models import Calendar, CalendarMigrationLog, Event, Subscriber, Todo

        after = {k: current.get_model(*k.split(".")).objects.count() for k in self.before}
        self.assertEqual(after, {**self.before, "scheduler.Subscriber": self.before["scheduler.Subscriber"] + 1})
        # no rows lost; one added: the missing owner row of Ben's calendar

        ev = {e.name: e for e in Event.objects.select_related("event_category")}
        cat = lambda n: (ev[f"cat {n}"].event_category.name, ev[f"cat {n}"].event_category.legacy_id, ev[f"cat {n}"].category)
        self.assertEqual(cat(7), ("Tech Break", 7, 7))
        self.assertEqual(cat(100), ("Other", 100, 100))
        self.assertEqual(cat(42), ("Category 42", 42, 42))
        self.assertEqual({ev[f"cat {n}"].event_category.owner_id for n in (0, 42)}, {self.amy.id})
        self.assertEqual((ev["allday no end"].start_date, ev["allday no end"].end_date), (dt.date(2026, 11, 3), dt.date(2026, 11, 4)))
        e = ev["end before start"]
        self.assertEqual((e.kind, e.enddate, e.custom_info["legacy_enddate"]), ("event", e.startdate, local(2026, 11, 4, 9).astimezone(UTC).isoformat()))
        self.assertEqual(ev["zero length"].kind, "event")
        self.assertEqual((ev["utc midnight allday"].start_date, ev["utc midnight allday"].end_date), (dt.date(2026, 3, 8), dt.date(2026, 3, 9)))
        self.assertEqual(ev["utc midnight allday"].startdate, local(2026, 3, 8))
        self.assertEqual(ev["utc midnight timed"].kind, "event")
        self.assertEqual((ev["dst start allday"].start_date, ev["dst start allday"].end_date), (dt.date(2026, 3, 8), dt.date(2026, 3, 9)))
        self.assertEqual((ev["dst end allday"].start_date, ev["dst end allday"].end_date), (dt.date(2026, 11, 1), dt.date(2026, 11, 2)))
        self.assertEqual((ev["multi-day"].end_date - ev["multi-day"].start_date).days, 3)
        self.assertEqual((ev[""].name, ev[""].description, ev["empty strings"].location), ("", None, ""))
        self.assertEqual(ev["weird priority"].priority, 999)
        e = ev["negative priority"]
        self.assertEqual((e.priority, e.completed, e.visibility), (-5, True, "public"))
        self.assertEqual(ev["repeats"].rrule, "FREQ=DAILY;INTERVAL=7;UNTIL=20261201T045959Z")
        self.assertEqual((ev["repeats forever"].rrule, ev["repeats forever"].recurrence_end), ("FREQ=DAILY;INTERVAL=1", None))
        for name in ("repeat zero", "repeat ends before"):
            self.assertEqual(ev[name].rrule, "")
            self.assertIn("legacy_repeat", ev[name].custom_info)
        self.assertEqual((ev["deadline"].kind, ev["deadline"].transparency), ("deadline", "free"))
        self.assertEqual(ev["list info"].custom_info, {"legacy_custom_info": ["x", 1], "legacy_priority": 3})
        e = ev["allday end before start"]
        self.assertEqual((e.start_date, e.end_date), (dt.date(2026, 11, 14), dt.date(2026, 11, 15)))
        synced = Event.objects.filter(name="synced")
        self.assertEqual(sorted((e.calendar_id, e.sync_id or "") for e in synced),
                         sorted([(self.c_ics.id, "uid-1"), (self.c_ics.id, ""), (self.c_google.id, "uid-1")]))
        colours = dict(Calendar.objects.values_list("name", "colour"))
        self.assertEqual([colours[n] for n in ("Local", "ICS", "Google", "UW", "Ben's")],
                         ["#000000", "#aabbcc", "#ff0000", "#1a73e8", "#ABCDEF"])
        self.assertEqual(Subscriber.objects.get(calendar_id=self.c_ben.id, user_id=self.amy.id).colour, "#0000ff")
        self.assertIsNone(Subscriber.objects.filter(calendar_id=self.c_local.id, user_id=self.cat.id).order_by("id")[0].colour)
        roles = {(s.calendar_id, s.user_id): s.subscribe_type for s in Subscriber.objects.filter(calendar_id=self.c_ben.id)}
        self.assertEqual(roles, {(self.c_ben.id, self.ben.id): 0, (self.c_ben.id, self.amy.id): 1})
        windows = {c.name: (c.sync_past_months, c.sync_future_months) for c in Calendar.objects.all()}
        self.assertEqual(windows["ICS"][0], 0)
        self.assertEqual(windows["Google"][1], 12)  # no end month → default, noted in the log
        log = CalendarMigrationLog.objects.get().counts
        self.assertEqual((log["calendar_colours_fixed"], log["subscriber_colours_fixed"], log["duplicate_subscriber_rows"],
                          log["end_before_start_fixed"], log["all_day_utc_midnight"], log["repeat_skipped"]),
                         (3, 2, 1, 1, 1, 2))

        # ---- the APIs serve it
        from users.models import ComptechUser
        self.client.force_login(ComptechUser.objects.get(username="amy"))
        get = lambda url, **q: self.client.get(url, q)
        r = get("/api/v2/calendar/events", start="2026-11-01T00:00:00-04:00", end="2026-12-01T00:00:00-05:00")
        self.assertEqual(r.status_code, 200, r.content[:300])
        names = [x["name"] for x in r.json()]
        self.assertEqual(names.count("repeats"), 5)  # Nov 2, 9, 16, 23, 30 (repeat_end is inclusive)
        self.assertEqual(names.count("repeats forever"), 29)  # Nov 2 … 30
        self.assertNotIn("inactive", names)
        march = [x["name"] for x in get("/api/v2/calendar/events", start="2026-03-01T00:00:00-05:00",
                                         end="2026-04-01T00:00:00-04:00").json()]
        self.assertIn("utc midnight allday", march)
        v2cals = get("/api/v2/calendar/calendars", include_inactive="true").json()
        self.assertEqual(len(v2cals), 6)
        self.assertEqual({c["name"]: c["role"] for c in v2cals}["Ben's"], "admin")
        for url in ("/api/v2/calendar/agenda?days=60", "/api/v2/calendar/insights?period=month&date=2026-11-10",
                    f"/api/v2/calendar/calendars/{self.c_ics.id}", "/api/v2/tasks/overview", "/api/v2/tasks/",
                    "/api/v2/notifications/", "/api/v2/photos/summary",
                    "/api/v2/calendar/availability/amy?date=2026-11-04", "/api/v2/calendar/categories"):
            self.assertEqual(self.client.get(url).status_code, 200, url)
        ins = get("/api/v2/calendar/insights", period="month", date="2026-11-10").json()
        self.assertIn("Category 42", {c["name"] for c in ins["by_category"]})
        # todos land in the Inbox, nothing lost
        inbox = {t.project.name for t in Todo.objects.select_related("project")}
        self.assertEqual(inbox, {"Inbox"})
        self.assertEqual(Todo.objects.get(name="grandchild").parent.parent.name, "parent")
        # the ICS feed
        url = self.client.post("/api/v2/feeds/", {"kind": "calendar", "name": "Phone"},
                               content_type="application/json").json()["url"]
        body = self.client.get("/" + url.split("://", 1)[-1].split("/", 1)[1]).content.decode()
        self.assertIn("RRULE:FREQ=DAILY;INTERVAL=7", body.replace("\r\n ", ""))
        self.assertIn("SUMMARY:Tea &amp\\; cake <b>bold</b>", body.replace("\r\n ", ""))
        # photos: views still answer
        from photos.models import PhotoDaily, PhotoLocationCache, refresh_photo_matviews
        refresh_photo_matviews()  # materialized on Postgres (a no-op on SQLite)
        self.assertEqual(sum(d.photos for d in PhotoDaily.objects.all()), 1)  # the dated one
        self.assertEqual(PhotoLocationCache.objects.count(), 1)

        # ---- rollback to production's schema gives the old columns back
        apps = self.to_production()
        Old = apps.get_model("scheduler", "Event")
        old = {e.name: e for e in Old.objects.all()}
        self.assertEqual(Old.objects.count(), self.before["scheduler.Event"])
        self.assertEqual((old["weird priority"].priority, old["negative priority"].completed, old["negative priority"].public),
                         (999, True, True))
        self.assertEqual((old["repeats"].repeat_every, old["repeat zero"].repeat_every), (7, 0))
        self.assertEqual(old["end before start"].enddate, local(2026, 11, 4, 9))
        self.assertEqual(old["list info"].custom_info, ["x", 1])
        self.assertEqual(sorted(e.sync_id for e in Old.objects.filter(name="synced")), ["uid-1"] * 3)
        self.assertEqual(old["utc midnight allday"].startdate, utc(2026, 3, 8))
        OldCal = apps.get_model("scheduler", "Calendar")
        self.assertEqual(OldCal.objects.get(name="ICS").auto_sync_sm, -1)
