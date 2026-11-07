"""/api/v2/tasks/: projects, kanban buckets, labels, tasks, comments, relations, reminders, saved views."""

import base64
import binascii
import datetime
import json
import uuid
from typing import Literal, Optional

import bleach
from django.db import transaction
from django.db.models import Case, Count, F, IntegerField, Max, OuterRef, Q, Subquery, Value, When, Window
from django.db.models.functions import Coalesce, RowNumber
from django.shortcuts import get_object_or_404
from django.utils import timezone
from ninja import Field, Router, Schema
from ninja.errors import HttpError

from scheduler.models import Event, Todo
from users.models import ComptechUser

from . import service as svc
from .models import Bucket, Comment, Label, Project, ProjectMember, Relation, Reminder, SavedView

router = Router(tags=["tasks"])
HEX = r"^(#[0-9a-fA-F]{6})?$"
SMALLINT = 32767        # PositiveSmallIntegerField columns (Postgres smallint)
INT = 2147483647        # IntegerField / PositiveIntegerField columns (Postgres integer)


def _clean(text):
    return bleach.clean(text or "", tags=[], strip=True)


# ================================================================ schemas

class UserBrief(Schema):
    id: uuid.UUID
    username: str
    name: str

    @staticmethod
    def resolve_name(obj):
        return obj.get_full_name() or obj.username


class ProjectOut(Schema):
    id: uuid.UUID
    parent_id: Optional[uuid.UUID]
    name: str
    description: str
    colour: str
    is_inbox: bool
    archived: bool
    favorite: bool
    position: float
    default_view: str
    role: int
    shared: bool
    owner: UserBrief
    open_count: int = 0
    done_count: int = 0


class ProjectIn(Schema):
    name: str = Field(..., min_length=1, max_length=128)
    parent_id: Optional[uuid.UUID] = None
    description: str = ""
    colour: str = Field("", pattern=HEX)
    default_view: Literal["list", "board", "table", "calendar"] = "list"


class ProjectPatch(Schema):
    name: Optional[str] = Field(None, min_length=1, max_length=128)
    parent_id: Optional[uuid.UUID] = None
    description: Optional[str] = None
    colour: Optional[str] = Field(None, pattern=HEX)
    archived: Optional[bool] = None
    favorite: Optional[bool] = None
    position: Optional[float] = None
    default_view: Optional[Literal["list", "board", "table", "calendar"]] = None


class MemberOut(Schema):
    id: int
    user: UserBrief
    role: int


class MemberIn(Schema):
    username: str
    role: int = Field(1, ge=0, le=2)


class BucketOut(Schema):
    id: int
    project_id: uuid.UUID
    name: str
    position: float
    limit: int
    is_done: bool


class BucketIn(Schema):
    name: str = Field(..., min_length=1, max_length=64)
    position: Optional[float] = None
    limit: int = Field(0, ge=0, le=SMALLINT)
    is_done: bool = False


class BucketPatch(Schema):
    name: Optional[str] = Field(None, min_length=1, max_length=64)
    position: Optional[float] = None
    limit: Optional[int] = Field(None, ge=0, le=SMALLINT)
    is_done: Optional[bool] = None


class LabelOut(Schema):
    id: int
    name: str
    colour: str


class LabelIn(Schema):
    name: str = Field(..., min_length=1, max_length=48)
    colour: str = Field("", pattern=HEX)


class LabelPatch(Schema):
    name: Optional[str] = Field(None, min_length=1, max_length=48)
    colour: Optional[str] = Field(None, pattern=HEX)


class ReminderOut(Schema):
    id: int
    at: Optional[datetime.datetime]
    relative_to: str
    offset: int
    fire_at: Optional[datetime.datetime]
    sent: bool

    @staticmethod
    def resolve_sent(obj):
        return obj.sent_at is not None


class ReminderIn(Schema):
    at: Optional[datetime.datetime] = None
    relative_to: Literal["", "due", "start"] = ""
    offset: int = Field(0, ge=-INT, le=INT)  # seconds; negative = before


class RelationOut(Schema):
    id: int
    kind: str
    other_id: uuid.UUID
    other_name: str
    other_done: bool
    other_visible: bool = True  # false: a task you can't open (title shown as "Private task")

    @staticmethod
    def resolve_other_visible(obj):
        return getattr(obj, "other_visible", True)

    @staticmethod
    def resolve_other_name(obj):
        return obj.other.name if getattr(obj, "other_visible", True) else "Private task"

    @staticmethod
    def resolve_other_done(obj):
        return obj.other.completed if getattr(obj, "other_visible", True) else False


class TaskOut(Schema):
    id: uuid.UUID
    title: str
    description: str
    done: bool
    done_at: Optional[datetime.datetime]
    end: Optional[datetime.datetime] = None   # imported end date, if any
    ref: str = ""                             # the original app's id, for imports
    due: Optional[datetime.datetime]
    start: Optional[datetime.datetime]
    priority: int
    priority_label: str
    project_id: Optional[uuid.UUID]
    bucket_id: Optional[int]
    position: float
    parent_id: Optional[uuid.UUID]
    labels: list[int]
    assignees: list[UserBrief]
    percent: int
    time_spent: int
    repeat_mode: int
    repeat_every: Optional[int]
    favorite: bool
    colour: str
    reminders: list[ReminderOut]
    subtasks: int = 0
    subtasks_done: int = 0
    comments: int = 0
    relation_count: int = 0
    event_id: Optional[str]
    owner: UserBrief
    created_on: datetime.datetime
    updated_on: datetime.datetime

    @staticmethod
    def resolve_title(o): return o.name
    @staticmethod
    def resolve_description(o): return o.description or ""
    @staticmethod
    def resolve_done(o): return o.completed
    @staticmethod
    def resolve_done_at(o): return o.completed_on

    @staticmethod
    def resolve_end(o): return (o.custom_info or {}).get("end")

    @staticmethod
    def resolve_ref(o): return (o.custom_info or {}).get("ref") or ""
    @staticmethod
    def resolve_due(o): return o.complete_by
    @staticmethod
    def resolve_start(o): return o.start_on
    @staticmethod
    def resolve_priority_label(o): return svc.priority_label(o.priority)
    @staticmethod
    def resolve_labels(o): return [label.id for label in o.labels.all()]
    @staticmethod
    def resolve_assignees(o): return list(o.assignees.all())
    @staticmethod
    def resolve_percent(o): return o.percent_complete or 0
    @staticmethod
    def resolve_time_spent(o): return o.time_spent or 0
    @staticmethod
    def resolve_reminders(o): return list(o.reminders.all())
    @staticmethod
    def resolve_subtasks(o): return getattr(o, "n_sub", 0)
    @staticmethod
    def resolve_subtasks_done(o): return getattr(o, "n_sub_done", 0)
    @staticmethod
    def resolve_comments(o): return getattr(o, "n_comments", 0)
    @staticmethod
    def resolve_relation_count(o): return getattr(o, "n_relations", 0)
    @staticmethod
    def resolve_event_id(o): return (o.custom_info or {}).get("event_id")
    @staticmethod
    def resolve_owner(o): return o.user


class TaskDetailOut(TaskOut):
    relations: list[RelationOut]

    @staticmethod
    def resolve_relations(o):
        return getattr(o, "relation_rows", None) or list(o.relations.select_related("other"))


class TaskIn(Schema):
    title: str = Field(..., min_length=1, max_length=256)
    description: str = ""
    project_id: Optional[uuid.UUID] = None  # default: Inbox
    bucket_id: Optional[int] = None
    parent_id: Optional[uuid.UUID] = None
    due: Optional[datetime.datetime] = None
    start: Optional[datetime.datetime] = None
    priority: int = Field(10, ge=0, le=20)
    labels: list[int] = []
    assignees: list[str] = []  # usernames
    repeat_mode: int = Field(0, ge=0, le=3)
    repeat_every: Optional[int] = Field(None, ge=60, le=INT)
    favorite: bool = False
    colour: str = Field("", pattern=HEX)
    reminders: list[ReminderIn] = []
    position: Optional[float] = None
    percent: int = Field(0, ge=0, le=100)
    time_spent: int = Field(0, ge=0, le=SMALLINT)
    # Importing from another app (e.g. Vikunja) keeps the original history:
    done: bool = False                                     # create it already completed
    done_at: Optional[datetime.datetime] = None            # when it was completed (default: now)
    created_at: Optional[datetime.datetime] = None         # when it was created (default: now)
    end: Optional[datetime.datetime] = None                # an end date, kept alongside start/due
    ref: str = Field("", max_length=64)                    # the original app's id, e.g. "vikunja:#12"


class TaskPatch(Schema):
    title: Optional[str] = Field(None, min_length=1, max_length=256)
    description: Optional[str] = None
    parent_id: Optional[uuid.UUID] = None
    due: Optional[datetime.datetime] = None
    start: Optional[datetime.datetime] = None
    priority: Optional[int] = Field(None, ge=0, le=20)
    labels: Optional[list[int]] = None
    assignees: Optional[list[str]] = None
    percent: Optional[int] = Field(None, ge=0, le=100)
    time_spent: Optional[int] = Field(None, ge=0, le=SMALLINT)
    repeat_mode: Optional[int] = Field(None, ge=0, le=3)
    repeat_every: Optional[int] = Field(None, ge=60, le=INT)
    favorite: Optional[bool] = None
    colour: Optional[str] = Field(None, pattern=HEX)
    reminders: Optional[list[ReminderIn]] = None  # replaces the list
    done_at: Optional[datetime.datetime] = None     # correct when a completed task was done (backfill)
    created_at: Optional[datetime.datetime] = None  # correct when it was created (backfill)
    end: Optional[datetime.datetime] = None
    ref: Optional[str] = Field(None, max_length=64)


class MoveIn(Schema):
    project_id: Optional[uuid.UUID] = None
    bucket_id: Optional[int] = None
    position: Optional[float] = None
    # Or place it next to a task (in the destination project): the server picks the position, so a drop
    # works when only part of a long list or column is loaded.
    after: Optional[uuid.UUID] = None
    before: Optional[uuid.UUID] = None


class QuickIn(Schema):
    text: str = Field(..., min_length=1, max_length=512)
    project_id: Optional[uuid.UUID] = None
    parent_id: Optional[uuid.UUID] = None
    bucket_id: Optional[int] = None  # e.g. "Add task" in a board column


class DoneOut(Schema):
    task: TaskOut
    repeated: bool


class CommentOut(Schema):
    id: uuid.UUID
    author: UserBrief
    body: str
    created_on: datetime.datetime
    edited_on: Optional[datetime.datetime]


class CommentIn(Schema):
    body: str = Field(..., min_length=1, max_length=10000)


class RelationIn(Schema):
    other_id: uuid.UUID
    kind: Literal["related", "blocks", "blocked_by", "duplicate_of", "duplicated_by", "precedes", "follows"]


class ViewOut(Schema):
    id: uuid.UUID
    name: str
    filters: dict
    position: float


class ViewIn(Schema):
    name: str = Field(..., min_length=1, max_length=64)
    filters: dict = {}
    position: float = 0


class ViewPatch(Schema):
    name: Optional[str] = Field(None, min_length=1, max_length=64)
    filters: Optional[dict] = None
    position: Optional[float] = None


class OverviewOut(Schema):
    projects: Optional[list[ProjectOut]] = None   # with ?include=projects
    labels: Optional[list[LabelOut]] = None       # with ?include=labels
    views: Optional[list[ViewOut]] = None         # with ?include=views
    inbox: int
    today: int
    overdue: int
    upcoming: int
    no_date: int
    favorites: int
    assigned: int
    done_this_week: int
    done_today: int = 0  # completed since local midnight (Tasks > Today's "n of m done")
    inbox_id: uuid.UUID


class TaskPage(Schema):
    items: list[TaskOut]
    total: Optional[int] = None  # null with count=false
    next: Optional[str] = None   # cursor for the next page; null on the last page


class BoardColumn(BucketOut):
    total: int        # top-level tasks in the column (matching q)
    open: int         # open ones (the WIP limit counts these)
    items: Optional[list[TaskOut]] = None
    next: Optional[str] = None


class BoardOut(Schema):
    columns: list[BoardColumn]


class BulkFilter(Schema):
    """The list filters of GET / (a "select all N matching" selection)."""
    view: Literal["", "today", "upcoming", "overdue", "nodate", "favorites", "assigned", "done"] = ""
    project: Optional[uuid.UUID] = None
    label: str = ""
    priority_min: Optional[int] = None
    q: str = Field("", max_length=200)
    done: Optional[bool] = None
    due_before: Optional[datetime.datetime] = None
    due_after: Optional[datetime.datetime] = None
    parent: Optional[uuid.UUID] = None
    top_level: bool = False
    assignee: str = ""
    done_after: Optional[datetime.datetime] = None
    bucket: Optional[int] = None


class BulkIn(Schema):
    ids: Optional[list[uuid.UUID]] = Field(None, max_length=500)
    filter: Optional[BulkFilter] = None   # instead of ids: every task matching (up to 5000)
    action: Literal["done", "reopen", "update", "move", "delete"]
    # update:
    priority: Optional[int] = Field(None, ge=0, le=20)
    favorite: Optional[bool] = None
    due: Optional[datetime.datetime] = None        # exact due for all
    due_day: Optional[datetime.date] = None        # that day, keeping each task's time of day (23:59 if none)
    clear_due: bool = False
    add_label: Optional[int] = None
    remove_label: Optional[int] = None
    # move:
    project_id: Optional[uuid.UUID] = None


class BulkOut(Schema):
    count: int                      # tasks changed
    failed: int                     # selected but not editable by you (or gone)
    more: bool = False              # filter matched more than 5000: run it again for the rest
    ids: list[uuid.UUID]            # what changed (for undo)
    tasks: Optional[list[TaskOut]] = None  # with ids: the changed tasks, to update lists in place


class PlaceIn(Schema):
    ids: list[uuid.UUID] = Field(..., min_length=1, max_length=500)
    after: Optional[uuid.UUID] = None
    before: Optional[uuid.UUID] = None


class PlaceOut(Schema):
    positions: dict[str, float]
    renumbered: bool  # other tasks' positions changed too: refetch the project's lists


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


# ================================================================ overview

@router.get("/overview", response=OverviewOut, exclude_none=True,
            summary="Counts for the sidebar; ?include=projects,labels,views bundles the page's first load into one request")
def overview(request, include: str = ""):
    user = request.user
    inbox = svc.ensure_inbox(user)
    base = svc.visible_tasks(user).exclude(project__archived=True)
    open_ = base.filter(completed=False)
    count = lambda view: _filter(base, user, view=view).count()
    week_ago = timezone.now() - datetime.timedelta(days=7)
    tz = svc.user_tz(user)
    midnight = timezone.localtime(timezone.now(), tz).replace(hour=0, minute=0, second=0, microsecond=0)
    out = {"inbox": open_.filter(project=inbox).count(), "today": count("today"), "overdue": count("overdue"),
           "upcoming": count("upcoming"), "no_date": count("nodate"), "favorites": count("favorites"),
           "assigned": count("assigned"), "done_this_week": base.filter(completed=True, completed_on__gte=week_ago).count(),
           "done_today": base.filter(completed=True, completed_on__gte=midnight).count(),
           "inbox_id": inbox.id}
    parts = {p.strip() for p in include.split(",") if p.strip()}
    if "projects" in parts:
        out["projects"] = list_projects(request, include_archived="archived" in parts)
    if "labels" in parts:
        out["labels"] = list(Label.objects.filter(owner=user))
    if "views" in parts:
        out["views"] = list(SavedView.objects.filter(owner=user))
    return out


# ================================================================ projects

@router.get("/projects", response=list[ProjectOut])
def list_projects(request, include_archived: bool = False):
    svc.ensure_inbox(request.user)
    qs = svc.accessible_projects(request.user).select_related("owner").prefetch_related("members")
    if not include_archived:
        qs = qs.filter(archived=False)
    counts = {r[0]: r[1:] for r in Todo.objects.filter(project__in=qs).values_list("project").annotate(
        o=Count("id", filter=Q(completed=False)), d=Count("id", filter=Q(completed=True))).order_by()}
    return [_project_out(p, request.user, counts) for p in qs.order_by("-is_inbox", "position", "name")]


@router.post("/projects", response={201: ProjectOut})
def create_project(request, payload: ProjectIn):
    data = payload.dict()
    if data["parent_id"] and _project(request.user, data["parent_id"]).owner_id != request.user.id:
        raise HttpError(400, "Sub-projects go inside your own projects")
    data["name"], data["description"] = _clean(data["name"]), _clean(data["description"])
    pos = (Project.objects.filter(owner=request.user).aggregate(m=Max("position"))["m"] or 0) + 1
    p = svc.create_project(request.user, position=pos, **data)
    return 201, _project_out(p, request.user, {})


@router.patch("/projects/{uuid:project_id}", response=ProjectOut)
def update_project(request, project_id: uuid.UUID, payload: ProjectPatch):
    p = _project(request.user, project_id, ProjectMember.Role.ADMIN)
    data = {k: v for k, v in payload.dict(exclude_unset=True).items() if v is not None or k in ("parent_id", "description")}
    if p.is_inbox and ("archived" in data or "parent_id" in data):
        raise HttpError(400, "The Inbox can't be archived or nested")
    if data.get("parent_id", p.parent_id) == p.parent_id:
        data.pop("parent_id", None)
    elif p.owner_id != request.user.id:
        # Deleting a project deletes what's inside it, so only the owner nests it, under their own projects.
        raise HttpError(403, "Only the owner can move this project")
    elif data["parent_id"]:
        parent = _project(request.user, data["parent_id"])
        if parent.owner_id != p.owner_id:
            raise HttpError(400, "Sub-projects go inside your own projects")
        node, seen = parent, 0
        while node and seen < 100:
            if node.id == p.id:
                raise HttpError(400, "A project can't be inside itself")
            node, seen = node.parent, seen + 1
    for key, value in data.items():
        setattr(p, key, _clean(value) if key in ("name", "description") else value)
    p.save()
    return _project_out(p, request.user, {})


@router.delete("/projects/{uuid:project_id}", response={204: None})
def delete_project(request, project_id: uuid.UUID):
    p = _project(request.user, project_id, ProjectMember.Role.ADMIN)
    if p.is_inbox or p.owner_id != request.user.id:
        raise HttpError(400, "Only the owner can delete a project, and never the Inbox")
    with transaction.atomic():
        # Sub-projects someone else owns are moved to the top level instead of being deleted with this one.
        frontier, seen = [p.id], {p.id}
        while frontier:
            kids = list(Project.objects.filter(parent_id__in=frontier).values_list("id", "owner_id"))
            Project.objects.filter(id__in=[k for k, o in kids if o != p.owner_id]).update(parent=None)
            frontier = [k for k, o in kids if o == p.owner_id and k not in seen]
            seen.update(frontier)
        p.delete()
    return 204, None


class ReorderIn(Schema):
    ids: list[uuid.UUID] = Field(..., max_length=2000)


@router.post("/projects/{uuid:project_id}/reorder", response={204: None}, summary="Set task order (positions 0..n) in a project")
def reorder_tasks(request, project_id: uuid.UUID, payload: ReorderIn):
    p = _project(request.user, project_id, ProjectMember.Role.WRITE)
    tasks = {t.id: t for t in Todo.objects.filter(project=p, id__in=payload.ids)}
    ordered = [tasks[i] for i in payload.ids if i in tasks]
    for pos, t in enumerate(ordered):
        t.position = pos
    Todo.objects.bulk_update(ordered, ["position"])
    return 204, None


def _anchor(project_id, task_id):
    if task_id is None:
        return None
    t = Todo.objects.filter(project_id=project_id, id=task_id).first()
    if t is None:
        raise HttpError(400, "after/before must be a task in the same project")
    return t


@router.post("/projects/{uuid:project_id}/place", response=PlaceOut,
             summary="Put tasks (in this order) right after one task or before another; neither = at the end")
def place_tasks(request, project_id: uuid.UUID, payload: PlaceIn):
    p = _project(request.user, project_id, ProjectMember.Role.WRITE)
    if payload.after and payload.before:
        raise HttpError(400, "Give after or before, not both")
    if {payload.after, payload.before} & set(payload.ids):
        raise HttpError(400, "A task can't be placed next to itself")
    tasks = {t.id: t for t in Todo.objects.filter(project=p, id__in=payload.ids)}
    ordered = [tasks[i] for i in dict.fromkeys(payload.ids) if i in tasks]
    if not ordered:
        raise HttpError(404, "No such tasks in this project")
    renumbered = svc.place(p.id, ordered, after=_anchor(p.id, payload.after), before=_anchor(p.id, payload.before))
    return {"positions": {str(t.id): t.position for t in ordered}, "renumbered": renumbered}


@router.get("/projects/{uuid:project_id}/members", response=list[MemberOut])
def list_members(request, project_id: uuid.UUID):
    p = _project(request.user, project_id)
    return list(p.members.select_related("user"))


@router.post("/projects/{uuid:project_id}/members", response={201: MemberOut})
def add_member(request, project_id: uuid.UUID, payload: MemberIn):
    p = _project(request.user, project_id, ProjectMember.Role.ADMIN)
    if p.is_inbox:
        raise HttpError(400, "The Inbox is private")
    user = get_object_or_404(ComptechUser, username=payload.username)
    if user.id == p.owner_id:
        raise HttpError(400, "That's the owner")
    m, _ = ProjectMember.objects.update_or_create(project=p, user=user, defaults={"role": payload.role})
    from notifications.service import notify
    notify(user, f"{request.user.get_full_name() or request.user.username} shared the project \"{p.name}\" with you",
           source="Tasks", url=f"/tasks?project={p.id}")
    return 201, m


@router.delete("/projects/{uuid:project_id}/members/{int:member_id}", response={204: None})
def remove_member(request, project_id: uuid.UUID, member_id: int):
    p = _project(request.user, project_id)
    m = get_object_or_404(ProjectMember, id=member_id, project=p)
    if m.user_id != request.user.id and svc.project_role(request.user, p) < ProjectMember.Role.ADMIN:
        raise HttpError(403, "Only admins can remove other people")
    with transaction.atomic():
        m.delete()  # they no longer see the project's tasks, assigned ones included
        Todo.assignees.through.objects.filter(todo__project=p, comptechuser_id=m.user_id).delete()
    return 204, None


# ================================================================ buckets

@router.get("/projects/{uuid:project_id}/buckets", response=list[BucketOut])
def list_buckets(request, project_id: uuid.UUID):
    return list(_project(request.user, project_id).buckets.all())


@router.get("/projects/{uuid:project_id}/board", response=BoardOut,
            summary="The board in one request: columns with counts and the first `per` top-level tasks of each")
def board(request, project_id: uuid.UUID, q: str = "", per: int = 50, items: bool = True):
    p = _project(request.user, project_id)
    buckets = list(p.buckets.order_by("position", "id"))
    ids = [b.id for b in buckets]
    first = next((b.id for b in buckets if not b.is_done), ids[0] if ids else None)
    col = Case(When(bucket_id__in=ids, then=F("bucket_id")), default=Value(first), output_field=IntegerField())
    base = _filter(svc.visible_tasks(request.user), request.user, project=p.id, q=q[:200], top_level=True)
    counts = {r["col"]: r for r in base.annotate(col=col).values("col")
              .annotate(total=Count("id"), open=Count("id", filter=Q(completed=False))).order_by()}
    per = max(1, min(per, 200))
    cols = {b.id: {**{f: getattr(b, f) for f in ("id", "project_id", "name", "position", "limit", "is_done")},
                   "total": counts.get(b.id, {}).get("total", 0), "open": counts.get(b.id, {}).get("open", 0)}
            for b in buckets}
    if items and buckets:
        # One query for every column's first page: number the rows per column, keep the first per + 1.
        qs = (_filter(_tasks_qs(request.user), request.user, project=p.id, q=q[:200], top_level=True)
              .annotate(col=col, rn=Window(RowNumber(), partition_by=[col], order_by=svc.keyset_order(SORTS["position"])))
              .filter(rn__lte=per + 1).order_by("col", "rn"))
        for c in cols.values():
            c["items"] = []
        for t in qs:
            c = cols[t.col]
            if len(c["items"]) < per:
                c["items"].append(t)
            else:
                c["next"] = _cursor("position", c["items"][-1])
    return {"columns": list(cols.values())}


@router.post("/projects/{uuid:project_id}/buckets", response={201: BucketOut})
def create_bucket(request, project_id: uuid.UUID, payload: BucketIn):
    p = _project(request.user, project_id, ProjectMember.Role.WRITE)
    data = payload.dict()
    if data["position"] is None:
        data["position"] = (p.buckets.aggregate(m=Max("position"))["m"] or 0) + 1
    if data["is_done"]:
        p.buckets.update(is_done=False)
    return 201, Bucket.objects.create(project=p, **{**data, "name": _clean(data["name"])})


@router.patch("/buckets/{int:bucket_id}", response=BucketOut)
def update_bucket(request, bucket_id: int, payload: BucketPatch):
    b = get_object_or_404(Bucket, id=bucket_id)
    _project(request.user, b.project_id, ProjectMember.Role.WRITE)
    data = {k: v for k, v in payload.dict(exclude_unset=True).items() if v is not None}
    if data.get("is_done"):
        b.project.buckets.exclude(id=b.id).update(is_done=False)
    for key, value in data.items():
        setattr(b, key, _clean(value) if key == "name" else value)
    b.save()
    return b


@router.delete("/buckets/{int:bucket_id}", response={204: None})
def delete_bucket(request, bucket_id: int):
    b = get_object_or_404(Bucket, id=bucket_id)
    p = _project(request.user, b.project_id, ProjectMember.Role.WRITE)
    others = p.buckets.exclude(id=b.id)
    if not others.exists():
        raise HttpError(400, "A project needs at least one column")
    Todo.objects.filter(bucket=b).update(bucket=others.filter(is_done=False).first() or others.first())
    b.delete()
    return 204, None


# ================================================================ labels

@router.get("/labels", response=list[LabelOut])
def list_labels(request):
    return list(Label.objects.filter(owner=request.user))


@router.post("/labels", response={201: LabelOut})
def create_label(request, payload: LabelIn):
    if Label.objects.filter(owner=request.user, name__iexact=payload.name).exists():
        raise HttpError(400, "You already have a label with that name")
    return 201, Label.objects.create(owner=request.user, name=_clean(payload.name), colour=payload.colour)


@router.patch("/labels/{int:label_id}", response=LabelOut)
def update_label(request, label_id: int, payload: LabelPatch):
    label = get_object_or_404(Label, id=label_id, owner=request.user)
    for key, value in payload.dict(exclude_unset=True).items():
        if value is None:
            continue
        setattr(label, key, _clean(value) if key == "name" else value)
    label.save()
    return label


@router.delete("/labels/{int:label_id}", response={204: None})
def delete_label(request, label_id: int):
    get_object_or_404(Label, id=label_id, owner=request.user).delete()
    return 204, None


# ================================================================ saved views

@router.get("/views", response=list[ViewOut])
def list_views(request):
    return list(SavedView.objects.filter(owner=request.user))


@router.post("/views", response={201: ViewOut})
def create_view(request, payload: ViewIn):
    return 201, SavedView.objects.create(owner=request.user, **{**payload.dict(), "name": _clean(payload.name)})


@router.patch("/views/{uuid:view_id}", response=ViewOut)
def update_view(request, view_id: uuid.UUID, payload: ViewPatch):
    v = get_object_or_404(SavedView, id=view_id, owner=request.user)
    for key, value in payload.dict(exclude_unset=True).items():
        if value is not None:
            setattr(v, key, _clean(value) if key == "name" else value)
    v.save()
    return v


@router.delete("/views/{uuid:view_id}", response={204: None})
def delete_view(request, view_id: uuid.UUID):
    get_object_or_404(SavedView, id=view_id, owner=request.user).delete()
    return 204, None


# ================================================================ tasks

@router.get("/", response=TaskPage, summary="List tasks (filters combine; saved views store these params)")
def list_tasks(request, view: Literal["", "today", "upcoming", "overdue", "nodate", "favorites", "assigned", "done"] = "",
               project: Optional[uuid.UUID] = None, label: str = "", priority_min: Optional[int] = None, q: str = "",
               done: Optional[bool] = None, due_before: Optional[datetime.datetime] = None,
               due_after: Optional[datetime.datetime] = None, parent: Optional[uuid.UUID] = None,
               top_level: bool = False, assignee: str = "", done_after: Optional[datetime.datetime] = None,
               bucket: Optional[int] = None,
               sort: Literal["position", "due", "priority", "created", "updated", "title", "done"] = "position",
               limit: int = 100, offset: int = 0, cursor: str = "", count: bool = True):
    if not cursor:
        svc.ensure_inbox(request.user)  # later pages: done on the first one
    if priority_min is not None:
        priority_min = max(-1, min(priority_min, 100))
    offset = max(0, min(offset, 10 ** 9))
    qs = _filter(_tasks_qs(request.user), request.user, view=view, project=project, label=label,
                 priority_min=priority_min, q=q, done=done, due_before=due_before, due_after=due_after,
                 parent=parent, top_level=top_level, assignee=assignee, done_after=done_after)
    if bucket is not None:
        if not project:
            raise HttpError(400, "bucket needs project")
        qs = qs.filter(_bucket_filter(project, bucket))
    items, nxt = _page(qs, sort, max(1, min(limit, PAGE_MAX)), cursor, offset)
    return {"items": items, "total": qs.count() if count else None, "next": nxt}


def _create(user, data, parsed_labels=()):
    project = _project(user, data["project_id"], ProjectMember.Role.WRITE) if data.get("project_id") \
        else svc.ensure_inbox(user)
    bucket = None
    if data.get("bucket_id"):
        bucket = get_object_or_404(Bucket, id=data["bucket_id"], project=project)
    t = Todo(user=user, project=project, bucket=bucket or project.buckets.filter(is_done=False).first())
    _apply_task(user, t, data)
    if t.completed and not bucket:
        t.bucket = project.buckets.filter(is_done=True).first() or t.bucket
    t.position = data.get("position") if data.get("position") is not None else \
        (Todo.objects.filter(project=project).aggregate(m=Max("position"))["m"] or 0) + 1
    with transaction.atomic():
        t.save()
        _set_m2m(user, t, data)
        if parsed_labels:
            t.labels.add(*parsed_labels)
    if t.assignees.exclude(id=user.id).exists():
        from notifications.service import notify
        for a in t.assignees.exclude(id=user.id):
            notify(a, f"{user.get_full_name() or user.username} assigned you \"{t.name}\"", source="Tasks",
                   url=f"/tasks?task={t.id}")
    return _task(user, t.id)


@router.post("/", response={201: TaskOut})
def create_task(request, payload: TaskIn):
    return 201, _create(request.user, payload.dict())


@router.post("/quick", response={201: TaskOut}, summary="Quick add: 'Pay rent tomorrow 5pm *bills +Home !3 every month'")
def quick_add(request, payload: QuickIn):
    user = request.user
    p = svc.parse_quick_add(payload.text, svc.user_tz(user))
    project_id = payload.project_id
    if p["project"]:
        match = svc.accessible_projects(user).filter(name__iexact=p["project"], archived=False).first()
        project_id = match.id if match else svc.create_project(user, _clean(p["project"])[:128]).id
    data = {"title": p["title"][:256], "project_id": project_id, "parent_id": payload.parent_id, "due": p["due"],
            "bucket_id": payload.bucket_id if not p["project"] else None,
            "priority": p["priority"] or 10, "repeat_mode": p["repeat_mode"], "repeat_every": p["repeat_every"]}
    if p["due"]:
        data["reminders"] = [{"relative_to": "due", "offset": 0, "at": None}]
    return 201, _create(user, data, svc.labels_by_name(user, p["labels"]))


@router.post("/from-event/{event_id}", response={201: TaskOut},
             summary="Make a todo from a calendar event/deadline (or one occurrence: <series id>:<start>)")
def from_event(request, event_id: str, project_id: Optional[uuid.UUID] = None):
    from apikeys.auth import require_also
    from scheduler import service as cal_svc
    require_also(request, "calendar")  # copies an event's title and details
    series, original = cal_svc.resolve(event_id, Event.objects.filter(calendar__users_subscribed__user=request.user))
    e = cal_svc.occurrence_view(series, original) if series is not None and original is not None else series
    if e is None:
        raise HttpError(404, "Event not found")
    if cal_svc.masked_for(e, request.user, cal_svc.role(cal_svc.subscription(request.user, e.calendar_id))):
        raise HttpError(404, "Event not found")  # someone else's private event: subscribers only see "Busy"
    ident = e.ident()
    existing = Todo.objects.filter(user=request.user, custom_info__event_id=ident).first()
    if existing:
        return 201, _task(request.user, existing.id)
    due = e.startdate
    data = {"title": e.name[:256], "description": e.description or "", "project_id": project_id, "due": due,
            "priority": e.priority, "reminders": [{"relative_to": "due", "offset": -86400, "at": None}]}
    t = _create(request.user, data)
    t.custom_info = {**(t.custom_info or {}), "event_id": ident, "calendar": e.calendar.name}
    t.save(update_fields=["custom_info"])
    return 201, _task(request.user, t.id)


# ---------------------------------------------------------------- bulk

BULK_MAX = 5000


def _chunks(ids, n=500):
    for i in range(0, len(ids), n):
        yield ids[i:i + n]


def _editable(user):
    """Tasks you may edit, as a filter (service.can_edit_task for many rows): your own loose tasks, and
    tasks in projects you own or can edit in."""
    projects = Project.objects.filter(Q(owner=user) | Q(id__in=ProjectMember.objects.filter(
        user=user, role__gte=ProjectMember.Role.WRITE).values("project_id"))).values("id")
    return Q(project_id__in=projects) | Q(project__isnull=True, user=user)


def _bulk_done(ids, done, now):
    """Complete or reopen many tasks in a few UPDATEs; repeating tasks go through service.set_done (dates
    move forward, or a recent step is undone), like POST {id}/done."""
    for chunk in _chunks(ids):
        rows = Todo.objects.filter(id__in=chunk)
        stepped = rows.filter(repeat_mode__gt=0).filter(Q(complete_by__isnull=False) | Q(start_on__isnull=False))
        each = stepped.filter(completed=False) if done else rows.filter(repeat_mode__gt=0, completed=False)
        for t in each.select_related("user", "project", "bucket").prefetch_related("reminders"):
            svc.set_done(t, done)
        plain = rows.exclude(id__in=each.values("id")) if each.exists() else rows
        if done:
            plain = list(plain.filter(completed=False).values_list("id", "project_id", "bucket__is_done"))
            Todo.objects.filter(id__in=[i for i, _p, _d in plain]).update(completed=True, completed_on=now, status=100, updated_on=now)
            moves = {}
            for i, pid, in_done in plain:
                if pid and not in_done:
                    moves.setdefault(pid, []).append(i)
            target = dict(Bucket.objects.filter(project_id__in=moves, is_done=True).order_by("-position", "-id").values_list("project_id", "id"))
        else:
            plain = list(plain.filter(completed=True).values_list("id", "project_id", "bucket__is_done"))
            Todo.objects.filter(id__in=[i for i, _p, _d in plain]).update(
                completed=False, completed_on=None, updated_on=now,
                status=Case(When(status=100, then=Value(0)), default=F("status"), output_field=IntegerField()))
            moves = {}
            for i, pid, in_done in plain:
                if pid and in_done:
                    moves.setdefault(pid, []).append(i)
            target = dict(Bucket.objects.filter(project_id__in=moves, is_done=False).order_by("-position", "-id").values_list("project_id", "id"))
            for pid in moves:
                target.setdefault(pid, None)  # no open column: like set_done, the task loses its column
        for pid, tids in moves.items():  # (the dicts keep the first column by position: later rows overwrite)
            if pid in target:
                Todo.objects.filter(id__in=tids).update(bucket_id=target[pid])


def _bulk_update(user, ids, payload, now):
    fields = {k: getattr(payload, k) for k in ("priority", "favorite") if getattr(payload, k) is not None}
    label_ids = [x for x in (payload.add_label, payload.remove_label) if x is not None]
    if label_ids and Label.objects.filter(id__in=label_ids, owner=user).count() != len(set(label_ids)):
        raise HttpError(400, "Unknown label")
    if payload.due is not None or payload.clear_due:
        fields["complete_by"] = payload.due
    tz = svc.user_tz(user)
    through = Todo.labels.through
    for chunk in _chunks(ids):
        Todo.objects.filter(id__in=chunk).update(**fields, updated_on=now)
        if payload.due_day is not None:
            rows = list(Todo.objects.filter(id__in=chunk).only("id", "complete_by"))
            for t in rows:
                local = t.complete_by.astimezone(tz) if t.complete_by else None
                hm = (local.hour, local.minute) if local and (local.hour, local.minute) != (23, 59) else (23, 59)
                t.complete_by = svc._localize(tz, datetime.datetime.combine(payload.due_day, datetime.time(*hm)))
            Todo.objects.bulk_update(rows, ["complete_by"])
        if "complete_by" in fields or payload.due_day is not None:
            for t in Todo.objects.filter(id__in=chunk, reminders__isnull=False).distinct().prefetch_related("reminders"):
                svc.sync_reminders(t)
        if payload.add_label is not None:
            through.objects.bulk_create([through(todo_id=i, label_id=payload.add_label) for i in chunk], ignore_conflicts=True)
        if payload.remove_label is not None:
            through.objects.filter(todo_id__in=chunk, label_id=payload.remove_label).delete()


def _bulk_move(user, ids, project):
    buckets = list(project.buckets.order_by("position", "id").values_list("id", "is_done"))
    open_b = next((b for b, d in buckets if not d), None)
    done_b = next((b for b, d in buckets if d), None)
    allowed = {project.owner_id, *ProjectMember.objects.filter(project=project).values_list("user_id", flat=True)}
    for chunk in _chunks(ids):
        rows = Todo.objects.filter(id__in=chunk).exclude(project=project)
        rows.filter(completed=True).update(project=project, bucket_id=done_b)
        rows.filter(completed=False).update(project=project, bucket_id=open_b)
        # assignees who aren't in the new project would keep seeing it
        Todo.assignees.through.objects.filter(todo_id__in=chunk).exclude(comptechuser_id__in=allowed).delete()


@router.post("/bulk", response=BulkOut,
             summary="Change many tasks at once: the given ids, or every task matching a list filter (up to 5000)")
def bulk(request, payload: BulkIn):
    user = request.user
    if (payload.ids is None) == (payload.filter is None):
        raise HttpError(400, "Give ids or filter")
    base = svc.visible_tasks(user)
    if payload.ids is not None:
        selected = base.filter(id__in=payload.ids)
    else:
        f = payload.filter.dict()
        bucket = f.pop("bucket")
        f["q"] = f["q"][:200]
        selected = _filter(base, user, **f)
        if bucket is not None:
            if not f["project"]:
                raise HttpError(400, "bucket needs project")
            selected = selected.filter(_bucket_filter(f["project"], bucket))
    editable = _editable(user)
    ids = list(dict.fromkeys(selected.filter(editable).order_by().values_list("id", flat=True)[:BULK_MAX + 1]))
    more = len(ids) > BULK_MAX
    ids = ids[:BULK_MAX]
    failed = len(set(payload.ids)) - len(ids) if payload.ids is not None else selected.exclude(editable).count()
    project = None
    if payload.action == "move":
        if not payload.project_id:
            raise HttpError(400, "move needs project_id")
        project = _project(user, payload.project_id, ProjectMember.Role.WRITE)
        if project.archived:
            raise HttpError(400, "That project is archived")
    now = timezone.now()
    with transaction.atomic():
        if payload.action in ("done", "reopen"):
            _bulk_done(ids, payload.action == "done", now)
        elif payload.action == "update":
            _bulk_update(user, ids, payload, now)
        elif payload.action == "move":
            _bulk_move(user, ids, project)
        else:
            for chunk in _chunks(ids):
                Todo.objects.filter(id__in=chunk).delete()  # subtasks go with their parent
    tasks = None
    if payload.ids is not None and payload.action != "delete":
        tasks = list(_tasks_qs(user).filter(id__in=ids))
    return {"count": len(ids), "failed": failed, "more": more, "ids": ids, "tasks": tasks}


@router.get("/{uuid:task_id}", response=TaskDetailOut)
def get_task(request, task_id: uuid.UUID):
    t = _task(request.user, task_id)
    rows = list(t.relations.select_related("other"))
    if rows:
        visible = set(svc.visible_tasks(request.user).filter(id__in=[r.other_id for r in rows]).values_list("id", flat=True))
        for r in rows:
            r.other_visible = r.other_id in visible
    t.relation_rows = rows
    return t


@router.patch("/{uuid:task_id}", response=TaskOut)
def update_task(request, task_id: uuid.UUID, payload: TaskPatch):
    t = _task(request.user, task_id, edit=True)
    nullable = {"description", "due", "start", "repeat_every", "parent_id", "labels", "assignees", "reminders"}
    data = {k: v for k, v in payload.dict(exclude_unset=True).items() if v is not None or k in nullable}
    old_assignees = set(t.assignees.values_list("id", flat=True))
    _apply_task(request.user, t, data)
    with transaction.atomic():
        t.save()
        _set_m2m(request.user, t, data)
        if "due" in data or "start" in data:
            svc.sync_reminders(t)
    if data.get("assignees") is not None:
        from notifications.service import notify
        for a in t.assignees.exclude(id__in=old_assignees | {request.user.id}):
            notify(a, f"{request.user.get_full_name() or request.user.username} assigned you \"{t.name}\"",
                   source="Tasks", url=f"/tasks?task={t.id}")
    return _task(request.user, t.id)


@router.post("/{uuid:task_id}/done", response=DoneOut, summary="Complete (done=true) or reopen; repeating tasks move forward")
def set_done(request, task_id: uuid.UUID, done: bool = True):
    t = _task(request.user, task_id, edit=True)
    repeated = svc.set_done(t, done)
    return {"task": _task(request.user, t.id), "repeated": repeated}


@router.post("/{uuid:task_id}/move", response=TaskOut, summary="Move to another project/column/position")
def move_task(request, task_id: uuid.UUID, payload: MoveIn):
    t = _task(request.user, task_id, edit=True)
    project = _project(request.user, payload.project_id, ProjectMember.Role.WRITE) if payload.project_id else None
    bucket = get_object_or_404(Bucket, id=payload.bucket_id) if payload.bucket_id else None
    if bucket and bucket.project_id != (project.id if project else t.project_id):
        raise HttpError(400, "That column is in another project")
    if bucket and bucket.limit and not bucket.is_done and bucket.id != t.bucket_id and \
            Todo.objects.filter(bucket=bucket, completed=False, parent__isnull=True).count() >= bucket.limit:
        raise HttpError(400, f"\"{bucket.name}\" is at its limit of {bucket.limit}")
    moved = project is not None and project.id != t.project_id
    dest = project.id if project else t.project_id
    if payload.after and payload.before:
        raise HttpError(400, "Give after or before, not both")
    if t.id in (payload.after, payload.before):
        raise HttpError(400, "A task can't be placed next to itself")
    after, before = _anchor(dest, payload.after), _anchor(dest, payload.before)
    with transaction.atomic():
        svc.move(t, project=project, bucket=bucket, position=payload.position)
        if after or before:
            svc.place(t.project_id, [t], after=after, before=before)
        if moved:  # assignees who aren't in the new project would keep seeing it
            t.assignees.remove(*t.assignees.exclude(id__in=svc.assignable_user_ids(t)))
    return _task(request.user, t.id)


@router.post("/{uuid:task_id}/duplicate", response={201: TaskOut})
def duplicate_task(request, task_id: uuid.UUID):
    src = _task(request.user, task_id, edit=True)
    labels, assignees, reminders = list(src.labels.all()), list(src.assignees.all()), list(src.reminders.all())
    src.pk = None
    src.id = uuid.uuid4()
    src.name = f"{src.name} (copy)"[:256]
    src.completed, src.completed_on = False, None
    src.custom_info = {k: v for k, v in (src.custom_info or {}).items() if k != "event_id"}
    src.created_on = timezone.now()
    src.save()
    src.labels.set(labels)
    src.assignees.set(assignees)
    for r in reminders:
        Reminder.objects.create(todo=src, at=r.at, relative_to=r.relative_to, offset=r.offset, fire_at=r.fire_at)
    return 201, _task(request.user, src.id)


@router.delete("/{uuid:task_id}", response={204: None})
def delete_task(request, task_id: uuid.UUID):
    _task(request.user, task_id, edit=True).delete()
    return 204, None


@router.post("/{uuid:task_id}/unassign", response={204: None}, summary="Take yourself off a task's assignees")
def unassign_me(request, task_id: uuid.UUID):
    t = _task(request.user, task_id)
    t.assignees.remove(request.user)
    return 204, None


# ---------------------------------------------------------------- comments

@router.get("/{uuid:task_id}/comments", response=list[CommentOut])
def list_comments(request, task_id: uuid.UUID):
    return list(_task(request.user, task_id).comments.select_related("author"))


@router.post("/{uuid:task_id}/comments", response={201: CommentOut}, summary="Comment (needs edit rights, or being an assignee)")
def add_comment(request, task_id: uuid.UUID, payload: CommentIn):
    t = _task(request.user, task_id)
    assignees = set(t.assignees.values_list("id", flat=True))
    if request.user.id not in assignees and not svc.can_edit_task(request.user, t):
        raise HttpError(403, "You can only view this task")
    c = Comment.objects.create(todo=t, author=request.user, body=_clean(payload.body))
    people = assignees - {request.user.id}
    if t.user_id != request.user.id and t.user_id not in people and svc.can_view_task(t.user, t):
        people.add(t.user_id)  # the creator, while they can still open it
    if people:
        from notifications.service import notify
        for u in ComptechUser.objects.filter(id__in=people):
            notify(u, f"{request.user.get_full_name() or request.user.username} commented on \"{t.name}\"",
                   c.body[:200], source="Tasks", url=f"/tasks?task={t.id}")
    return 201, c


@router.patch("/comments/{uuid:comment_id}", response=CommentOut)
def edit_comment(request, comment_id: uuid.UUID, payload: CommentIn):
    c = get_object_or_404(Comment, id=comment_id, author=request.user)
    c.body, c.edited_on = _clean(payload.body), timezone.now()
    c.save()
    return c


@router.delete("/comments/{uuid:comment_id}", response={204: None})
def delete_comment(request, comment_id: uuid.UUID):
    get_object_or_404(Comment, id=comment_id, author=request.user).delete()
    return 204, None


# ---------------------------------------------------------------- relations

@router.post("/{uuid:task_id}/relations", response={201: RelationOut})
def add_relation(request, task_id: uuid.UUID, payload: RelationIn):
    t = _task(request.user, task_id, edit=True)
    other = _task(request.user, payload.other_id, edit=True)  # the inverse link is written on it too
    if other.id == t.id:
        raise HttpError(400, "A task can't relate to itself")
    with transaction.atomic():
        r, _ = Relation.objects.get_or_create(todo=t, other=other, kind=payload.kind)
        Relation.objects.get_or_create(todo=other, other=t, kind=Relation.KINDS[payload.kind])
    return 201, r


@router.delete("/{uuid:task_id}/relations/{int:relation_id}", response={204: None})
def delete_relation(request, task_id: uuid.UUID, relation_id: int):
    t = _task(request.user, task_id, edit=True)
    r = get_object_or_404(Relation, id=relation_id, todo=t)
    Relation.objects.filter(todo=r.other, other=t, kind=Relation.KINDS[r.kind]).delete()
    r.delete()
    return 204, None
