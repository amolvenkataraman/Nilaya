"""Calendar schema overhaul, step 3 of 4: convert the existing data. Nothing is deleted.

Idempotent (safe to re-run), batched, and it prints and records its counts in
CalendarMigrationLog (see `manage.py calendar_migration_report`):

  a. duplicate (calendar, sync_id): keep one row, the others get sync_id NULL and keep
     the old value in custom_info["legacy_sync_id"]
  b. kind from allday / a missing end; deadlines become "free" (never block availability)
  c. all-day events get start_date/end_date (end exclusive), read in settings.TIME_ZONE,
     and startdate/enddate move to local midnight (originals kept in
     custom_info["legacy_allday_range"] if they changed)
  d. per calendar owner, categories for the old numbers their events use; event_category set
  e. public → visibility ("public"/"default")
  f. non-default priority/completed → custom_info["legacy_priority"/"legacy_completed"]
  g. repeat_every/repeat_end (days) → RRULE FREQ=DAILY;INTERVAL=n;UNTIL=…
  h. auto_sync_sm/sy/em/ey → sync_past_months/sync_future_months
  i. owner rows: missing owner Subscriber rows are created, the owner's row gets type 0,
     and anyone else with type 0 is demoted to admin (1)

The reverse puts the old columns' values back (step 4's reverse re-adds the columns).
The conversion helpers are plain functions so tests can call them directly.
"""

import datetime as dt
from zoneinfo import ZoneInfo

from dateutil.rrule import rrulestr
from django.conf import settings
from django.db import migrations
from django.db.models import Count
from django.utils import timezone

BATCH = 500
UTC = dt.timezone.utc
LEGACY = {0: ("Uncategorized", ""), 1: ("Meeting", "users"), 2: ("Focus Time", "target"),
          3: ("Break Time", "coffee"), 4: ("Study", "book"), 5: ("Work", "briefcase"), 6: ("Personal", "smile"),
          7: ("Tech Break", "laptop"), 8: ("Test / Exam", "alert"), 9: ("Lecture", "school"), 100: ("Other", "dots")}
ADDED_KEYS = ("legacy_priority", "legacy_completed", "legacy_repeat", "legacy_allday_range", "legacy_sync_id")


def _months(year, month):
    return year * 12 + (month - 1)


def convert_sync_window(sm, sy, em, ey, today):
    """Old auto_sync_* → (past_months, future_months, note).

    Old logic (scheduler/tasks.py): start = the 1st of (sy, sm), or the 1st of the current
    month when sy and sm are both -1; end = the 1st of (ey, em). The new window is
    [1st of this month − past, 1st of this month + future), so on the day of the
    migration it covers exactly the old range."""
    now_m = _months(today.year, today.month)
    notes = []
    if sy == -1 or sm == -1:
        past = 0
    elif sy and sm and 1 <= sm <= 12:
        past = max(0, now_m - _months(sy, sm))
        if now_m < _months(sy, sm):
            notes.append(f"start {sy}-{sm:02d} was in the future; past 0")
    else:
        past = 1
        notes.append("no start month; default 1 month back")
    if ey and em and ey > 0 and 1 <= em <= 12:
        future = _months(ey, em) - now_m
        if future < 0:
            notes.append(f"end {ey}-{em:02d} had already passed; future 0")
            future = 0
    else:
        future = 12
        notes.append("no end month; default 12 months ahead")
    return min(past, 32767), min(future, 32767), "; ".join(notes)


def legacy_sync_window(past, future, today):
    """Inverse of convert_sync_window (for the reverse migration)."""
    now_m = _months(today.year, today.month)
    if past == 0:
        sy = sm = -1
    else:
        sy, sm = divmod(now_m - past, 12)
        sm += 1
    ey, em = divmod(now_m + future, 12)
    return sm, sy, em + 1, ey


def all_day_dates(startdate, enddate, tz):
    """UTC datetimes of an old all-day event → (start_date, end_date exclusive) in tz."""
    start = startdate.astimezone(tz).date()
    end = None
    if enddate is not None:
        el = enddate.astimezone(tz)
        end = el.date() if el.time() == dt.time() else el.date() + dt.timedelta(days=1)
    if end is None or end <= start:
        end = start + dt.timedelta(days=1)
    return start, end


def _midnight(day, tz):
    return dt.datetime.combine(day, dt.time(), tzinfo=tz).astimezone(UTC)


def repeat_to_rrule(every, until, tz):
    """repeat_every (days) + repeat_end (date) → RRULE text, or None if unusable."""
    if not every or every <= 0:
        return None
    rule = f"FREQ=DAILY;INTERVAL={int(every)}"
    if until:
        u = dt.datetime.combine(until, dt.time(23, 59, 59), tzinfo=tz).astimezone(UTC)
        rule += f";UNTIL={u:%Y%m%dT%H%M%SZ}"
    return rule


def _recurrence_end(rule, start_local, duration):
    if "UNTIL=" not in rule and "COUNT=" not in rule:
        return None
    last = None
    for i, d in enumerate(rrulestr(rule, dtstart=start_local)):
        last = d
        if i >= 5000:
            break
    last = last or start_local
    return (last + (duration or dt.timedelta())).astimezone(UTC)


def forwards(apps, schema_editor):
    Event = apps.get_model("scheduler", "Event")
    Calendar = apps.get_model("scheduler", "Calendar")
    Subscriber = apps.get_model("scheduler", "Subscriber")
    EventCategory = apps.get_model("scheduler", "EventCategory")
    Log = apps.get_model("scheduler", "CalendarMigrationLog")
    tz = ZoneInfo(settings.TIME_ZONE)
    today = timezone.localtime(timezone.now(), tz).date()
    counts = {"events": Event.objects.count(), "duplicate_sync_ids_cleared": 0, "kind": {"event": 0, "all_day": 0, "deadline": 0},
              "events_changed": 0, "all_day_dates_set": 0, "all_day_times_moved": 0, "deadlines_made_free": 0,
              "categories_created": 0, "events_categorised": 0, "visibility_public": 0, "legacy_priority_kept": 0,
              "legacy_completed_kept": 0, "repeat_converted": 0, "repeat_skipped": 0, "sync_windows_converted": 0,
              "owner_rows_created": 0, "owner_rows_fixed": 0, "non_owners_demoted": 0}
    details = []

    # a. duplicate sync ids
    dups = (Event.objects.filter(sync_id__isnull=False).values("calendar_id", "sync_id")
            .annotate(n=Count("id")).filter(n__gt=1))
    for d in dups:
        rows = list(Event.objects.filter(calendar_id=d["calendar_id"], sync_id=d["sync_id"]).order_by("startdate", "id"))
        for e in rows[1:]:
            ci = dict(e.custom_info or {})
            ci["legacy_sync_id"] = e.sync_id
            e.custom_info, e.sync_id = ci, None
            e.save(update_fields=["custom_info", "sync_id"])
            counts["duplicate_sync_ids_cleared"] += 1
            details.append({"step": "duplicate_sync_id", "event": str(e.id), "kept": str(rows[0].id), "sync_id": d["sync_id"]})

    # d (setup). categories for the old numbers each owner's events use
    owner_of = dict(Calendar.objects.values_list("id", "owner_id"))
    used = {(owner_of[c], cat or 0) for c, cat in Event.objects.values_list("calendar_id", "category").distinct()}
    cat_ids = {}
    for owner_id, legacy in sorted(used, key=lambda x: (str(x[0]), x[1])):
        name, icon = LEGACY.get(legacy, (f"Category {legacy}", ""))
        cat, created = EventCategory.objects.get_or_create(
            owner_id=owner_id, legacy_id=legacy,
            defaults={"name": name, "icon": icon, "position": legacy if legacy < 100 else 100})
        cat_ids[(owner_id, legacy)] = cat.id
        counts["categories_created"] += created

    # b–g. one pass over the events
    fields = ["kind", "allday", "start_date", "end_date", "startdate", "enddate", "transparency", "event_category",
              "visibility", "custom_info", "rrule", "recurrence_end"]
    batch = []
    for e in Event.objects.order_by("pk").iterator(chunk_size=BATCH):
        before = tuple(getattr(e, f if f != "event_category" else "event_category_id") for f in fields)
        ci = dict(e.custom_info or {})
        kind = e.kind = "all_day" if e.allday else ("deadline" if e.enddate is None else "event")
        e.allday = kind == "all_day"
        counts["kind"][kind] += 1
        if kind == "all_day":
            if e.start_date is None or e.end_date is None:
                e.start_date, e.end_date = all_day_dates(e.startdate, e.enddate, tz)
                counts["all_day_dates_set"] += 1
            s, en = _midnight(e.start_date, tz), _midnight(e.end_date, tz)
            if (e.startdate, e.enddate) != (s, en):
                ci.setdefault("legacy_allday_range", [e.startdate.isoformat(), e.enddate.isoformat() if e.enddate else None,
                                                     e.start_date.isoformat(), e.end_date.isoformat()])
                e.startdate, e.enddate = s, en
                counts["all_day_times_moved"] += 1
        elif kind == "deadline" and e.transparency == "busy":
            e.transparency = "free"
            counts["deadlines_made_free"] += 1
        if e.event_category_id is None:
            e.event_category_id = cat_ids[(owner_of[e.calendar_id], e.category or 0)]
            counts["events_categorised"] += 1
        if e.public and e.visibility == "default":
            e.visibility = "public"
        counts["visibility_public"] += e.visibility == "public"
        if e.priority != 10:
            ci["legacy_priority"] = e.priority
        if e.completed:
            ci["legacy_completed"] = True
        counts["legacy_priority_kept"] += "legacy_priority" in ci
        counts["legacy_completed_kept"] += "legacy_completed" in ci
        if e.repeat_every is not None and not e.rrule:
            rule = repeat_to_rrule(e.repeat_every, e.repeat_end, tz)
            ci["legacy_repeat"] = [e.repeat_every, e.repeat_end.isoformat() if e.repeat_end else None]
            if rule:
                e.rrule = rule
                start_local = (dt.datetime.combine(e.start_date, dt.time(), tzinfo=tz) if kind == "all_day"
                               else e.startdate.astimezone(tz))
                e.recurrence_end = _recurrence_end(rule, start_local, (e.enddate - e.startdate) if e.enddate else None)
                counts["repeat_converted"] += 1
            else:
                counts["repeat_skipped"] += 1
                details.append({"step": "repeat_skipped", "event": str(e.id), "repeat_every": e.repeat_every})
        e.custom_info = ci
        if tuple(getattr(e, f if f != "event_category" else "event_category_id") for f in fields) != before:
            batch.append(e)
            counts["events_changed"] += 1
        if len(batch) >= BATCH:
            Event.objects.bulk_update(batch, fields)
            batch = []
    if batch:
        Event.objects.bulk_update(batch, fields)

    # h. sync windows
    cals = []
    for c in Calendar.objects.order_by("pk").iterator(chunk_size=BATCH):
        if c.calendar_type == 0 and all(v is None for v in (c.auto_sync_sm, c.auto_sync_sy, c.auto_sync_em, c.auto_sync_ey)):
            continue
        past, future, note = convert_sync_window(c.auto_sync_sm, c.auto_sync_sy, c.auto_sync_em, c.auto_sync_ey, today)
        if (c.sync_past_months, c.sync_future_months) != (past, future):
            c.sync_past_months, c.sync_future_months = past, future
            cals.append(c)
        counts["sync_windows_converted"] += 1
        details.append({"step": "sync_window", "calendar": c.id, "old": [c.auto_sync_sm, c.auto_sync_sy, c.auto_sync_em,
                        c.auto_sync_ey], "past": past, "future": future, "note": note})
    Calendar.objects.bulk_update(cals, ["sync_past_months", "sync_future_months"], batch_size=BATCH)

    # i. owner rows
    subs = {}
    for s in Subscriber.objects.all().iterator(chunk_size=BATCH):
        subs.setdefault(s.calendar_id, []).append(s)
    fix = []
    for c in Calendar.objects.only("id", "owner_id", "colour").iterator(chunk_size=BATCH):
        rows = subs.get(c.id, [])
        own = [s for s in rows if s.user_id == c.owner_id]
        if not own:
            Subscriber.objects.create(calendar_id=c.id, user_id=c.owner_id, subscribe_type=0, colour=c.colour)
            counts["owner_rows_created"] += 1
            details.append({"step": "owner_row_created", "calendar": c.id})
        for s in own:
            if s.subscribe_type != 0:
                details.append({"step": "owner_row_fixed", "calendar": c.id, "subscriber": s.id, "was": s.subscribe_type})
                s.subscribe_type = 0
                fix.append(s)
                counts["owner_rows_fixed"] += 1
        for s in rows:
            if s.user_id != c.owner_id and s.subscribe_type == 0:
                details.append({"step": "non_owner_demoted", "calendar": c.id, "subscriber": s.id, "user": str(s.user_id)})
                s.subscribe_type = 1
                fix.append(s)
                counts["non_owners_demoted"] += 1
    Subscriber.objects.bulk_update(fix, ["subscribe_type"], batch_size=BATCH)

    Log.objects.create(step="0036_calendar_schema_data", counts=counts, details=details[:2000])
    if counts["events"] or Calendar.objects.exists():
        print(f"\n  calendar schema data: {counts}")
        for d in details[:50]:
            print(f"    {d}")


def backwards(apps, schema_editor):
    Event = apps.get_model("scheduler", "Event")
    Calendar = apps.get_model("scheduler", "Calendar")
    tz = ZoneInfo(settings.TIME_ZONE)
    today = timezone.localtime(timezone.now(), tz).date()
    fields = ["priority", "completed", "public", "repeat_every", "repeat_end", "startdate", "enddate", "sync_id",
              "custom_info"]
    batch = []
    for e in Event.objects.order_by("pk").iterator(chunk_size=BATCH):
        ci = dict(e.custom_info or {})
        try:
            e.priority = int(ci.get("legacy_priority", 10))
        except (TypeError, ValueError):
            e.priority = 10
        e.completed = bool(ci.get("legacy_completed", False))
        e.public = e.visibility == "public"
        rep = ci.get("legacy_repeat")
        if rep:
            e.repeat_every = rep[0]
            e.repeat_end = dt.date.fromisoformat(rep[1]) if rep[1] else None
        rng = ci.get("legacy_allday_range")
        if rng and e.start_date and [e.start_date.isoformat(), e.end_date.isoformat()] == rng[2:]:
            e.startdate = dt.datetime.fromisoformat(rng[0])
            e.enddate = dt.datetime.fromisoformat(rng[1]) if rng[1] else None
        if ci.get("legacy_sync_id") and not e.sync_id:
            e.sync_id = ci["legacy_sync_id"]
        for k in ADDED_KEYS:
            ci.pop(k, None)
        e.custom_info = ci
        batch.append(e)
        if len(batch) >= BATCH:
            Event.objects.bulk_update(batch, fields)
            batch = []
    if batch:
        Event.objects.bulk_update(batch, fields)
    cals = []
    for c in Calendar.objects.exclude(calendar_type=0).iterator(chunk_size=BATCH):
        c.auto_sync_sm, c.auto_sync_sy, c.auto_sync_em, c.auto_sync_ey = legacy_sync_window(
            c.sync_past_months, c.sync_future_months, today)
        cals.append(c)
    Calendar.objects.bulk_update(cals, ["auto_sync_sm", "auto_sync_sy", "auto_sync_em", "auto_sync_ey"], batch_size=BATCH)
    # Owner-row fixes and categories are left as they are (the categories table goes with step 1's reverse).


class Migration(migrations.Migration):

    dependencies = [
        ("scheduler", "0035_calendar_schema_add"),
    ]

    operations = [
        migrations.RunPython(forwards, backwards),
    ]
