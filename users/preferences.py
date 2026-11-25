"""Per-account preferences: ComptechUser.preferences holds only what the user changed; `Preferences` gives every
setting its type and default, so adding one is a line here and a control in Settings (no migration).

A setting that has to be filtered across users in SQL gets its own column instead (the time zone; the automatic
reminders in notifications.ReminderSettings, which the reminder worker queries). Looks-only choices that belong to
one browser (theme, density, sidebar state) stay in that browser."""

import datetime
from typing import Literal, Optional

from ninja import Field, Schema
from pydantic import field_validator

Weekday = Literal[0, 1, 2, 3, 4, 5, 6]  # 0 = Sunday, as JavaScript's Date.getDay()


class QuietHours(Schema):
    """Pushes to phone, web and other channels wait until `end`; the in-app list still gets them at once."""
    enabled: bool = False
    start: datetime.time = datetime.time(22, 0)
    end: datetime.time = datetime.time(7, 0)


class Preferences(Schema):
    week_start: Literal[0, 1] = 0  # Sunday or Monday
    # When a new day begins for photos and habits: 05:00 puts a 1:30 am photo on the day before (late nights).
    day_starts_at: datetime.time = datetime.time(5, 0)
    time_format: Literal["auto", "12h", "24h"] = "auto"  # auto = the browser's language
    date_format: Literal["auto", "mdy", "dmy", "ymd"] = "auto"
    units: Literal["both", "km", "mi"] = "both"  # distances
    work_days: list[Weekday] = Field(default_factory=lambda: [1, 2, 3, 4, 5])
    work_start: datetime.time = datetime.time(9, 0)
    work_end: datetime.time = datetime.time(17, 0)
    quiet_hours: QuietHours = Field(default_factory=QuietHours)

    @field_validator("day_starts_at")
    @classmethod
    def _morning(cls, v):
        if v.hour >= 12 or v.second or v.minute % 15:
            raise ValueError("pick a quarter hour between midnight and noon")
        return v

    @field_validator("work_days")
    @classmethod
    def _days(cls, v):
        return sorted(set(v))


class PreferencesPatch(Schema):
    """Only the settings sent change; null puts one back to its default."""
    week_start: Optional[Literal[0, 1]] = None
    day_starts_at: Optional[datetime.time] = None
    time_format: Optional[Literal["auto", "12h", "24h"]] = None
    date_format: Optional[Literal["auto", "mdy", "dmy", "ymd"]] = None
    units: Optional[Literal["both", "km", "mi"]] = None
    work_days: Optional[list[Weekday]] = None
    work_start: Optional[datetime.time] = None
    work_end: Optional[datetime.time] = None
    quiet_hours: Optional[QuietHours] = None


DEFAULTS = Preferences()


def of(user) -> Preferences:
    """The user's preferences over the defaults. A stored value that no longer validates (a setting whose choices
    changed) falls back to its default instead of failing the request."""
    saved = getattr(user, "preferences", None) or {}
    if not saved:
        return DEFAULTS
    try:
        return Preferences(**saved)
    except ValueError:
        ok = {}
        for key, value in saved.items():
            try:
                Preferences(**{key: value})
                ok[key] = value
            except ValueError:
                pass
        return Preferences(**ok)


def update(user, patch: PreferencesPatch) -> Preferences:
    """Apply the sent settings (validated together, so work_end vs work_start is checked) and store only what
    differs from the defaults."""
    sent = patch.model_dump(exclude_unset=True)
    merged = {**of(user).model_dump(), **{k: v for k, v in sent.items() if v is not None}}
    for key in (k for k, v in sent.items() if v is None):
        merged[key] = DEFAULTS.model_dump()[key]
    prefs = Preferences(**merged)
    if prefs.work_end <= prefs.work_start:
        raise ValueError("Working hours must end after they start")
    defaults = DEFAULTS.model_dump(mode="json")
    user.preferences = {k: v for k, v in prefs.model_dump(mode="json").items() if v != defaults[k]}
    user.save(update_fields=["preferences"])
    return prefs


# ---------------------------------------------------------------- the user's day

def zone(user):
    """The user's time zone as a pytz zone (callers localize with it); the server's when theirs is blank or unknown."""
    import pytz
    from django.conf import settings
    name = getattr(user, "timezone", "") or ""
    if name not in pytz.all_timezones_set:
        name = settings.TIME_ZONE if settings.TIME_ZONE in pytz.all_timezones_set else "UTC"
    return pytz.timezone(name)


def day_offset(user) -> datetime.timedelta:
    """How far after midnight the user's day begins (05:00 → 5 h)."""
    t = of(user).day_starts_at
    return datetime.timedelta(hours=t.hour, minutes=t.minute)


def local_day(user, when: datetime.datetime, tz) -> datetime.date:
    """The day `when` belongs to for this user: its local time in `tz`, less the day start (1:30 am → yesterday)."""
    return (when.astimezone(tz) - day_offset(user)).date()


def today(user, tz, now: Optional[datetime.datetime] = None) -> datetime.date:
    from django.utils import timezone
    return local_day(user, now or timezone.now(), tz)


def day_bounds(user, day: datetime.date, tz, days: int = 1) -> tuple[datetime.datetime, datetime.datetime]:
    """[start, end) of `day` (and the `days - 1` after it) as aware datetimes: from the day start on that date to
    the day start after the last one, in local time (so DST days are 23 or 25 hours)."""
    start = datetime.datetime.combine(day, datetime.time()) + day_offset(user)
    end = start + datetime.timedelta(days=days)
    if hasattr(tz, "localize"):  # pytz
        return tz.localize(start), tz.localize(end)
    return start.replace(tzinfo=tz), end.replace(tzinfo=tz)
