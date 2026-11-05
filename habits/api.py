"""/api/v2/habits/: habits, daily entries, today's checklist, stats and reminder settings."""

import datetime
import uuid
from typing import Literal, Optional

import bleach
from django.db import transaction
from django.db.models import Max
from django.shortcuts import get_object_or_404
from ninja import Body, Field, Router, Schema
from ninja.errors import HttpError

from . import service as svc
from .models import Entry, Habit, HabitSettings

router = Router(tags=["habits"])

GUIDE_INTRO = """Track habits you want to build (or limit), one entry per habit per day.

- **Days are the user's local calendar dates** (their profile time zone), as `YYYY-MM-DD`. "Today" and
  `POST {id}/check` always use the user's date, not the server's. Any past day from `start_date` on can
  be logged or edited (backfill); future days can't (400).
- **Kinds:** `yesno` (an entry's `value` is 1 = done, 0 = not) or `measurable` (an amount in `unit`,
  e.g. 8 glasses, 20 minutes, 5 km).
- **Goals:** `goal` `at_least` or `at_most` a `target` per `period` (`day`, `week`, `month`).
  "At least 3 times a week" = yesno, at_least, target 3, period week. "At most 2 coffees a day" =
  measurable, at_most, target 2, unit "coffees". `at_most` needs a measurable habit; an unlogged day
  counts as 0, so it's kept unless you log going over.
- **Schedule:** `daily`, `weekdays` (bitmask, Monday = 1, Tuesday = 2, Wednesday = 4 ... Sunday = 64;
  127 = every day) or `interval` (every `interval` days from `start_date`). Days off the schedule never
  break a streak; logging one anyway counts as a bonus.
- **Skipping** (`skipped: true` on an entry) excuses a day: it neither counts nor breaks the streak. For
  week/month goals, skipped days scale the target down in proportion. Pausing a habit (`paused: true`)
  stops reminders; resuming marks the paused days as skipped. Archived habits leave Today but keep stats.
- **Streaks** count days, or weeks/months for week/month goals (`streak_unit`). Only a missed day/period
  breaks one; today (or this week) not done yet is still pending.
- **Score** is a smoothed habit strength from 0 to 100 (recent days weigh more, like Loop Habit Tracker).
- **Heatmap** `levels` has one character per day from `start` to `end` (today): `0`-`4` intensity,
  `s` skipped, `o` not scheduled, `-` before the habit started. `values` holds each day's amount (or null).
- **Reminders:** `reminder_time` (local `HH:MM`) on `reminder_days` (same bitmask) notifies through the
  user's notification channels if the habit isn't done yet. `PATCH settings` turns on an evening nudge
  ("2 habits left today").

Phone shortcut: `POST /api/v2/habits/{id}/check` with an API key (`habits:write`) and no body toggles a
yes/no habit for today, or adds 1 to a measurable one; send `{"amount": 250}` to add more,
`{"done": true}` to set it explicitly, or `{"date": "YYYY-MM-DD"}` for an earlier day."""

HEX = r"^(#[0-9a-fA-F]{6})?$"
ICON = r"^[a-z0-9-]{0,24}$"
Kind = Literal["yesno", "measurable"]
Goal = Literal["at_least", "at_most"]
Period = Literal["day", "week", "month"]
Sched = Literal["daily", "weekdays", "interval"]


def _clean(text):
    return bleach.clean(text or "", tags=[], strip=True).strip()


# ================================================================ schemas

class HabitOut(Schema):
    id: uuid.UUID
    name: str
    description: str
    colour: str
    icon: str
    position: int
    archived: bool
    paused: bool
    start_date: datetime.date
    end_date: Optional[datetime.date]
    kind: Kind
    unit: str
    goal: Goal
    target: float
    period: Period
    schedule: Sched
    weekdays: int
    interval: int
    reminder_time: Optional[datetime.time]
    reminder_days: int
    created_on: datetime.datetime


class HabitIn(Schema):
    name: str = Field(..., min_length=1, max_length=80)
    description: str = Field("", max_length=2000)
    colour: str = Field("", pattern=HEX)
    icon: str = Field("", pattern=ICON)
    kind: Kind = "yesno"
    unit: str = Field("", max_length=24)
    goal: Goal = "at_least"
    target: float = Field(1, ge=0, le=svc.MAX_VALUE)
    period: Period = "day"
    schedule: Sched = "daily"
    weekdays: int = Field(127, ge=0, le=127)
    interval: int = Field(1, ge=1, le=365)
    start_date: Optional[datetime.date] = None  # default: the user's today
    end_date: Optional[datetime.date] = None
    reminder_time: Optional[datetime.time] = None
    reminder_days: int = Field(127, ge=0, le=127)


class HabitPatch(Schema):
    name: Optional[str] = Field(None, min_length=1, max_length=80)
    description: Optional[str] = Field(None, max_length=2000)
    colour: Optional[str] = Field(None, pattern=HEX)
    icon: Optional[str] = Field(None, pattern=ICON)
    kind: Optional[Kind] = None
    unit: Optional[str] = Field(None, max_length=24)
    goal: Optional[Goal] = None
    target: Optional[float] = Field(None, ge=0, le=svc.MAX_VALUE)
    period: Optional[Period] = None
    schedule: Optional[Sched] = None
    weekdays: Optional[int] = Field(None, ge=0, le=127)
    interval: Optional[int] = Field(None, ge=1, le=365)
    start_date: Optional[datetime.date] = None
    end_date: Optional[datetime.date] = None
    reminder_time: Optional[datetime.time] = None
    reminder_days: Optional[int] = Field(None, ge=0, le=127)
    archived: Optional[bool] = None
    paused: Optional[bool] = None


class TodayHabitOut(Schema):
    habit: HabitOut
    due: bool = Field(..., description="Scheduled today and active")
    done: bool = Field(..., description="Today's (or this period's) goal is met")
    over: bool = Field(..., description="An at_most limit is exceeded")
    value: float = Field(..., description="Today's value")
    skipped: bool
    note: str
    period_value: float = Field(..., description="Total so far this day/week/month")
    period_required: float = Field(..., description="Target for this period (scaled for skipped days)")
    streak: int
    streak_unit: Period


class TodayOut(Schema):
    date: datetime.date
    done: int = Field(..., description="Due at-least habits done today")
    total: int = Field(..., description="Due at-least habits today")
    left: int
    over: int = Field(..., description="Limits exceeded today")
    habits: list[TodayHabitOut]


class EntryOut(Schema):
    habit_id: uuid.UUID
    date: datetime.date
    value: float
    note: str
    skipped: bool


class EntryIn(Schema):
    value: Optional[float] = Field(None, ge=0, le=svc.MAX_VALUE)
    note: Optional[str] = Field(None, max_length=500)
    skipped: Optional[bool] = None


class CheckIn(Schema):
    amount: Optional[float] = Field(None, ge=-svc.MAX_VALUE, le=svc.MAX_VALUE,
                                    description="Measurable: add this (negative subtracts). Default 1")
    done: Optional[bool] = Field(None, description="Set instead of toggling")
    date: Optional[datetime.date] = Field(None, description="Default: the user's today")


class ReorderIn(Schema):
    ids: list[uuid.UUID] = Field(..., min_length=1, max_length=500)


class ArchiveIn(Schema):
    archived: bool = True


class Rates(Schema):
    d7: Optional[float]
    d30: Optional[float]
    d90: Optional[float]
    all: Optional[float]


class ScorePoint(Schema):
    date: datetime.date
    score: float


class Heatmap(Schema):
    start: datetime.date
    end: datetime.date
    levels: str
    values: list[Optional[float]]


class WeekdayStat(Schema):
    weekday: int = Field(..., description="0 = Monday")
    done: int
    judged: int
    rate: Optional[float]
    average: Optional[float]


class Totals(Schema):
    total: float
    week: float
    month: float
    days: int
    average: Optional[float]
    best: Optional[float]


class NoteOut(Schema):
    date: datetime.date
    note: str
    value: float
    skipped: bool


class StatsOut(Schema):
    habit_id: uuid.UUID
    today: datetime.date
    streak_unit: Period
    current_streak: int
    best_streak: int
    score: float
    rates: Rates
    period_value: float
    period_required: float
    score_trend: list[ScorePoint]
    heatmap: Heatmap
    weekdays: list[WeekdayStat]
    totals: Totals
    notes: list[NoteOut]


class StreakOut(Schema):
    habit_id: uuid.UUID
    name: str
    colour: str
    current: int
    best: int
    unit: Period


class OverviewOut(Schema):
    date: datetime.date
    done: int
    total: int
    left: int
    over: int
    week_rate: Optional[float]
    streaks: list[StreakOut]


class SettingsOut(Schema):
    evening_nudge: bool
    nudge_time: datetime.time


class SettingsIn(Schema):
    evening_nudge: Optional[bool] = None
    nudge_time: Optional[datetime.time] = None


# ================================================================ helpers

def _habit(user, habit_id):
    return get_object_or_404(Habit, id=habit_id, user=user)


def _validate(h):
    if h.goal == "at_most" and h.kind != "measurable":
        raise HttpError(400, "An 'at most' limit needs a measurable habit (with a unit)")
    if h.goal == "at_least" and h.target <= 0:
        raise HttpError(400, "The target must be more than 0")
    if h.kind == "yesno":
        if h.period == "day":
            h.target = 1
        elif h.target != int(h.target) or h.target > (7 if h.period == "week" else 31):
            raise HttpError(400, f"Times per {h.period} must be a whole number of days")
    if h.schedule == "weekdays" and not h.weekdays:
        raise HttpError(400, "Pick at least one weekday")
    if h.end_date and h.end_date < h.start_date:
        raise HttpError(400, "The end date is before the start date")


def _apply(h, data):
    for key, value in data.items():
        setattr(h, key, _clean(value) if key in ("name", "description", "unit") else value)
    if not h.name:
        raise HttpError(400, "A name is needed")


def _rule(fn, *args, **kwargs):
    try:
        return fn(*args, **kwargs)
    except svc.RuleError as e:
        raise HttpError(400, str(e))


# ================================================================ habits

@router.get("/", response=list[HabitOut], summary="List habits in your order")
def list_habits(request, include_archived: bool = False):
    qs = Habit.objects.filter(user=request.user)
    return list(qs if include_archived else qs.filter(archived=False))


@router.post("/", response={201: HabitOut}, summary="Create a habit")
def create_habit(request, payload: HabitIn):
    data = payload.dict()
    data["start_date"] = data["start_date"] or svc.local_today(request.user)
    h = Habit(user=request.user)
    _apply(h, data)
    _validate(h)
    h.position = (Habit.objects.filter(user=request.user).aggregate(m=Max("position"))["m"] or 0) + 1
    h.save()
    return 201, h


@router.get("/today", response=TodayOut, summary="Today's checklist: every active habit with status and streak")
def today(request):
    return svc.today_summary(request.user)


@router.get("/overview", response=OverviewOut, summary="Today's progress, this week's rate and every streak")
def overview(request):
    return svc.overview(request.user)


@router.get("/entries", response=list[EntryOut], summary="Entries in a date range (max 400 days), all habits or one")
def list_entries(request, start: datetime.date, end: datetime.date, habit: Optional[uuid.UUID] = None):
    if end < start or (end - start).days > 400:
        raise HttpError(400, "Use a range of 0 to 400 days (start <= end)")
    qs = Entry.objects.filter(habit__user=request.user, date__gte=start, date__lte=end)
    if habit:
        qs = qs.filter(habit_id=habit)
    return list(qs.order_by("date").values("habit_id", "date", "value", "note", "skipped"))


@router.put("/entries/{uuid:habit_id}/{day}", response=EntryOut, summary="Log or edit a day (backfill); omitted fields keep their value")
def put_entry(request, habit_id: uuid.UUID, day: datetime.date, payload: EntryIn):
    h = _habit(request.user, habit_id)
    data = payload.dict(exclude_unset=True)
    note = _clean(data["note"]) if data.get("note") is not None else None
    return _rule(svc.save_entry, h, day, svc.local_today(request.user),
                 value=data.get("value"), note=note, skipped=data.get("skipped"))


@router.delete("/entries/{uuid:habit_id}/{day}", response={204: None}, summary="Clear a day")
def delete_entry(request, habit_id: uuid.UUID, day: datetime.date):
    h = _habit(request.user, habit_id)
    Entry.objects.filter(habit=h, date=day).delete()
    return 204, None


@router.post("/reorder", response={204: None}, summary="Set the order: every id you send, first to last")
def reorder(request, payload: ReorderIn):
    ids = list(dict.fromkeys(payload.ids))
    habits = {h.id: h for h in Habit.objects.filter(user=request.user, id__in=ids)}
    if len(habits) != len(ids):
        raise HttpError(404, "Habit not found")
    for n, hid in enumerate(ids):
        habits[hid].position = n
    Habit.objects.bulk_update(habits.values(), ["position"])
    return 204, None


@router.get("/settings", response=SettingsOut, summary="Evening nudge settings")
def get_settings(request):
    return HabitSettings.objects.get_or_create(user=request.user)[0]


@router.patch("/settings", response=SettingsOut)
def patch_settings(request, payload: SettingsIn):
    st = HabitSettings.objects.get_or_create(user=request.user)[0]
    for key, value in payload.dict(exclude_unset=True).items():
        if value is not None:
            setattr(st, key, value)
    st.save()
    return st


@router.get("/{uuid:habit_id}", response=HabitOut)
def get_habit(request, habit_id: uuid.UUID):
    return _habit(request.user, habit_id)


@router.patch("/{uuid:habit_id}", response=HabitOut, summary="Edit, archive or pause (partial)")
def update_habit(request, habit_id: uuid.UUID, payload: HabitPatch):
    h = _habit(request.user, habit_id)
    data = payload.dict(exclude_unset=True)
    nullable = {"end_date", "reminder_time"}
    data = {k: v for k, v in data.items() if v is not None or k in nullable}
    paused = data.pop("paused", None)
    with transaction.atomic():
        _apply(h, data)
        _validate(h)
        h.save()
        if paused is not None:
            svc.set_paused(h, paused, svc.local_today(request.user))
    return h


@router.post("/{uuid:habit_id}/archive", response=HabitOut, summary="Archive (or unarchive with archived=false)")
def archive_habit(request, habit_id: uuid.UUID, payload: Optional[ArchiveIn] = Body(None)):
    h = _habit(request.user, habit_id)
    h.archived = payload.archived if payload else True
    h.save(update_fields=["archived", "updated_on"])
    return h


@router.delete("/{uuid:habit_id}", response={204: None}, summary="Delete a habit and all its entries")
def delete_habit(request, habit_id: uuid.UUID):
    _habit(request.user, habit_id).delete()
    return 204, None


@router.post("/{uuid:habit_id}/check", response=TodayHabitOut,
             summary="Tap: toggle yes/no or add to a measurable habit, for today (user's time zone)")
def check(request, habit_id: uuid.UUID, payload: Optional[CheckIn] = Body(None)):
    h = _habit(request.user, habit_id)
    today = svc.local_today(request.user)
    payload = payload or CheckIn()
    _rule(svc.check, h, today, amount=payload.amount, done=payload.done, day=payload.date)
    return svc.habit_today(h, today)


@router.get("/{uuid:habit_id}/stats", response=StatsOut,
            summary="Streaks, completion rates, score and trend, year heatmap, weekdays, totals, notes")
def stats(request, habit_id: uuid.UUID):
    h = _habit(request.user, habit_id)
    return svc.habit_stats(h, svc.local_today(request.user))
