"""Tasks domain logic shared by the API, the Celery reminder job and both UIs."""

import calendar
import datetime
import math
import re

import pytz
from django.conf import settings
from django.db import IntegrityError, transaction
from django.db.models import F, Max, Q
from django.utils import timezone

from scheduler.models import Todo

from .models import Bucket, Label, Project, ProjectMember, Reminder

PRIORITIES = [(0, "None"), (5, "Low"), (10, "Medium"), (15, "High"), (20, "Urgent")]
DEFAULT_BUCKETS = [("To do", False), ("Doing", False), ("Done", True)]


def priority_label(value):
    for limit, label in PRIORITIES:
        if value <= limit:
            return label
    return "Urgent"


# ---------------------------------------------------------------- access

def user_tz(user):
    """The user's zone as a pytz zone (quick add and repeats localize with it); the server's zone
    when theirs is unknown to pytz."""
    name = getattr(user, "timezone", "") or ""
    if name in pytz.all_timezones_set:
        return pytz.timezone(name)
    return pytz.timezone(settings.TIME_ZONE) if settings.TIME_ZONE in pytz.all_timezones_set else pytz.utc


def _project_ids(user):
    """Ids of projects the user owns or is a member of, as a subquery (no join, no DISTINCT)."""
    return Project.objects.filter(Q(owner=user) | Q(id__in=ProjectMember.objects.filter(user=user).values("project_id"))
                                  ).values("id")


def accessible_projects(user):
    return Project.objects.filter(id__in=_project_ids(user))


def project_role(user, project):
    """2 = admin (owner), 1 = can edit, 0 = can view, None = no access."""
    if project.owner_id == user.id:
        return ProjectMember.Role.ADMIN
    m = ProjectMember.objects.filter(project=project, user=user).first()
    return m.role if m else None


def visible_tasks(user):
    """Tasks in projects you can open, your own loose tasks, and tasks assigned to you. A member removed
    from a project stops seeing the tasks they created there. Subqueries only, so no DISTINCT is needed."""
    assigned = Todo.assignees.through.objects.filter(comptechuser_id=user.id).values("todo_id")
    return Todo.objects.filter(Q(project_id__in=_project_ids(user)) | Q(user=user, project__isnull=True)
                               | Q(id__in=assigned))


def can_view_task(user, todo):
    if todo.project_id is None:
        return todo.user_id == user.id or todo.assignees.filter(id=user.id).exists()
    return project_role(user, todo.project) is not None or todo.assignees.filter(id=user.id).exists()


def assignable_user_ids(todo):
    """Who a task can be assigned to: the project's owner and members (only the owner for a loose task)."""
    if todo.project_id is None:
        return {todo.user_id}
    return {todo.project.owner_id, *ProjectMember.objects.filter(project_id=todo.project_id).values_list("user_id", flat=True)}


def can_edit_task(user, todo):
    """Your own loose tasks; in a project, only while you can edit there (a creator who was made
    read-only or removed keeps no edit rights on what they created)."""
    if todo.project_id is None:
        return todo.user_id == user.id
    role = project_role(user, todo.project)
    return role is not None and role >= ProjectMember.Role.WRITE


# ---------------------------------------------------------------- projects

def create_project(owner, name, **fields):
    with transaction.atomic():
        p = Project.objects.create(owner=owner, name=name, **fields)
        Bucket.objects.bulk_create([Bucket(project=p, name=n, position=i, is_done=d)
                                    for i, (n, d) in enumerate(DEFAULT_BUCKETS)])
    return p


def ensure_inbox(user):
    """Every user has one Inbox; todos made elsewhere (calendar, old API) land in it."""
    inbox = Project.objects.filter(owner=user, is_inbox=True).first()
    if inbox is None:
        try:
            inbox = create_project(user, "Inbox", is_inbox=True, position=-1)
        except IntegrityError:  # a concurrent first request made it (tasks_one_inbox_per_user)
            inbox = Project.objects.get(owner=user, is_inbox=True)
    orphans = Todo.objects.filter(user=user, project__isnull=True)
    if orphans.exists():
        first = inbox.buckets.filter(is_done=False).first()
        done = inbox.buckets.filter(is_done=True).first()
        orphans.filter(completed=False).update(project=inbox, bucket=first)
        orphans.filter(completed=True).update(project=inbox, bucket=done)
    return inbox


# ---------------------------------------------------------------- done / buckets / repeat

def _add_months(dt, n, day=None):
    """n months later on `day` (default: dt's day), clamped to the month's length (Jan 31 -> Feb 28)."""
    m = dt.month - 1 + n
    y, m = dt.year + m // 12, m % 12 + 1
    return dt.replace(year=y, month=m, day=min(day or dt.day, calendar.monthrange(y, m)[1]))


UNDO_REPEAT_WINDOW = datetime.timedelta(hours=1)
DAY_S = 86400


def _shift_dates(todo, shift):
    if todo.complete_by:
        todo.complete_by += shift
    if todo.start_on:
        todo.start_on += shift


def _localize(tz, naive):
    return tz.normalize(tz.localize(naive)) if hasattr(tz, "localize") else naive.replace(tzinfo=tz)


def _next_anchor(todo, anchor, now, tz):
    """The repeat's next date after `anchor`. Whole-day intervals and monthly repeats step in the owner's
    wall-clock time (9:00 stays 9:00 across DST); monthly repeats keep their day of the month
    (custom_info repeat_day: Jan 31 -> Feb 28 -> Mar 31). Shorter intervals step in absolute time."""
    info = todo.custom_info or {}
    local = anchor.astimezone(tz).replace(tzinfo=None)
    if todo.repeat_mode == 2:
        day = info.get("repeat_day")
        if not (isinstance(day, int) and 1 <= day <= 31
                and local.day == min(day, calendar.monthrange(local.year, local.month)[1])):
            day = local.day  # first repeat, or the due date was moved since: anchor on its day
        todo.custom_info = {**info, "repeat_day": day}
        months = 1
        if _localize(tz, _add_months(local, months, day)) < now:  # catch up in one jump, then step
            n_local = now.astimezone(tz)
            months = max(1, (n_local.year - local.year) * 12 + n_local.month - local.month - 1)
        while (new := _localize(tz, _add_months(local, months, day))) < now:
            months += 1
        return new
    if not todo.repeat_every:
        return anchor
    every = todo.repeat_every
    base = now if todo.repeat_mode == 3 else anchor
    if every % DAY_S == 0:
        base_local = base.astimezone(tz).replace(tzinfo=None)
        step = lambda k: _localize(tz, base_local + datetime.timedelta(days=k * every // DAY_S))
    else:
        step = lambda k: base + datetime.timedelta(seconds=k * every)
    k, new = 1, step(1)
    if todo.repeat_mode == 1 and new < now:  # overdue: skip the missed occurrences
        k = max(1, math.floor((now - base).total_seconds() / every))
        while (new := step(k)) < now:
            k += 1
    return new


def _shift_reminders(todo, shift):
    for r in todo.reminders.all():
        if r.at:
            r.at += shift
        r.sent_at = None
        r.resolve()
        r.save()


def set_done(todo, done):
    """Complete or reopen. A repeating task moves its dates forward and stays open.
    Reopening a repeating task within an hour of completing it undoes that step (dates and
    reminders move back). Returns True if the task repeated."""
    now = timezone.now()
    info = todo.custom_info or {}
    if not done and todo.repeat_mode and not todo.completed and info.get("last_shift_s") is not None:
        try:
            recent = now - datetime.datetime.fromisoformat(info["last_done"]) <= UNDO_REPEAT_WINDOW
        except (KeyError, TypeError, ValueError):
            recent = False
        if recent:
            shift = -datetime.timedelta(seconds=info["last_shift_s"])
            _shift_dates(todo, shift)
            todo.completed_on = None
            todo.custom_info = {k: v for k, v in info.items() if k not in ("last_shift_s", "last_done")}
            todo.custom_info["times_done"] = max(0, info.get("times_done", 1) - 1)
            todo.save()
            _shift_reminders(todo, shift)
            return False
    if done and todo.repeat_mode and (todo.complete_by or todo.start_on):
        anchor = todo.complete_by or todo.start_on
        shift = _next_anchor(todo, anchor, now, user_tz(todo.user)) - anchor
        _shift_dates(todo, shift)
        todo.completed_on = now
        todo.custom_info = {**(todo.custom_info or {}), "last_done": now.isoformat(), "last_shift_s": shift.total_seconds(),
                            "times_done": (todo.custom_info or {}).get("times_done", 0) + 1}
        todo.save()
        _shift_reminders(todo, shift)
        return True

    todo.completed = done
    todo.completed_on = now if done else None
    todo.status = 100 if done else (todo.status if todo.status != 100 else 0)
    if todo.project_id:
        current_done = todo.bucket.is_done if todo.bucket_id else False
        if done and not current_done:
            todo.bucket = todo.project.buckets.filter(is_done=True).first() or todo.bucket
        elif not done and current_done:
            todo.bucket = todo.project.buckets.filter(is_done=False).first()
    todo.save()
    return False


def move(todo, *, project=None, bucket=None, position=None):
    if project is not None and project.id != todo.project_id:
        todo.project = project
        todo.bucket = bucket if bucket and bucket.project_id == project.id else \
            project.buckets.filter(is_done=todo.completed).first()
    if bucket is not None and bucket.project_id == todo.project_id and bucket.id != todo.bucket_id:
        todo.bucket = bucket
        if bucket.is_done != todo.completed and set_done(todo, bucket.is_done):
            # A repeating task dropped in Done moved to its next date and stays open: back to the first open column.
            todo.bucket = todo.project.buckets.filter(is_done=False).first() or bucket
    if position is not None:
        todo.position = position
    todo.save()


# ---------------------------------------------------------------- ordering / keyset paging

def keyset_order(keys):
    """ORDER BY for [(field, desc, nullable)]: nulls last on both databases, then the id as a tiebreaker."""
    out = []
    for f, desc, nullable in keys:
        expr = F(f).desc(nulls_last=True) if desc else F(f).asc(nulls_last=True)
        out.append(expr if nullable else (F(f).desc() if desc else F(f).asc()))
    return out


def keyset_after(keys, values):
    """Rows strictly after `values` in keyset_order(keys) order: (a > x) or (a = x and b > y) or ...
    Nulls sort last, so nothing but another null follows a null."""
    cond, prefix = None, Q()
    for (f, desc, nullable), v in zip(keys, values):
        if v is None:
            same = Q(**{f + "__isnull": True})
        else:
            step = Q(**{f + ("__lt" if desc else "__gt"): v})
            if nullable:
                step |= Q(**{f + "__isnull": True})
            step = prefix & step
            cond = step if cond is None else cond | step
            same = Q(**{f: v})
        prefix &= same
    return cond if cond is not None else Q(pk__in=[])


POSITION_KEYS = [("position", False, False), ("created_on", False, False), ("id", False, False)]


def place(project_id, todos, after=None, before=None):
    """Give `todos` consecutive positions right after the task `after` (or right before `before`) in the
    project's manual order (position, created_on, id), so a drop needs no full renumber and works when the
    client has loaded only part of a long list. Renumbers the project (0..n) only when the gap between
    the neighbours is too small. Saves the todos; returns True if it renumbered."""
    moving = [t.id for t in todos]
    rest = Todo.objects.filter(project_id=project_id).exclude(id__in=moving)
    anchor = after or before
    vals = lambda t: [t.position, t.created_on, t.id]
    if after is not None:
        lo = after.position
        hi = rest.filter(keyset_after(POSITION_KEYS, vals(after))).order_by(*keyset_order(POSITION_KEYS)) \
            .values_list("position", flat=True).first()
    elif before is not None:
        hi = before.position
        rev = [(f, not d, n) for f, d, n in POSITION_KEYS]
        lo = rest.filter(keyset_after(rev, vals(before))).order_by(*keyset_order(rev)).values_list("position", flat=True).first()
    else:
        lo = rest.aggregate(m=Max("position"))["m"]
        hi = None
    n = len(todos)
    if lo is None and hi is None:
        new = [float(i + 1) for i in range(n)]
    elif hi is None:
        new = [lo + i + 1 for i in range(n)]
    elif lo is None:
        new = [hi - n + i for i in range(n)]
    elif hi - lo > 1e-6 * (n + 1):
        step = (hi - lo) / (n + 1)
        new = [lo + step * (i + 1) for i in range(n)]
    else:  # neighbours tie or are too close: renumber the project with the block in place
        ordered = list(rest.order_by(*keyset_order(POSITION_KEYS)).only("id", "position"))
        at = next(i for i, t in enumerate(ordered) if t.id == anchor.id) + (1 if after is not None else 0)
        ordered[at:at] = todos
        for i, t in enumerate(ordered):
            t.position = float(i)
        Todo.objects.bulk_update(ordered, ["position"], batch_size=500)
        return True
    for t, pos in zip(todos, new):
        t.position = pos
    Todo.objects.bulk_update(todos, ["position"])
    return False


def sync_reminders(todo):
    for r in todo.reminders.all():
        old = r.fire_at
        if r.resolve() != old:
            r.sent_at = None
            r.save(update_fields=["fire_at", "sent_at"])


# ---------------------------------------------------------------- quick add

WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]
UNITS = {"min": 60, "minute": 60, "hour": 3600, "day": 86400, "week": 604800, "month": 2592000, "year": 31536000}
_word = r'(?:"([^"]+)"|(\S+))'


def parse_quick_add(text, tz, now=None):
    """'Pay rent tomorrow 5pm *bills +Home !3 every month' ->
    {title, labels, project, priority, due, repeat_mode, repeat_every}. Unrecognised text stays in the title."""
    now = (now or timezone.now()).astimezone(tz)
    out = {"labels": [], "project": None, "priority": None, "due": None, "repeat_mode": 0, "repeat_every": None}

    def take(pattern, fn):
        nonlocal text
        m = re.search(pattern, text, flags=re.I)
        if m:
            fn(m)
            text = (text[:m.start()] + " " + text[m.end():]).strip()
        return m

    while take(r'(?:^|\s)\*' + _word, lambda m: out["labels"].append(m.group(1) or m.group(2))):
        pass
    take(r'(?:^|\s)\+' + _word, lambda m: out.__setitem__("project", m.group(1) or m.group(2)))
    take(r'(?:^|\s)!([1-5])\b', lambda m: out.__setitem__("priority", [5, 10, 15, 20, 20][int(m.group(1)) - 1]))

    def repeat(m):
        if m.group(1):
            n, unit = int(m.group(2) or 1), m.group(3).lower().rstrip("s")
            if unit == "month" and n == 1:
                out["repeat_mode"] = 2
            else:
                out["repeat_mode"], out["repeat_every"] = 1, n * UNITS[unit]
        else:
            word = m.group(4).lower()
            if word == "monthly":
                out["repeat_mode"] = 2
            else:
                out["repeat_mode"], out["repeat_every"] = 1, {"daily": 86400, "weekly": 604800, "yearly": 31536000}[word]
    take(r'\b(?:(every)\s+(\d+\s+)?(min(?:ute)?s?|hours?|days?|weeks?|months?|years?)|(daily|weekly|monthly|yearly))\b', repeat)

    day, clock = None, None
    tonight = bool(re.search(r"\btonight\b", text, re.I))  # checked before the word is stripped

    def set_time(m):
        nonlocal clock
        h, mnt, ap = int(m.group(1)), int(m.group(2) or 0), (m.group(3) or "").lower()
        if ap == "pm" and h < 12:
            h += 12
        if ap == "am" and h == 12:
            h = 0
        if h < 24 and mnt < 60:
            clock = (h, mnt)
    take(r'\b(?:at\s+)?(\d{1,2}):(\d{2})\s*(am|pm)?\b', set_time) or \
        take(r'\b(?:at\s+)?(\d{1,2})()\s*(am|pm)\b', set_time)

    today = now.date()

    def rel(m):
        nonlocal day
        w = m.group(0).lower()
        if w == "today" or w == "tonight":
            day = today
        elif w == "tomorrow":
            day = today + datetime.timedelta(days=1)
        elif w == "next week":
            day = today + datetime.timedelta(days=7)
        elif w == "next month":
            day = _add_months(datetime.datetime.combine(today, datetime.time()), 1).date()
        elif w == "weekend" or w == "this weekend":
            day = today + datetime.timedelta(days=(5 - today.weekday()) % 7)
    take(r'\b(?:today|tonight|tomorrow|next week|next month|this weekend|weekend)\b', rel)

    def in_n(m):
        nonlocal day, clock
        n, unit = int(m.group(1)), m.group(2).lower().rstrip("s")
        target = now + datetime.timedelta(seconds=n * UNITS[unit])
        day = target.date()
        if unit in ("min", "minute", "hour"):
            clock = (target.hour, target.minute)
    if day is None:
        take(r'\bin\s+(\d+)\s+(min(?:ute)?s?|hours?|days?|weeks?|months?)\b', in_n)

    def weekday(m):
        nonlocal day
        idx = [w[:3] for w in WEEKDAYS].index(m.group(2).lower()[:3])
        day = today + datetime.timedelta(days=(idx - today.weekday()) % 7 or 7)  # "next fri" = the coming one
    if day is None:
        take(r'\b(?:on\s+)?(next\s+)?(mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)(?:day|nesday|sday|urday)?\b', weekday)

    def iso(m):
        nonlocal day
        try:
            day = datetime.date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
        except ValueError:
            pass
    if day is None:
        take(r'\b(\d{4})-(\d{2})-(\d{2})\b', iso)

    def month_day(m):
        nonlocal day
        mon = m.group(1) or m.group(4)
        d = int(m.group(2) or m.group(3))
        try:
            cand = datetime.date(today.year, MONTHS.index(mon.lower()[:3]) + 1, d)
            day = cand if cand >= today else cand.replace(year=today.year + 1)
        except ValueError:
            pass
    if day is None:
        take(r'\b(?:on\s+)?(?:(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?|(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*)\b', month_day)

    if day is None and clock is not None:
        day = today if clock > (now.hour, now.minute) else today + datetime.timedelta(days=1)
    if day is not None:
        h, mnt = clock if clock else ((20, 0) if tonight else (23, 59))
        out["due"] = _localize(tz, datetime.datetime.combine(day, datetime.time(h, mnt)))
    if out["repeat_mode"] and out["due"] is None:
        out["due"] = _localize(tz, datetime.datetime.combine(today, datetime.time(23, 59)))

    out["title"] = re.sub(r"\s{2,}", " ", text).strip() or "Untitled"
    return out


def labels_by_name(user, names):
    out = []
    for n in names:
        n = n.strip()[:48]
        if n:
            label = Label.objects.filter(owner=user, name__iexact=n).first() or Label.objects.create(owner=user, name=n)
            out.append(label)
    return out


# ---------------------------------------------------------------- reminders job

def due_reminders(now=None):
    now = now or timezone.now()
    return (Reminder.objects.select_related("todo__user", "todo__project")
            .filter(sent_at__isnull=True, fire_at__isnull=False, fire_at__lte=now,
                    fire_at__gte=now - datetime.timedelta(days=1), todo__completed=False))
