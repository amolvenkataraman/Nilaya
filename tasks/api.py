"""/api/v2/tasks/: projects, kanban buckets, labels, tasks, comments, relations, reminders, saved views."""

import datetime
import uuid
from typing import Literal, Optional

import bleach
import pytz
from django.db import transaction
from django.db.models import Count, Max, Prefetch, Q
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
    limit: int = Field(0, ge=0)
    is_done: bool = False


class BucketPatch(Schema):
    name: Optional[str] = Field(None, min_length=1, max_length=64)
    position: Optional[float] = None
    limit: Optional[int] = Field(None, ge=0)
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
    offset: int = 0  # seconds; negative = before


class RelationOut(Schema):
    id: int
    kind: str
    other_id: uuid.UUID
    other_name: str
    other_done: bool

    @staticmethod
    def resolve_other_name(obj):
        return obj.other.name

    @staticmethod
    def resolve_other_done(obj):
        return obj.other.completed


class TaskOut(Schema):
    id: uuid.UUID
    title: str
    description: str
    done: bool
    done_at: Optional[datetime.datetime]
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
    def resolve_event_id(o): return (o.custom_info or {}).get("event_id")
    @staticmethod
    def resolve_owner(o): return o.user


class TaskDetailOut(TaskOut):
    relations: list[RelationOut]

    @staticmethod
    def resolve_relations(o):
        return list(o.relations.select_related("other"))


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
    repeat_every: Optional[int] = Field(None, ge=60)
    favorite: bool = False
    colour: str = Field("", pattern=HEX)
    reminders: list[ReminderIn] = []
    position: Optional[float] = None
    percent: int = Field(0, ge=0, le=100)
    time_spent: int = Field(0, ge=0)


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
    time_spent: Optional[int] = Field(None, ge=0)
    repeat_mode: Optional[int] = Field(None, ge=0, le=3)
    repeat_every: Optional[int] = Field(None, ge=60)
    favorite: Optional[bool] = None
    colour: Optional[str] = Field(None, pattern=HEX)
    reminders: Optional[list[ReminderIn]] = None  # replaces the list


class MoveIn(Schema):
    project_id: Optional[uuid.UUID] = None
    bucket_id: Optional[int] = None
    position: Optional[float] = None


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
    inbox_id: uuid.UUID


class TaskPage(Schema):
    items: list[TaskOut]
    total: int


# ================================================================ helpers

def _tasks_qs(user):
    return (svc.visible_tasks(user)
            .select_related("user")
            .prefetch_related("labels", "assignees", "reminders")
            .annotate(n_sub=Count("todo", distinct=True),
                      n_sub_done=Count("todo", filter=Q(todo__completed=True), distinct=True),
                      n_comments=Count("comments", distinct=True)))


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
            "open_count": counts.get(p.id, 0)}


def _users(usernames):
    users = list(ComptechUser.objects.filter(username__in=usernames))
    if len(users) != len(set(usernames)):
        raise HttpError(400, "Unknown user in assignees")
    return users


def _apply_task(user, t, data):
    simple = {"title": "name", "due": "complete_by", "start": "start_on", "priority": "priority",
              "percent": "percent_complete", "time_spent": "time_spent", "repeat_mode": "repeat_mode",
              "repeat_every": "repeat_every", "favorite": "favorite", "colour": "colour"}
    for key, field in simple.items():
        if key in data:
            setattr(t, field, _clean(data[key]) if key == "title" else data[key])
    if "description" in data:
        t.description = _clean(data["description"])  # plain text; the UIs render it as text
    if "parent_id" in data:
        if data["parent_id"] is None:
            t.parent = None
        else:
            parent = _task(user, data["parent_id"])
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
        labels = list(Label.objects.filter(id__in=data["labels"], owner=user))
        t.labels.set(labels)
    if data.get("assignees") is not None:
        t.assignees.set(_users(data["assignees"]))
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
    tz = pytz.timezone(user.timezone) if user.timezone in pytz.all_timezones_set else timezone.get_current_timezone()
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


SORTS = {"position": ["position", "created_on"], "due": ["complete_by", "-priority"],
         "priority": ["-priority", "complete_by"], "created": ["-created_on"], "updated": ["-updated_on"],
         "title": ["name"], "done": ["-completed_on"]}


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
    out = {"inbox": open_.filter(project=inbox).count(), "today": count("today"), "overdue": count("overdue"),
           "upcoming": count("upcoming"), "no_date": count("nodate"), "favorites": count("favorites"),
           "assigned": count("assigned"), "done_this_week": base.filter(completed=True, completed_on__gte=week_ago).count(),
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
    counts = dict(Todo.objects.filter(project__in=qs, completed=False).values_list("project").annotate(n=Count("id")))
    return [_project_out(p, request.user, counts) for p in qs.order_by("-is_inbox", "position", "name")]


@router.post("/projects", response={201: ProjectOut})
def create_project(request, payload: ProjectIn):
    data = payload.dict()
    if data["parent_id"]:
        _project(request.user, data["parent_id"], ProjectMember.Role.ADMIN)
    data["name"], data["description"] = _clean(data["name"]), _clean(data["description"])
    pos = (Project.objects.filter(owner=request.user).aggregate(m=Max("position"))["m"] or 0) + 1
    p = svc.create_project(request.user, position=pos, **data)
    return 201, _project_out(p, request.user, {})


@router.patch("/projects/{uuid:project_id}", response=ProjectOut)
def update_project(request, project_id: uuid.UUID, payload: ProjectPatch):
    p = _project(request.user, project_id, ProjectMember.Role.ADMIN)
    data = payload.dict(exclude_unset=True)
    if p.is_inbox and ("archived" in data or "parent_id" in data):
        raise HttpError(400, "The Inbox can't be archived or nested")
    if data.get("parent_id"):
        parent = _project(request.user, data["parent_id"], ProjectMember.Role.ADMIN)
        node = parent
        while node:
            if node.id == p.id:
                raise HttpError(400, "A project can't be inside itself")
            node = node.parent
    for key, value in data.items():
        setattr(p, key, _clean(value) if key in ("name", "description") else value)
    p.save()
    return _project_out(p, request.user, {})


@router.delete("/projects/{uuid:project_id}", response={204: None})
def delete_project(request, project_id: uuid.UUID):
    p = _project(request.user, project_id, ProjectMember.Role.ADMIN)
    if p.is_inbox or p.owner_id != request.user.id:
        raise HttpError(400, "Only the owner can delete a project, and never the Inbox")
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
           source="Tasks", url=f"/tasks/?project={p.id}")
    return 201, m


@router.delete("/projects/{uuid:project_id}/members/{int:member_id}", response={204: None})
def remove_member(request, project_id: uuid.UUID, member_id: int):
    p = _project(request.user, project_id)
    m = get_object_or_404(ProjectMember, id=member_id, project=p)
    if m.user_id != request.user.id and svc.project_role(request.user, p) < ProjectMember.Role.ADMIN:
        raise HttpError(403, "Only admins can remove other people")
    m.delete()
    return 204, None


# ================================================================ buckets

@router.get("/projects/{uuid:project_id}/buckets", response=list[BucketOut])
def list_buckets(request, project_id: uuid.UUID):
    return list(_project(request.user, project_id).buckets.all())


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
    data = payload.dict(exclude_unset=True)
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
        setattr(v, key, value)
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
               sort: Literal["position", "due", "priority", "created", "updated", "title", "done"] = "position",
               limit: int = 500, offset: int = 0):
    svc.ensure_inbox(request.user)
    qs = _filter(_tasks_qs(request.user), request.user, view=view, project=project, label=label,
                 priority_min=priority_min, q=q, done=done, due_before=due_before, due_after=due_after,
                 parent=parent, top_level=top_level, assignee=assignee, done_after=done_after)
    total = qs.count()
    order = SORTS[sort]
    if sort == "due":
        from django.db.models import F
        order = [F("complete_by").asc(nulls_last=True), "-priority"]
    limit = max(1, min(limit, 1000))
    return {"items": list(qs.order_by(*order)[offset:offset + limit]), "total": total}


def _create(user, data, parsed_labels=()):
    project = _project(user, data["project_id"], ProjectMember.Role.WRITE) if data.get("project_id") \
        else svc.ensure_inbox(user)
    bucket = None
    if data.get("bucket_id"):
        bucket = get_object_or_404(Bucket, id=data["bucket_id"], project=project)
    t = Todo(user=user, project=project, bucket=bucket or project.buckets.filter(is_done=False).first())
    _apply_task(user, t, data)
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
                   url=f"/tasks/?task={t.id}")
    return _task(user, t.id)


@router.post("/", response={201: TaskOut})
def create_task(request, payload: TaskIn):
    return 201, _create(request.user, payload.dict())


@router.post("/quick", response={201: TaskOut}, summary="Quick add: 'Pay rent tomorrow 5pm *bills +Home !3 every month'")
def quick_add(request, payload: QuickIn):
    user = request.user
    tz = pytz.timezone(user.timezone) if user.timezone in pytz.all_timezones_set else timezone.get_current_timezone()
    p = svc.parse_quick_add(payload.text, tz)
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
    from scheduler import service as cal_svc
    series, original = cal_svc.resolve(event_id, Event.objects.filter(calendar__users_subscribed__user=request.user))
    e = cal_svc.occurrence_view(series, original) if series is not None and original is not None else series
    if e is None:
        raise HttpError(404, "Event not found")
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


@router.get("/{uuid:task_id}", response=TaskDetailOut)
def get_task(request, task_id: uuid.UUID):
    return _task(request.user, task_id)


@router.patch("/{uuid:task_id}", response=TaskOut)
def update_task(request, task_id: uuid.UUID, payload: TaskPatch):
    t = _task(request.user, task_id, edit=True)
    data = payload.dict(exclude_unset=True)
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
                   source="Tasks", url=f"/tasks/?task={t.id}")
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
    svc.move(t, project=project, bucket=bucket, position=payload.position)
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


# ---------------------------------------------------------------- comments

@router.get("/{uuid:task_id}/comments", response=list[CommentOut])
def list_comments(request, task_id: uuid.UUID):
    return list(_task(request.user, task_id).comments.select_related("author"))


@router.post("/{uuid:task_id}/comments", response={201: CommentOut})
def add_comment(request, task_id: uuid.UUID, payload: CommentIn):
    t = _task(request.user, task_id)
    c = Comment.objects.create(todo=t, author=request.user, body=_clean(payload.body))
    people = {t.user_id, *t.assignees.values_list("id", flat=True)} - {request.user.id}
    if people:
        from notifications.service import notify
        for u in ComptechUser.objects.filter(id__in=people):
            notify(u, f"{request.user.get_full_name() or request.user.username} commented on \"{t.name}\"",
                   c.body[:200], source="Tasks", url=f"/tasks/?task={t.id}")
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
    other = _task(request.user, payload.other_id)
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
