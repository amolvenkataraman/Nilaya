"""The calendar schema migration (0034–0037) converts legacy rows without losing anything."""

import datetime as dt
import importlib
from zoneinfo import ZoneInfo

from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from django.test import SimpleTestCase, TransactionTestCase

BEFORE = [("scheduler", "0033_todo_bucket_todo_colour_todo_created_on_and_more")]
AFTER = [("scheduler", "0037_calendar_schema_finish")]
data_mig = importlib.import_module("scheduler.migrations.0036_calendar_schema_data")
TZ = ZoneInfo("Canada/Eastern")
UTC = dt.timezone.utc


class SyncWindowConversionTests(SimpleTestCase):
    def test_old_month_year_pairs_become_a_relative_window(self):
        today = dt.date(2026, 11, 5)
        conv = data_mig.convert_sync_window
        self.assertEqual(conv(-1, -1, 12, 2026, today)[:2], (0, 1))      # "current month" → 0 back
        self.assertEqual(conv(9, 2026, 5, 2027, today)[:2], (2, 6))       # Sep 2026 .. May 2027
        self.assertEqual(conv(1, 2026, 6, 2026, today)[:2], (10, 0))      # end already passed → 0, noted
        self.assertIn("passed", conv(1, 2026, 6, 2026, today)[2])
        self.assertEqual(conv(None, None, None, None, today)[:2], (1, 12))  # never configured → defaults
        self.assertEqual(data_mig.legacy_sync_window(2, 6, today), (9, 2026, 5, 2027))
        self.assertEqual(data_mig.legacy_sync_window(0, 1, today), (-1, -1, 12, 2026))


class MigrateLegacyRowsTests(TransactionTestCase):
    """Builds legacy rows at 0033 with the historical models, migrates to 0036, checks them, and back."""

    def migrate(self, scheduler_target):
        """Every other app at its latest migration, scheduler at the target."""
        ex = MigrationExecutor(connection)
        targets = [n for n in ex.loader.graph.leaf_nodes() if n[0] != "scheduler"] + scheduler_target
        ex.migrate(targets)
        ex.loader.build_graph()
        return ex.loader.project_state(targets).apps

    def tearDown(self):
        ex = MigrationExecutor(connection)
        ex.loader.build_graph()
        ex.migrate(ex.loader.graph.leaf_nodes())

    def test_forwards_converts_every_legacy_value_and_backwards_restores_them(self):
        apps = self.migrate(BEFORE)
        User = apps.get_model("users", "ComptechUser")
        Calendar = apps.get_model("scheduler", "Calendar")
        Subscriber = apps.get_model("scheduler", "Subscriber")
        Event = apps.get_model("scheduler", "Event")
        ann = User.objects.create(username="ann")
        bob = User.objects.create(username="bob")
        cal = Calendar.objects.create(name="Mine", owner=ann, calendar_type=1, auto_sync_sm=-1, auto_sync_sy=-1,
                                      auto_sync_em=12, auto_sync_ey=2099)
        Subscriber.objects.create(calendar=cal, user=bob, subscribe_type=0)  # a second "owner"; ann has no row
        at = lambda d, h: dt.datetime(2026, 11, d, h, tzinfo=TZ)
        timed = Event.objects.create(calendar=cal, name="Talk", startdate=at(3, 9), enddate=at(3, 10), category=1,
                                     priority=15, completed=True, public=True, sync_id="x")
        dup = Event.objects.create(calendar=cal, name="Talk copy", startdate=at(4, 9), enddate=at(4, 10), sync_id="x")
        # all-day stored the old way: local midnight to local midnight as UTC
        allday = Event.objects.create(calendar=cal, name="Trip", allday=True, category=6,
                                      startdate=at(7, 0).astimezone(UTC), enddate=at(9, 0).astimezone(UTC))
        due = Event.objects.create(calendar=cal, name="Essay", startdate=at(10, 23), category=8)
        rep = Event.objects.create(calendar=cal, name="Pills", startdate=at(1, 8), enddate=at(1, 9), repeat_every=2,
                                   repeat_end=dt.date(2026, 11, 30))

        apps = self.migrate(AFTER)
        Event = apps.get_model("scheduler", "Event")
        Subscriber = apps.get_model("scheduler", "Subscriber")
        Calendar = apps.get_model("scheduler", "Calendar")
        self.assertEqual(Event.objects.count(), 5)  # nothing lost
        e = {x.name: x for x in Event.objects.select_related("event_category")}
        self.assertEqual((e["Talk"].kind, e["Trip"].kind, e["Essay"].kind), ("event", "all_day", "deadline"))
        self.assertEqual((e["Trip"].start_date, e["Trip"].end_date), (dt.date(2026, 11, 7), dt.date(2026, 11, 9)))
        self.assertEqual(e["Trip"].startdate, at(7, 0))
        self.assertEqual(e["Essay"].transparency, "free")
        self.assertEqual((e["Talk"].event_category.name, e["Talk"].event_category.legacy_id, e["Talk"].category),
                         ("Meeting", 1, 1))
        self.assertEqual(e["Trip"].event_category.name, "Personal")
        self.assertEqual(e["Talk"].event_category.owner_id, ann.id)
        self.assertEqual(e["Talk"].visibility, "public")
        self.assertEqual(e["Talk"].custom_info, {"legacy_priority": 15, "legacy_completed": True})
        self.assertEqual(e["Talk"].sync_id, "x")
        self.assertIsNone(e["Talk copy"].sync_id)
        self.assertEqual(e["Talk copy"].custom_info["legacy_sync_id"], "x")
        self.assertEqual(e["Pills"].rrule, "FREQ=DAILY;INTERVAL=2;UNTIL=20261201T045959Z")
        self.assertEqual(e["Pills"].recurrence_end, at(29, 9))
        roles = dict(Subscriber.objects.filter(calendar_id=cal.id).values_list("user_id", "subscribe_type"))
        self.assertEqual(roles, {ann.id: 0, bob.id: 1})
        c = Calendar.objects.get(id=cal.id)
        self.assertEqual(c.sync_past_months, 0)
        self.assertGreater(c.sync_future_months, 800)

        apps = self.migrate(BEFORE)
        Event = apps.get_model("scheduler", "Event")
        old = {x.name: x for x in Event.objects.all()}
        self.assertEqual((old["Talk"].priority, old["Talk"].completed, old["Talk"].public), (15, True, True))
        self.assertEqual(old["Talk copy"].sync_id, "x")
        self.assertEqual((old["Pills"].repeat_every, old["Pills"].repeat_end), (2, dt.date(2026, 11, 30)))
        self.assertEqual(old["Talk"].custom_info, {})
        self.assertEqual(apps.get_model("scheduler", "Calendar").objects.get(id=cal.id).auto_sync_sm, -1)
