"""Request and response schemas of /api/v2/tasks/, and the limits they validate against."""

import datetime
import uuid
from typing import Literal, Optional

import bleach
from ninja import Field, Schema

from . import service as svc

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
