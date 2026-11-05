"""Local dev data: a few habits with ~60 days of realistic history for one user.

    DJANGO_SETTINGS_MODULE=Comptech.settings_local .venv/bin/python manage.py seed_habits [--user amol] [--fresh]
"""

import datetime as dt
import random

from django.core.management.base import BaseCommand, CommandError

from habits import service
from habits.models import Entry, Habit, HabitSettings
from users.models import ComptechUser

DAYS = 62
HABITS = [
    # name, fields, chance of doing it on a scheduled day, value generator
    ("Drink water", dict(kind="measurable", unit="glasses", target=8, icon="drop", colour="#2a78d6",
                         reminder_time=dt.time(15, 0)), 0.8, lambda r: r.choice([5, 6, 7, 8, 8, 9, 10])),
    ("Read", dict(kind="measurable", unit="minutes", target=20, icon="book", colour="#6250d6",
                  reminder_time=dt.time(21, 30)), 0.7, lambda r: r.choice([10, 15, 20, 25, 30, 45])),
    ("Exercise", dict(kind="yesno", target=3, period="week", icon="dumbbell", colour="#eb6834"), 0.5, None),
    ("Meditate", dict(kind="yesno", icon="leaf", colour="#1baf7a", reminder_time=dt.time(7, 30)), 0.85, None),
    ("No sugar", dict(kind="measurable", unit="servings", goal="at_most", target=0, icon="ban", colour="#e34948"),
     0.15, lambda r: r.choice([1, 1, 2])),
    ("Journal", dict(kind="yesno", schedule="weekdays", weekdays=0b0011111, icon="pen", colour="#eda100"), 0.75, None),
]
NOTES = ["Felt great", "Short one today", "Busy day, still did it", "Morning, before work", "With Alex",
         "Tired but done", "New personal best"]


class Command(BaseCommand):
    help = "Seed habits with ~60 days of history (local data)"

    def add_arguments(self, parser):
        parser.add_argument("--user", default="amol")
        parser.add_argument("--fresh", action="store_true", help="Delete the user's habits first")

    def handle(self, user, fresh, **_):
        u = ComptechUser.objects.filter(username=user).first()
        if u is None:
            raise CommandError(f"No user {user}")
        if fresh:
            Habit.objects.filter(user=u).delete()
        elif Habit.objects.filter(user=u).exists():
            self.stdout.write("Habits already exist (use --fresh to replace them)")
            return
        r = random.Random(42)
        today = service.local_today(u)
        start = today - dt.timedelta(days=DAYS)
        entries = []
        for pos, (name, fields, chance, gen) in enumerate(HABITS):
            h = Habit.objects.create(user=u, name=name, position=pos, start_date=start, **fields)
            vacation = {today - dt.timedelta(days=d) for d in range(24, 27)}
            for n in range(DAYS):  # up to yesterday; today is left for clicking
                d = start + dt.timedelta(days=n)
                if not service.matches_rule(h, d):
                    continue
                if d in vacation and h.goal == "at_least" and h.period == "day":
                    entries.append(Entry(habit=h, date=d, skipped=True, note="Travelling" if d == min(vacation) else ""))
                    continue
                momentum = 0.1 if n > DAYS - 21 else 0  # getting better lately
                if r.random() < chance + (momentum if h.goal == "at_least" else -0.08):
                    value = gen(r) if gen else 1
                    note = r.choice(NOTES) if r.random() < 0.08 and h.goal == "at_least" else ""
                    entries.append(Entry(habit=h, date=d, value=value, note=note))
                elif gen and h.goal == "at_least" and r.random() < 0.5:
                    entries.append(Entry(habit=h, date=d, value=max(1, gen(r) // 3)))
        Entry.objects.bulk_create(entries, ignore_conflicts=True)
        HabitSettings.objects.update_or_create(user=u, defaults={"evening_nudge": True})
        self.stdout.write(self.style.SUCCESS(f"Seeded {len(HABITS)} habits, {len(entries)} entries for {u.username}"))
