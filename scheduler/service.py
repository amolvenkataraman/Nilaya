"""Calendar domain logic shared by the legacy API, V2, feeds and reminders:
range queries with recurrence expansion, occurrence ids, series edits (this /
following / all), roles and invite use."""

import datetime as dt
import logging
import uuid
from collections import defaultdict

from django.db import transaction
from django.db.models import Q

from . import recurrence as rec
from .models import Event, EventAttendee, EventReminder, Subscriber

log = logging.getLogger(__name__)

# Copied from a series onto an override or a split-off series.
_NOT_COPIED = {"id", "rrule", "exdates", "rdates", "recurrence_end", "recurrence_parent", "original_start", "sync_id",
               "created_on", "updated_on"}


def overlapping(start, end):
    """Events overlapping [start, end); deadlines (no end) count at their start."""
    return Q(startdate__lt=end) & (Q(enddate__gt=start) | Q(enddate__isnull=True, startdate__gte=start))


def _overlaps(e, start, end):
    return e.startdate < end and ((e.enddate is not None and e.enddate > start)
                                  or (e.enddate is None and e.startdate >= start))


def _sort_key(e):
    return (e.startdate, -(e.enddate or e.startdate).timestamp(), e.name)


def events_in_range(calendar_ids, start, end, *, include_cancelled=False, extra=None, limit=5000,
                    related=("calendar", "event_category", "place")):
    """Single events, expanded occurrences and overrides overlapping [start, end), sorted.

    Singles come from one indexed range query; series are prefiltered with
    recurrence_end and expanded only inside the range."""
    base = Event.objects.filter(calendar_id__in=calendar_ids, recurrence_parent__isnull=True)
    if not include_cancelled:
        base = base.exclude(status="cancelled")
    singles = base.filter(overlapping(start, end), rrule="")
    out = list((singles.filter(extra) if extra is not None else singles).select_related(*related)
               .order_by("startdate", "-enddate", "name")[:limit])
    # Series are found without ``extra``: a changed occurrence that matches a filter (a search, busy
    # only) must be listed even when its series doesn't, and one that doesn't must still hide the
    # occurrence it replaced (else it shows up again at its old time).
    series_qs = base.exclude(rrule="").filter(startdate__lt=end).filter(
        Q(recurrence_end__isnull=True) | Q(recurrence_end__gt=start))
    series = list(series_qs.select_related(*related))
    if series:
        matching = ({s.id for s in series} if extra is None else
                    set(series_qs.filter(extra).values_list("id", flat=True)))
        skip = defaultdict(set)
        overrides = Event.objects.filter(recurrence_parent__in=[s.id for s in series]).filter(
            overlapping(start, end) | Q(original_start__gte=start - dt.timedelta(days=400), original_start__lt=end))
        shown = None if extra is None else set(overrides.filter(extra).values_list("id", flat=True))
        for o in overrides.select_related(*related):
            skip[o.recurrence_parent_id].add(rec.key(o.original_start))
            if (_overlaps(o, start, end) and (include_cancelled or o.status != "cancelled")
                    and (shown is None or o.id in shown)):
                o.series_id, o.override_id = o.recurrence_parent_id, o.id
                out.append(o)
        for s in series:
            if s.id not in matching:
                continue
            try:
                out.extend(rec.expand(s, start, end, rec.event_zone(s), skip[s.id]))
            except Exception:  # one bad stored rule must not break every listing (or the reminder job)
                log.exception("Skipped series %s with repeat rule %r", s.id, s.rrule)
        out.sort(key=_sort_key)
    return out[:limit]


# ---------------------------------------------------------------- ids

def parse_ident(ident):
    """'<uuid>' or '<uuid>:<original start ISO>' → (uuid, aware UTC datetime or None). ValueError on junk."""
    s = str(ident)
    if ":" in s and len(s) > 36 and s[36] == ":":
        return uuid.UUID(s[:36]), rec.parse_moment(s[37:])
    return uuid.UUID(s), None


def resolve(ident, qs=None):
    """(row, original_start). For an override's own uuid, returns its series and its original start."""
    try:
        eid, original = parse_ident(ident)
    except (ValueError, TypeError):
        return None, None
    e = (qs if qs is not None else Event.objects).select_related("calendar").filter(id=eid).first()
    if e is not None and e.recurrence_parent_id and original is None:
        original = e.original_start
        e = Event.objects.select_related("calendar").get(id=e.recurrence_parent_id)
    if e is not None and original is not None and not e.rrule:
        original = None  # a plain event addressed with a time: it's just the event
    return e, original


def override_for(series, original):
    return Event.objects.filter(recurrence_parent=series, original_start=original).first()


def occurrence_view(series, original):
    """What the occurrence looks like now: its override row, or the generated occurrence."""
    o = override_for(series, original)
    if o is not None:
        o.series_id, o.override_id = series.id, o.id
        return o
    return rec.occurrence_at(series, original, rec.event_zone(series))


# ---------------------------------------------------------------- series edits

def _clone(src, **changes):
    e = Event()
    for f in Event._meta.concrete_fields:
        if f.name not in _NOT_COPIED:
            setattr(e, f.attname, getattr(src, f.attname))
    e.custom_info = dict(src.custom_info or {})
    e.tags = list(src.tags or [])
    for k, v in changes.items():
        setattr(e, k, v)
    return e


def _copy_children(src, dst):
    EventReminder.objects.bulk_create([EventReminder(event=dst, minutes_before=r.minutes_before)
                                       for r in src.reminders.all()])
    EventAttendee.objects.bulk_create([EventAttendee(event=dst, contact_id=a.contact_id, user_id=a.user_id, name=a.name,
                                                     email=a.email, rsvp=a.rsvp, is_organizer=a.is_organizer)
                                       for a in src.attendees.all()])


def make_override(series, original):
    """The override row for one occurrence (created from the series if needed)."""
    o = override_for(series, original)
    if o is not None:
        return o
    occ = rec.occurrence_at(series, original, rec.event_zone(series))
    if occ is None or rec.key(original) in (series.exdates or []):
        raise LookupError("No such occurrence")
    o = _clone(series, recurrence_parent=series, original_start=original, startdate=occ.startdate,
               enddate=occ.enddate, start_date=occ.start_date, end_date=occ.end_date)
    o.calendar = series.calendar
    o.save()
    return o


def cancel_occurrence(series, original):
    """Delete one occurrence: an EXDATE on the series (and its override row goes)."""
    with transaction.atomic():
        Event.objects.filter(recurrence_parent=series, original_start=original).delete()
        k = rec.key(original)
        if k not in (series.exdates or []):
            series.exdates = sorted(set(series.exdates or []) | {k})
            series.save(update_fields=["exdates"])


def split(series, original):
    """'This and following': end the series before ``original`` and start a new one there
    (Google's approach). Returns the new series, or the same one if ``original`` is its first."""
    tz = rec.event_zone(series)
    if original <= series.startdate:
        return series
    occ = rec.occurrence_at(series, original, tz)
    if occ is None:
        raise LookupError("No such occurrence")
    k = rec.key(original)
    p = rec.parts(series.rrule)
    rule = series.rrule
    if "COUNT" in p:
        done = rec.rule_count_before(series, tz, original)  # RDATEs don't count towards COUNT
        p["COUNT"] = str(max(1, int(p["COUNT"]) - done))
        rule = ";".join([f"FREQ={p.pop('FREQ')}"] + [f"{a}={b}" for a, b in p.items()])
    with transaction.atomic():
        new = _clone(series, startdate=occ.startdate, enddate=occ.enddate, start_date=occ.start_date,
                     end_date=occ.end_date, rrule=rule,
                     exdates=[x for x in (series.exdates or []) if x >= k],
                     rdates=[x for x in (series.rdates or []) if x >= k])
        new.calendar = series.calendar
        new.save()
        series.exdates = [x for x in (series.exdates or []) if x < k]
        series.rdates = [x for x in (series.rdates or []) if x < k]
        series.rrule = rec.until_rule(series.rrule, original)
        series.save()
        Event.objects.filter(recurrence_parent=series, original_start__gte=original).update(recurrence_parent=new)
        _copy_children(series, new)
    return new


def shift_series(series, delta):
    """Move a series by ``delta`` (``series.startdate`` is already the new start): its exdates,
    rdates and changed occurrences move with it, by the same wall-clock amount in its zone, so
    their keys still match the occurrences when the move crosses a DST change (a week later can
    be 169 hours later)."""
    if not delta:
        return
    tz = rec.event_zone(series)
    naive = lambda m: m.astimezone(tz).replace(tzinfo=None)  # noqa: E731
    wall = naive(series.startdate) - naive(series.startdate - delta)
    move = lambda m: (naive(m) + wall).replace(tzinfo=tz).astimezone(rec.UTC)  # noqa: E731
    series.exdates = [rec.key(move(rec.parse_moment(x))) for x in (series.exdates or [])]
    series.rdates = [rec.key(move(rec.parse_moment(x))) for x in (series.rdates or [])]
    # One at a time, starting from the far end: moving by exactly one period would otherwise put an
    # override on its neighbour's not-yet-moved original_start (unique per series). The changed
    # occurrences' own times move too (else one renamed earlier stays behind, next to the moved one).
    order = "-original_start" if delta > dt.timedelta() else "original_start"
    days = dt.timedelta(days=round(wall / dt.timedelta(days=1)))
    cal_tz = series.calendar.tz
    for o in Event.objects.filter(recurrence_parent=series).order_by(order):
        if o.kind == "all_day" and o.start_date:  # dates are the truth; times are their local midnights
            sd, ed = o.start_date + days, (o.end_date or o.start_date + dt.timedelta(days=1)) + days
            times = {"start_date": sd, "end_date": ed, "startdate": rec.local_midnight(sd, cal_tz),
                     "enddate": rec.local_midnight(ed, cal_tz)}
        else:
            times = {"startdate": move(o.startdate), "enddate": move(o.enddate) if o.enddate else None}
        Event.objects.filter(pk=o.pk).update(original_start=move(o.original_start), **times)


def delete_following(series, original):
    if original <= series.startdate:
        series.delete()
        return
    with transaction.atomic():
        Event.objects.filter(recurrence_parent=series, original_start__gte=original).delete()
        series.rrule = rec.until_rule(series.rrule, original)
        series.save()


# ---------------------------------------------------------------- roles and invites

def subscription(user, calendar_id):
    return Subscriber.objects.select_related("calendar").filter(user=user, calendar_id=calendar_id).first()


def role(sub):
    return sub.role if sub is not None else None


def join(user, invite):
    """Subscribe ``user`` through ``invite`` with its role. Returns (sub, error)."""
    err = invite.problem()
    if err:
        return None, err
    cal = invite.calendar
    with transaction.atomic():
        sub = Subscriber.objects.filter(user=user, calendar=cal).first()
        if sub is not None:
            return sub, None
        if not invite.claim():
            return None, "Invite code has been used up"
        sub = Subscriber.objects.create(user=user, calendar=cal, subscribe_type=invite.role, colour=cal.colour)
    return sub, None


def sync_window(cal, now=None):
    """(start, end) of a calendar's sync window as aware datetimes in its zone."""
    from django.utils import timezone
    tz = cal.tz
    local = timezone.localtime(now or timezone.now(), tz)
    m = local.year * 12 + local.month - 1
    first = lambda months: dt.datetime(months // 12, months % 12 + 1, 1, tzinfo=tz)
    return first(m - cal.sync_past_months), first(m + cal.sync_future_months)


def visible_calendar_ids(user, include_hidden=False, include_inactive=False):
    subs = Subscriber.objects.filter(user=user)
    if not include_inactive:
        subs = subs.filter(calendar__active=True)
    if not include_hidden:
        subs = subs.filter(visible=True)
    return subs


def masked_for(e, user, role_):
    """A private event shows only as busy to everyone but the calendar's owner and admins: plain
    subscribers, visitors of a public calendar and anonymous users (role None). It doesn't depend on
    created_by, which synced and pre-migration events don't have."""
    return e.visibility == "private" and role_ not in ("owner", "admin")


def can_see_private(role_):
    return role_ in ("owner", "admin")


# ---------------------------------------------------------------- input cleaning (both APIs)

def clean_tags(values):
    """Short strings, trimmed, case-insensitively unique, at most 20 of 32 characters."""
    out, seen = [], set()
    for v in values or []:
        t = " ".join(str(v).split())[:32]
        if t and t.lower() not in seen:
            seen.add(t.lower())
            out.append(t)
    return out[:20]


def clean_colour(value, allow_empty=True):
    from .models import valid_colour
    if value in (None, "") and allow_empty:
        return None
    if not valid_colour(value):
        raise ValueError("Colours look like #rrggbb")
    return value.lower()


def clean_icon(value):
    from .models import ICONS
    if value in (None, ""):
        return None
    if value not in ICONS:
        raise ValueError("Unknown icon (see /api/v2/calendar/icons)")
    return value


def clean_url(value):
    from urllib.parse import urlsplit
    if not value:
        return ""
    value = str(value).strip()
    u = urlsplit(value)
    if u.scheme not in ("http", "https") or not u.netloc or len(value) > 500:
        raise ValueError("The meeting link must be an http(s) URL")
    return value


def in_tags(e, tag):
    t = tag.strip().lower()
    return any(x.lower() == t for x in (e.tags or []))
