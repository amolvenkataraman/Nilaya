"""Read-only summary of the calendar data after the schema migration (0034–0037).

    manage.py calendar_migration_report [--json]

Run it on production after migrating: every number comes from the live tables, plus
what the data migration recorded (CalendarMigrationLog). It writes nothing.
"""

import json

from django.core.management.base import BaseCommand
from django.db.models import Count, F, Q


class Command(BaseCommand):
    help = "Read-only counts to check the calendar schema migration (events by kind/category, series, fixes, sync)."

    def add_arguments(self, parser):
        parser.add_argument("--json", action="store_true", help="Print one JSON object instead of text")

    def handle(self, *args, **opts):
        from scheduler.models import Calendar, CalendarMigrationLog, Event, EventCategory, Invite, Subscriber, valid_colour

        ev = Event.objects
        r = {
            "events": ev.count(),
            "by_kind": dict(ev.values_list("kind").annotate(n=Count("id")).order_by("kind")),
            "by_status": dict(ev.values_list("status").annotate(n=Count("id")).order_by("status")),
            "by_category": {f"{name} ({'legacy ' + str(lid) if lid is not None else 'custom'})": n for name, lid, n in
                            ev.values_list("event_category__name", "event_category__legacy_id")
                            .annotate(n=Count("id")).order_by("-n")},
            "events_without_category": ev.filter(event_category__isnull=True).count(),
            "legacy_number_mismatch": ev.filter(event_category__legacy_id__isnull=False)
                                        .exclude(category=F("event_category__legacy_id")).count(),
            "all_day_without_dates": ev.filter(kind="all_day").filter(Q(start_date__isnull=True) | Q(end_date__isnull=True)).count(),
            "allday_flag_mismatch": ev.filter(Q(kind="all_day", allday=False) | (~Q(kind="all_day") & Q(allday=True))).count(),
            "deadlines_with_end": ev.filter(kind="deadline", enddate__isnull=False).count(),
            "recurring_series": ev.exclude(rrule="").filter(recurrence_parent__isnull=True).count(),
            "occurrence_overrides": ev.filter(recurrence_parent__isnull=False).count(),
            "visibility": dict(ev.values_list("visibility").annotate(n=Count("id")).order_by("visibility")),
            "transparency": dict(ev.values_list("transparency").annotate(n=Count("id")).order_by("transparency")),
            "with_legacy_priority": ev.filter(custom_info__has_key="legacy_priority").count(),
            "with_legacy_completed": ev.filter(custom_info__has_key="legacy_completed").count(),
            "duplicate_sync_ids_cleared": ev.filter(custom_info__has_key="legacy_sync_id").count(),
            "duplicate_sync_ids_remaining": ev.filter(sync_id__isnull=False).values("calendar_id", "sync_id")
                                              .annotate(n=Count("id")).filter(n__gt=1).count(),
            "categories": EventCategory.objects.count(),
            "calendars": Calendar.objects.count(),
            "calendars_missing_owner_row": Calendar.objects.exclude(
                id__in=Subscriber.objects.filter(user_id=F("calendar__owner_id")).values("calendar_id")).count(),
            "duplicate_subscriber_rows": sum(r["n"] - 1 for r in Subscriber.objects.values("calendar_id", "user_id")
                                             .annotate(n=Count("id")).filter(n__gt=1)),
            "non_hex_calendar_colours": sum(1 for c in Calendar.objects.values_list("colour", flat=True) if not valid_colour(c)),
            "non_owners_with_owner_type": Subscriber.objects.filter(subscribe_type=0).exclude(
                user_id=F("calendar__owner_id")).count(),
            "sync_calendars": [{"id": c.id, "name": c.name, "type": c.calendar_type, "auto_sync": c.auto_sync,
                                "past_months": c.sync_past_months, "future_months": c.sync_future_months,
                                "last_synced_at": c.last_synced_at.isoformat() if c.last_synced_at else None,
                                "last_sync_error": c.last_sync_error}
                               for c in Calendar.objects.exclude(calendar_type=0).order_by("id")],
            "invites": {"total": Invite.objects.count(), "with_expiry": Invite.objects.filter(expires_on__isnull=False).count(),
                        "with_max_uses": Invite.objects.filter(max_uses__isnull=False).count()},
            "migration_log": [{"step": l.step, "ran_on": l.ran_on.isoformat(), "counts": l.counts,
                               "fixes": [d for d in l.details if d.get("step") in (
                                   "duplicate_sync_id", "owner_row_created", "owner_row_fixed", "non_owner_demoted",
                                   "repeat_skipped", "end_before_start", "calendar_colour", "subscriber_colour",
                                   "duplicate_subscriber_rows")]}
                              for l in CalendarMigrationLog.objects.all()],
        }
        if opts["json"]:
            self.stdout.write(json.dumps(r, indent=2, default=str))
            return
        w = self.stdout.write
        w(f"Events: {r['events']}")
        for k in ("by_kind", "by_status", "visibility", "transparency"):
            w(f"  {k}: {r[k]}")
        w("  by category:")
        for k, v in r["by_category"].items():
            w(f"    {v:6d}  {k}")
        for k in ("events_without_category", "legacy_number_mismatch", "all_day_without_dates", "allday_flag_mismatch",
                  "deadlines_with_end", "recurring_series", "occurrence_overrides", "with_legacy_priority",
                  "with_legacy_completed", "duplicate_sync_ids_cleared", "duplicate_sync_ids_remaining", "categories",
                  "calendars", "calendars_missing_owner_row", "non_owners_with_owner_type", "duplicate_subscriber_rows",
                  "non_hex_calendar_colours"):
            w(f"  {k}: {r[k]}")
        w(f"Invites: {r['invites']}")
        w("Sync calendars:")
        for c in r["sync_calendars"]:
            w(f"  #{c['id']} {c['name']}: type {c['type']}, auto {c['auto_sync']}, window -{c['past_months']}/+{c['future_months']} "
              f"months, last {c['last_synced_at'] or 'never'}{', error: ' + c['last_sync_error'] if c['last_sync_error'] else ''}")
        for l in r["migration_log"]:
            c = l["counts"]
            w(f"Migration {l['step']} ran {l['ran_on']}")
            w("  normalisations: " + ", ".join(f"{label}: {c.get(k, 0)}" for k, label in (
                ("calendar_colours_fixed", "calendar colours fixed"), ("subscriber_colours_fixed", "subscriber colours fixed"),
                ("duplicate_sync_ids_cleared", "duplicate sync ids cleared"), ("end_before_start_fixed", "ends before starts fixed"),
                ("all_day_utc_midnight", "all-day events at UTC midnight"), ("repeat_converted", "repeats converted"),
                ("repeat_skipped", "repeats left single"), ("owner_rows_created", "owner rows created"),
                ("owner_rows_fixed", "owner rows fixed"), ("non_owners_demoted", "non-owners demoted to admin"),
                ("duplicate_subscriber_rows", "duplicate subscriber rows (kept)"))))
            w(f"  all counts: {c}")
            for d in l["fixes"]:
                w(f"  fix: {d}")
        problems = sum(r[k] for k in ("events_without_category", "all_day_without_dates", "allday_flag_mismatch",
                                      "deadlines_with_end", "duplicate_sync_ids_remaining", "calendars_missing_owner_row",
                                      "non_owners_with_owner_type", "legacy_number_mismatch", "non_hex_calendar_colours"))
        w(self.style.SUCCESS("No inconsistencies found.") if not problems
          else self.style.WARNING(f"{problems} inconsistent rows (see the counts above)."))

