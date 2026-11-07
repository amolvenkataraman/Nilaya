import datetime as dt
import json
from unittest import mock

import pytz
from django.test import TestCase

from apikeys.models import ApiKey
from notifications.models import Notification
from users.models import ComptechUser

from . import reminders, service
from .models import Entry, Habit, HabitSettings

D = dt.date
WED = D(2026, 11, 4)  # "today" in the pure-logic tests
MON, TUE, FRI = 0b1, 0b10, 0b10000


def day(n, base=WED):
    return base + dt.timedelta(days=n)


def mk(user, **kw):
    kw.setdefault("name", "Habit")
    kw.setdefault("start_date", day(-30))
    return Habit.objects.create(user=user, **kw)


def log(habit, *days, value=1, skipped=False):
    Entry.objects.bulk_create([Entry(habit=habit, date=d, value=value, skipped=skipped) for d in days])


class ScheduleTests(TestCase):
    def test_weekdays_interval_and_date_range(self):
        h = Habit(start_date=D(2026, 11, 2), end_date=D(2026, 11, 13), schedule="weekdays", weekdays=MON | 0b100 | FRI)
        self.assertEqual([service.is_scheduled(h, day(n, D(2026, 11, 2))) for n in range(7)],
                         [True, False, True, False, True, False, False])
        self.assertFalse(service.is_scheduled(h, D(2026, 11, 1)))   # before start
        self.assertFalse(service.is_scheduled(h, D(2026, 11, 16)))  # a Monday after the end
        every3 = Habit(start_date=D(2026, 11, 2), schedule="interval", interval=3)
        self.assertEqual([d.day for d in (day(n, D(2026, 11, 2)) for n in range(8)) if service.is_scheduled(every3, d)],
                         [2, 5, 8])


class LogicTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.u = ComptechUser.objects.create_user("hab", password="pw")

    def stats(self, h, today=WED):
        return service.habit_stats(h, today)

    def test_daily_streak_ignores_skips_unscheduled_days_and_pending_today(self):
        h = mk(self.u, schedule="weekdays", weekdays=MON | 0b100 | FRI, start_date=D(2026, 10, 12))
        log(h, D(2026, 10, 12), D(2026, 10, 14), D(2026, 10, 16), D(2026, 10, 19), D(2026, 10, 21))  # 5, then Fri 23 missed
        log(h, D(2026, 10, 26), D(2026, 10, 30), D(2026, 11, 2))
        log(h, D(2026, 10, 28), value=0, skipped=True)
        s = self.stats(h)
        self.assertEqual((s["current_streak"], s["best_streak"], s["streak_unit"]), (3, 5, "day"))
        log(h, WED)
        self.assertEqual(self.stats(h)["current_streak"], 4)

    def test_weekly_goal_streak_counts_weeks_and_skips_scale_the_target(self):
        h = mk(self.u, target=3, period="week", start_date=D(2026, 10, 5))   # week of Oct 5: nothing -> missed
        log(h, D(2026, 10, 12), D(2026, 10, 13), D(2026, 10, 15))             # met
        log(h, D(2026, 10, 19))                                               # 1 of ceil(3*2/7)=1: met
        log(h, *[D(2026, 10, d) for d in range(20, 25)], value=0, skipped=True)
        log(h, D(2026, 10, 26), D(2026, 10, 28), D(2026, 11, 1))              # met
        log(h, D(2026, 11, 2))                                                # this week: 1 of 3, in progress
        s = self.stats(h)
        self.assertEqual((s["current_streak"], s["best_streak"], s["streak_unit"]), (3, 3, "week"))
        log(h, D(2026, 11, 3), WED)
        self.assertEqual(self.stats(h)["current_streak"], 4)

    def test_at_least_and_at_most_goals(self):
        water = mk(self.u, kind="measurable", unit="glasses", target=8, start_date=day(-2))
        log(water, day(-2), value=5)
        log(water, day(-1), value=9)
        self.assertEqual(self.stats(water)["current_streak"], 1)              # 5 < 8 missed; today pending
        coffee = mk(self.u, kind="measurable", unit="cups", goal="at_most", target=2, start_date=day(-3))
        log(coffee, day(-2), value=3)                                         # over; day -3 unlogged = 0 = kept
        log(coffee, day(-1), value=2)
        e = Entry.objects.create(habit=coffee, date=WED, value=1)
        s = self.stats(coffee)
        self.assertEqual((s["current_streak"], s["best_streak"]), (2, 2))
        e.value = 3
        e.save()
        self.assertEqual(self.stats(coffee)["current_streak"], 0)              # over the limit today: broken now

    def test_completion_rates_and_score(self):
        h = mk(self.u, start_date=day(-89))
        log(h, *[day(-n) for n in range(7, 90)], day(-6), day(-4), day(-2), WED)
        s = self.stats(h)
        self.assertAlmostEqual(s["rates"]["d7"], 4 / 7)
        self.assertAlmostEqual(s["rates"]["all"], 87 / 90)
        never = mk(self.u, start_date=day(-89))
        always = mk(self.u, start_date=day(-89))
        log(always, *[day(-n) for n in range(90)])
        scores = [self.stats(x)["score"] for x in (never, h, always)]
        self.assertEqual(scores[0], 0)
        self.assertTrue(scores[0] < scores[1] < scores[2] and scores[2] >= 95, scores)

    def test_resuming_a_paused_habit_keeps_its_streak(self):
        h = mk(self.u, start_date=day(-10))
        log(h, *[day(-n) for n in range(5, 11)])
        Habit.objects.filter(pk=h.pk).update(paused=True, paused_on=day(-4))
        h.refresh_from_db()
        service.set_paused(h, False, WED)
        self.assertEqual(Entry.objects.filter(habit=h, skipped=True).count(), 4)
        self.assertEqual(self.stats(h)["current_streak"], 6)

    def test_an_old_start_date_costs_entries_not_days(self):
        start = D(1950, 1, 1)
        coffee = mk(self.u, kind="measurable", unit="cups", goal="at_most", target=2, start_date=start)
        log(coffee, D(1990, 6, 5), value=3)  # the one day over the limit
        units = service.evaluate(coffee, {D(1990, 6, 5): (3.0, False)}, WED)
        self.assertLess(len(units), service.DETAIL_DAYS + 10)  # was one Unit per day since 1950
        s = self.stats(coffee)
        self.assertEqual((s["current_streak"], s["best_streak"]), ((WED - D(1990, 6, 5)).days, (D(1990, 6, 5) - start).days))
        self.assertAlmostEqual(s["rates"]["all"], 1 - 1 / ((WED - start).days + 1))


class ApiTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.u = ComptechUser.objects.create_user("amy", password="pw", timezone="America/Los_Angeles")
        cls.other = ComptechUser.objects.create_user("eve", password="pw")

    def setUp(self):
        self.client.force_login(self.u)
        self.today = service.local_today(self.u)

    def call(self, method, path, body=None, **extra):
        if method == "get":
            return self.client.get("/api/v2/habits/" + path, **extra)
        return getattr(self.client, method)("/api/v2/habits/" + path, data=json.dumps(body if body is not None else {}),
                                            content_type="application/json", **extra)

    def test_check_uses_the_users_local_date(self):
        tokyo = ComptechUser.objects.create_user("kei", password="pw", timezone="Asia/Tokyo")
        now = pytz.utc.localize(dt.datetime(2026, 11, 4, 3, 0))  # Tokyo noon Nov 4, Los Angeles 8 pm Nov 3
        self.assertEqual(service.local_today(tokyo, now), D(2026, 11, 4))
        h = mk(self.u, start_date=D(2026, 10, 1))
        with mock.patch("django.utils.timezone.now", return_value=now):
            r = self.call("post", f"{h.id}/check")
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(list(h.entries.values_list("date", flat=True)), [D(2026, 11, 3)])

    def test_check_toggles_yesno_and_increments_measurable(self):
        h = mk(self.u)
        self.assertTrue(self.call("post", f"{h.id}/check").json()["done"])
        self.assertFalse(self.call("post", f"{h.id}/check").json()["done"])
        water = mk(self.u, kind="measurable", unit="glasses", target=8)
        self.call("post", f"{water.id}/check", {"amount": 3})
        r = self.call("post", f"{water.id}/check", {"amount": 5}).json()
        self.assertEqual((r["value"], r["done"]), (8, True))
        self.assertEqual(self.call("post", f"{water.id}/check", {"amount": -20}).json()["value"], 0)

    def test_backfill_edit_and_one_row_per_day(self):
        h = mk(self.u, start_date=self.today - dt.timedelta(days=5))
        y = self.today - dt.timedelta(days=1)
        self.assertEqual(self.call("put", f"entries/{h.id}/{y}", {"value": 1}).status_code, 200)
        r = self.call("put", f"entries/{h.id}/{y}", {"value": 0, "skipped": True, "note": "Sick <b>day</b>"})
        self.assertEqual((r.json()["skipped"], r.json()["note"]), (True, "Sick day"))
        self.assertEqual(h.entries.count(), 1)
        for bad in (self.today + dt.timedelta(days=1), h.start_date - dt.timedelta(days=1)):
            self.assertEqual(self.call("put", f"entries/{h.id}/{bad}", {"value": 1}).status_code, 400)
        got = self.call("get", f"entries?start={y}&end={self.today}").json()
        self.assertEqual([(e["date"], e["skipped"]) for e in got], [(str(y), True)])
        self.assertEqual(self.call("delete", f"entries/{h.id}/{y}").status_code, 204)
        self.assertFalse(h.entries.exists())
        self.call("put", f"entries/{h.id}/{self.today}", {"value": 1})
        r = self.call("put", f"entries/{h.id}/{self.today}", {"value": 0, "note": ""}).json()  # emptied: row removed
        self.assertEqual((r["today"]["done_today"], h.entries.count()), (False, 0))

    def test_validation(self):
        base = {"name": "Read", "start_date": str(self.today)}
        self.assertEqual(self.call("post", "", base).status_code, 201)
        for bad in ({"target": 0}, {"goal": "at_most", "target": 0}, {"schedule": "weekdays", "weekdays": 0},
                    {"end_date": str(self.today - dt.timedelta(days=1))}, {"start_date": "1800-01-01"}):
            self.assertEqual(self.call("post", "", {**base, **bad}).status_code, 400, bad)
        for bad in ({"colour": "red"}, {"period": "year"}, {"name": ""}, {"interval": 0}):
            self.assertEqual(self.call("post", "", {**base, **bad}).status_code, 422, bad)
        h = mk(self.u)
        self.assertEqual(self.call("put", f"entries/{h.id}/{self.today}", {"value": 2}).status_code, 400)
        self.assertEqual(self.call("get", f"entries?start=2024-01-01&end={self.today}").status_code, 400)

    def test_owner_scoping_reorder_and_api_key(self):
        mine, theirs = mk(self.u, name="Mine"), mk(self.other, name="Theirs")
        mine2 = mk(self.u, name="Mine 2", position=1)
        log(theirs, self.today - dt.timedelta(days=1))
        self.assertEqual([h["name"] for h in self.call("get", "").json()], ["Mine", "Mine 2"])
        for method, path in (("get", f"{theirs.id}/stats"), ("patch", f"{theirs.id}"), ("post", f"{theirs.id}/check"),
                             ("put", f"entries/{theirs.id}/{self.today}"), ("delete", f"{theirs.id}")):
            self.assertEqual(self.call(method, path, {}).status_code, 404, path)
        self.assertEqual(self.call("get", f"entries?start={self.today - dt.timedelta(days=3)}&end={self.today}").json(), [])
        self.assertEqual(self.call("post", "reorder", {"ids": [str(theirs.id), str(mine.id)]}).status_code, 404)
        self.call("post", "reorder", {"ids": [str(mine2.id), str(mine.id)]})
        self.assertEqual([h["name"] for h in self.call("get", "").json()], ["Mine 2", "Mine"])
        self.client.logout()
        _, token = ApiKey.issue(self.u, "Shortcut", ["habits:write"])
        r = self.call("post", f"{mine.id}/check", HTTP_AUTHORIZATION=f"Bearer {token}")
        self.assertEqual((r.status_code, r.json()["done"]), (200, True))

    def test_today_lists_due_habits_with_status_and_streak(self):
        not_today = 0b1111111 & ~(1 << self.today.weekday())
        done = mk(self.u, name="Done", start_date=self.today - dt.timedelta(days=3))
        log(done, *[self.today - dt.timedelta(days=n) for n in range(4)])
        mk(self.u, name="Open")
        mk(self.u, name="Off", schedule="weekdays", weekdays=not_today)
        mk(self.u, name="Paused", paused=True)
        mk(self.u, name="Gone", archived=True)
        weekly = mk(self.u, name="Weekly", target=3, period="week",
                    start_date=self.today - dt.timedelta(days=7))  # a full week before: no prorated first week
        log(weekly, self.today)
        mk(self.u, name="Limit", kind="measurable", unit="cups", goal="at_most", target=2,
           start_date=self.today - dt.timedelta(days=30))  # relative to the real today, not the fixed WED
        r = self.call("get", "today").json()
        self.assertEqual(r["date"], str(self.today))
        got = {h["habit"]["name"]: (h["due"], h["done"], h["streak"]) for h in r["habits"]}
        self.assertEqual(got, {"Done": (True, True, 4), "Open": (True, False, 0), "Off": (False, False, 0),
                               "Paused": (False, False, 0), "Weekly": (True, False, 0), "Limit": (True, False, 31)})
        flags = {h["habit"]["name"]: (h["goal_met"], h["done_today"], h["status"]) for h in r["habits"]}
        self.assertEqual(flags["Weekly"], (False, True, "partial"))   # ticked today, week goal still open
        self.assertEqual(flags["Limit"], (True, False, "kept"))       # within the limit: kept, not "done"
        self.assertEqual((r["done"], r["total"]), (1, 3))


class ReminderTests(TestCase):
    def setUp(self):
        self.u = ComptechUser.objects.create_user("rem", password="pw", timezone="America/Los_Angeles")
        self.tz = pytz.timezone("America/Los_Angeles")

    def at(self, h, m):
        return self.tz.localize(dt.datetime(2026, 11, 4, h, m))

    def test_reminder_fires_once_at_local_time_unless_done_or_a_limit(self):
        mk(self.u, name="Stretch", reminder_time=dt.time(8, 0))
        done = mk(self.u, name="Water", reminder_time=dt.time(8, 0))
        log(done, D(2026, 11, 4))
        mk(self.u, name="Coffee", kind="measurable", goal="at_most", target=2, reminder_time=dt.time(8, 0))
        for t in ((7, 59), (8, 0), (8, 5)):
            reminders.run(self.at(*t))
        self.assertEqual(list(Notification.objects.values_list("title", flat=True)), ["Time for Stretch"])

    def test_evening_nudge_counts_whats_left(self):
        HabitSettings.objects.create(user=self.u, evening_nudge=True)
        a, _, _ = mk(self.u, name="A"), mk(self.u, name="B"), mk(self.u, name="C")
        log(a, D(2026, 11, 4))
        reminders.run(self.at(19, 59))
        self.assertFalse(Notification.objects.exists())
        reminders.run(self.at(20, 0))
        reminders.run(self.at(20, 1))
        self.assertEqual(list(Notification.objects.values_list("title", flat=True)), ["2 habits left today"])
