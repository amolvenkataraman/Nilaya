"""The user's day for photos: a day begins at their day start (users.preferences, 5 am by default) in their time
zone, so a 1:30 am photo belongs to the evening before. Every place that puts photos into days uses these: the
per-day counts and headers, on this day, the busiest-day rankings, stats by weekday and month, and searched dates."""

import datetime

from django.db.models import DateField, F, Func

from users import preferences


user_tz = preferences.zone


class LocalDay(Func):
    """A timestamp's day for someone whose days begin `offset` after midnight in `tz`: its wall-clock time there,
    less the offset, as a date. The offset comes off local time (not UTC), so DST days stay right, exactly as
    users.preferences.local_day does in Python."""
    output_field = DateField()

    def __init__(self, expression, tz, offset: datetime.timedelta):
        super().__init__(F(expression) if isinstance(expression, str) else expression)
        self.tzname, self.offset = str(tz), offset

    def as_postgresql(self, compiler, connection, **extra):
        sql, params = compiler.compile(self.source_expressions[0])
        return f"(({sql} AT TIME ZONE %s) - %s)::date", (*params, self.tzname, self.offset)

    def as_sql(self, compiler, connection, **extra):  # SQLite (local testing): local date + time, then shift
        sql, params = compiler.compile(self.source_expressions[0])
        day, day_params = connection.ops.datetime_cast_date_sql(sql, params, self.tzname)
        if not self.offset:
            return day, day_params
        clock, clock_params = connection.ops.datetime_cast_time_sql(sql, params, self.tzname)
        minutes = int(self.offset.total_seconds() // 60)
        return f"date({day} || ' ' || {clock}, %s)", (*day_params, *clock_params, f"-{minutes} minutes")


def photo_day(user, tz=None, field="date_taken"):
    """SQL expression: the user's day each photo belongs to."""
    return LocalDay(field, tz or user_tz(user), preferences.day_offset(user))


def day_range(user, start: datetime.date, end: datetime.date, tz=None):
    """[from, to) covering the user's days start..end (inclusive), for an indexed date_taken filter."""
    return preferences.day_bounds(user, start, tz or user_tz(user), days=(end - start).days + 1)
