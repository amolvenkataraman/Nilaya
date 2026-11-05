"""Habits: things a person wants to do (or limit) regularly, and one Entry per habit per local day.

Dates are always the user's local calendar date (users.timezone), never the server's.
Rules (schedule, goals, streaks, score) live in service.py.
"""

import datetime
import uuid

from django.db import models

from users.models import ComptechUser

ALL_DAYS = 0b1111111  # weekday bitmask, Monday = bit 0 ... Sunday = bit 6


class Habit(models.Model):
    class Kind(models.TextChoices):
        YESNO = "yesno", "Yes / no"
        MEASURABLE = "measurable", "Measurable"

    class Goal(models.TextChoices):
        AT_LEAST = "at_least", "At least"
        AT_MOST = "at_most", "At most"

    class Period(models.TextChoices):
        DAY = "day", "Day"
        WEEK = "week", "Week"
        MONTH = "month", "Month"

    class Schedule(models.TextChoices):
        DAILY = "daily", "Every day"
        WEEKDAYS = "weekdays", "Specific weekdays"
        INTERVAL = "interval", "Every N days"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(ComptechUser, on_delete=models.CASCADE, related_name="habits")
    name = models.CharField(max_length=80)
    description = models.TextField(blank=True, default="")
    colour = models.CharField(max_length=7, blank=True, default="")  # "#rrggbb", "" = accent
    icon = models.CharField(max_length=24, blank=True, default="")
    position = models.IntegerField(default=0)
    archived = models.BooleanField(default=False)
    paused = models.BooleanField(default=False)
    paused_on = models.DateField(null=True, blank=True)  # local date pausing began (resume fills skips)
    start_date = models.DateField()
    end_date = models.DateField(null=True, blank=True)

    kind = models.CharField(max_length=12, choices=Kind.choices, default=Kind.YESNO)
    unit = models.CharField(max_length=24, blank=True, default="")
    goal = models.CharField(max_length=8, choices=Goal.choices, default=Goal.AT_LEAST)
    target = models.FloatField(default=1)
    period = models.CharField(max_length=5, choices=Period.choices, default=Period.DAY)

    schedule = models.CharField(max_length=8, choices=Schedule.choices, default=Schedule.DAILY)
    weekdays = models.PositiveSmallIntegerField(default=ALL_DAYS)
    interval = models.PositiveSmallIntegerField(default=1)  # every N days, counted from start_date

    reminder_time = models.TimeField(null=True, blank=True)  # user's local time
    reminder_days = models.PositiveSmallIntegerField(default=ALL_DAYS)

    created_on = models.DateTimeField(auto_now_add=True)
    updated_on = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["position", "created_on"]
        indexes = [
            models.Index(fields=["user", "archived", "position"], name="habit_user_list_idx"),
            models.Index(fields=["reminder_time"], name="habit_reminder_idx",
                         condition=models.Q(reminder_time__isnull=False)),
        ]

    def __str__(self):
        return f"{self.name} ({self.user.username})"


class Entry(models.Model):
    """What happened on one local day. value: 1/0 for yes/no habits, an amount for measurable ones."""

    habit = models.ForeignKey(Habit, on_delete=models.CASCADE, related_name="entries")
    date = models.DateField()
    value = models.FloatField(default=0)
    note = models.CharField(max_length=500, blank=True, default="")
    skipped = models.BooleanField(default=False)
    updated_on = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["date"]
        # The unique constraint is also the (habit, date) index every range query uses.
        constraints = [models.UniqueConstraint(fields=["habit", "date"], name="habit_entry_one_per_day")]

    def __str__(self):
        return f"{self.habit.name} {self.date}: {self.value}"


class HabitSettings(models.Model):
    """Per-user options: an evening nudge listing what's left today."""

    user = models.OneToOneField(ComptechUser, on_delete=models.CASCADE, related_name="habit_settings")
    evening_nudge = models.BooleanField(default=False)
    nudge_time = models.TimeField(default=datetime.time(20, 0))

    def __str__(self):
        return f"Habit settings for {self.user.username}"
