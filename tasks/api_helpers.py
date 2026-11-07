"""Shared parts of /api/v2/tasks/: access checks, applying edits, filters, sorting and paging."""

import base64
import binascii
import datetime
import json
import uuid

from django.db.models import Count, IntegerField, OuterRef, Q, Subquery
from django.db.models.functions import Coalesce
from django.shortcuts import get_object_or_404
from django.utils import timezone
from ninja.errors import HttpError

from scheduler.models import Todo
from users.models import ComptechUser

from . import service as svc
from .models import Bucket, Comment, Label, Project, ProjectMember, Relation, Reminder
from .schemas import _clean

# ================================================================ helpers

def _count(qs, fk):
    """COUNT(*) of qs rows pointing at the outer task, as a correlated subquery. Four of these cost a few
    index lookups per returned row; four COUNT(DISTINCT) over joins made Postgres expect millions of rows
    and spend about a second JIT-compiling even an empty list."""
    sub = qs.filter(**{fk: OuterRef("pk")}).order_by().values(fk).annotate(c=Count("*")).values("c")
    return Coalesce(Subquery(sub, output_field=IntegerField()), 0)


def _tasks_qs(user):
    return (svc.visible_tasks(user)
            .select_related("user")
            .prefetch_related("labels", "assignees", "reminders")
            .annotate(n_sub=_count(Todo.objects.all(), "parent"),
                      n_sub_done=_count(Todo.objects.filter(completed=True), "parent"),
                      n_comments=_count(Comment.objects.all(), "todo"),
                      n_relations=_count(Relation.objects.all(), "todo")))


def _task(user, task_id, edit=False):
    t = get_object_or_404(_tasks_qs(user), id=task_id)
    if edit and not svc.can_edit_task(user, t):
        raise HttpError(403, "You can only view this task")
    return t


def _project(user, project_id, role=ProjectMember.Role.READ):
    p = get_object_or_404(Project, id=project_id)
    r = svc.project_role(user, p)
    if r is None:
        raise HttpError(404, "Project not found")
    if r < role:
        raise HttpError(403, "Not allowed in this project")
    return p


def _project_out(p, user, counts):
    return {**{f: getattr(p, f) for f in ("id", "parent_id", "name", "description", "colour", "is_inbox",
                                          "archived", "favorite", "position", "default_view")},
            "role": svc.project_role(user, p), "shared": p.owner_id != user.id or p.members.exists(), "owner": p.owner,
            "open_count": counts.get(p.id, (0, 0))[0], "done_count": counts.get(p.id, (0, 0))[1]}


def _assignees(t, usernames):
    """Assignees must be able to see the task: the project's owner and members (just the owner for a
    loose task). People already assigned can stay."""
    users = list(ComptechUser.objects.filter(username__in=usernames))
    if len(users) != len(set(usernames)):
        raise HttpError(400, "Unknown user in assignees")
    allowed = svc.assignable_user_ids(t) | set(t.assignees.values_list("id", flat=True))
    if any(u.id not in allowed for u in users):
        raise HttpError(400, "Assignees must be members of the task's project")
    return users


def _history_time(value, what):
    """Imported timestamps: real moments in the past (a day of clock skew allowed)."""
    if value is None:
        return None
    if timezone.is_naive(value):
        value = timezone.make_aware(value)
    if value > timezone.now() + datetime.timedelta(days=1) or value.year < 1990:
        raise HttpError(400, f"{what} must be a past date")
    return value


def _apply_task(user, t, data):
    if data.get("created_at"):
        t.created_on = _history_time(data["created_at"], "created_at")
    if "end" in data or data.get("ref") is not None:
        ci = dict(t.custom_info or {})
        if "end" in data:
            if data["end"]:
                ci["end"] = data["end"].isoformat()
            else:
                ci.pop("end", None)
        if data.get("ref") is not None:
            ref = _clean(data["ref"])[:64]
            if ref:
                ci["ref"] = ref
            else:
                ci.pop("ref", None)
        t.custom_info = ci
    if data.get("done"):  # create, already completed (no repeat step: it's history)
        t.completed, t.status = True, 100
        t.completed_on = _history_time(data.get("done_at"), "done_at") or timezone.now()
    elif data.get("done_at") and t.completed:  # backfill on an existing completed task
        t.completed_on = _history_time(data["done_at"], "done_at")
    simple = {"title": "name", "due": "complete_by", "start": "start_on", "priority": "priority",
              "percent": "percent_complete", "time_spent": "time_spent", "repeat_mode": "repeat_mode",
              "repeat_every": "repeat_every", "favorite": "favorite", "colour": "colour"}
    for key, field in simple.items():
        if key in data:
            setattr(t, field, _clean(data[key]) if key == "title" else data[key])
    if "description" in data:
        t.description = _clean(data["description"])  # plain text; the UIs render it as text
    if "parent_id" in data and data["parent_id"] != t.parent_id:  # re-checked only when it changes
        if data["parent_id"] is None:
            t.parent = None
        else:
            parent = _task(user, data["parent_id"], edit=True)  # adding a subtask edits the parent
            if parent.id == t.id or (t.id and _is_descendant(parent, t.id)):
                raise HttpError(400, "A task can't be its own subtask")
            t.parent = parent
    if t.repeat_mode in (1, 3) and not t.repeat_every:
        raise HttpError(400, "repeat_every (seconds) is needed for this repeat mode")


def _is_descendant(task, ancestor_id):
    seen = 0
    while task.parent_id and seen < 50:
        if task.parent_id == ancestor_id:
            return True
        task = task.parent
        seen += 1
    return False


def _set_m2m(user, t, data):
    if data.get("labels") is not None:
        # Labels are per user: replace the editor's own, keep the ones other people put on the task.
        labels = list(Label.objects.filter(id__in=data["labels"], owner=user))
        others = list(t.labels.exclude(owner=user))
        t.labels.set(labels + others)
    if data.get("assignees") is not None:
        t.assignees.set(_assignees(t, data["assignees"]))
    if data.get("reminders") is not None:
        t.reminders.all().delete()
        for r in data["reminders"]:
            rem = Reminder(todo=t, **r)
            if not rem.relative_to and not rem.at:
                raise HttpError(400, "A reminder needs a time or relative_to")
            rem.resolve()
            rem.save()


def _filter(qs, user, *, view="", project=None, label="", priority_min=None, q="", done=None,
            due_before=None, due_after=None, parent=None, top_level=False, assignee="", done_after=None):
    now = timezone.now()
    tz = svc.user_tz(user)
    end_today = timezone.localtime(now, tz).replace(hour=23, minute=59, second=59)
    start_today = end_today.replace(hour=0, minute=0, second=0)
    if view == "today":
        qs = qs.filter(complete_by__lte=end_today)
    elif view == "upcoming":
        qs = qs.filter(complete_by__gte=start_today, complete_by__lte=end_today + datetime.timedelta(days=7))
    elif view == "overdue":
        qs = qs.filter(complete_by__lt=now)
    elif view == "nodate":
        qs = qs.filter(complete_by__isnull=True)
    elif view == "favorites":
        qs = qs.filter(favorite=True)
    elif view == "assigned":
        qs = qs.filter(assignees=user)
    if view == "done":
        done = True
    if done is not None:
        qs = qs.filter(completed=done)
    elif view in ("today", "upcoming", "overdue", "nodate", "favorites", "assigned", ""):
        qs = qs.filter(completed=False) if view or project is None else qs
    if project:
        qs = qs.filter(project_id=project)
    else:
        qs = qs.exclude(project__archived=True)
    if label:
        for lid in [int(x) for x in str(label).split(",") if x.strip().isdigit()]:
            qs = qs.filter(labels__id=lid)
    if priority_min is not None:
        qs = qs.filter(priority__gte=priority_min)
    if q:
        qs = qs.filter(Q(name__icontains=q) | Q(description__icontains=q))
    if due_before:
        qs = qs.filter(complete_by__lt=due_before)
    if due_after:
        qs = qs.filter(complete_by__gte=due_after)
    if parent:
        qs = qs.filter(parent_id=parent)
    elif top_level:
        qs = qs.filter(parent__isnull=True)
    if assignee:
        qs = qs.filter(assignees__username=assignee)
    if done_after:
        qs = qs.filter(completed_on__gte=done_after)
    return qs


# Sort keys as (field, descending, nullable); the id breaks ties, so keyset paging never skips or repeats a row.
SORTS = {"position": [("position", False, False), ("created_on", False, False)],
         "due": [("complete_by", False, True), ("priority", True, False)],
         "priority": [("priority", True, False), ("complete_by", False, True)],
         "created": [("created_on", True, False)], "updated": [("updated_on", True, False)],
         "title": [("name", False, False)], "done": [("completed_on", True, True)]}
SORTS = {k: v + [("id", False, False)] for k, v in SORTS.items()}
_DATES = {"complete_by", "created_on", "updated_on", "completed_on"}
PAGE_MAX = 500


def _cursor(sort, t):
    vals = []
    for f, _d, _n in SORTS[sort]:
        v = getattr(t, f)
        vals.append(v.isoformat() if isinstance(v, datetime.datetime) else str(v) if isinstance(v, uuid.UUID) else v)
    return base64.urlsafe_b64encode(json.dumps([sort, vals], separators=(",", ":")).encode()).decode().rstrip("=")


def _uncursor(sort, cursor):
    try:
        if len(cursor) > 2000:
            raise ValueError
        got, vals = json.loads(base64.urlsafe_b64decode(cursor + "=" * (-len(cursor) % 4)))
        keys = SORTS[sort]
        if got != sort or len(vals) != len(keys):
            raise ValueError
        out = []
        for (f, _d, _n), v in zip(keys, vals):
            if v is None:
                out.append(None)
            elif f in _DATES:
                out.append(datetime.datetime.fromisoformat(v))
            elif f == "id":
                out.append(uuid.UUID(v))
            elif f == "position":
                out.append(float(v))
            elif f == "priority":
                out.append(int(v))
            else:
                out.append(str(v))
        return out
    except (ValueError, TypeError, KeyError, binascii.Error):
        raise HttpError(400, "Invalid cursor (it belongs to another sort, or is damaged)")


def _page(qs, sort, limit, cursor="", offset=0):
    """One page in `sort` order, keyset-paged after `cursor` (offset still works without one).
    Returns (items, next cursor or None)."""
    keys = SORTS[sort]
    if cursor:
        qs = qs.filter(svc.keyset_after(keys, _uncursor(sort, cursor)))
        offset = 0
    rows = list(qs.order_by(*svc.keyset_order(keys))[offset:offset + limit + 1])
    more = len(rows) > limit
    rows = rows[:limit]
    return rows, (_cursor(sort, rows[-1]) if more and rows else None)


def _bucket_filter(project_id, bucket_id):
    """A board column's tasks: the bucket's own, and in the first open column also tasks without a valid
    bucket (as the board shows them)."""
    buckets = list(Bucket.objects.filter(project_id=project_id).order_by("position", "id").values_list("id", "is_done"))
    ids = [b for b, _ in buckets]
    first = next((b for b, d in buckets if not d), ids[0] if ids else None)
    if bucket_id == first:
        return Q(bucket_id=bucket_id) | Q(bucket__isnull=True) | ~Q(bucket_id__in=ids)
    return Q(bucket_id=bucket_id)


def _anchor(project_id, task_id):
    if task_id is None:
        return None
    t = Todo.objects.filter(project_id=project_id, id=task_id).first()
    if t is None:
        raise HttpError(400, "after/before must be a task in the same project")
    return t
