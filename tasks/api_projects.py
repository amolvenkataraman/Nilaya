"""/api/v2/tasks/: overview, projects, members, buckets and the board, labels, saved views."""

import datetime
import uuid

from django.db import transaction
from django.db.models import Case, Count, F, IntegerField, Max, Q, Value, When, Window
from django.db.models.functions import RowNumber
from django.shortcuts import get_object_or_404
from django.utils import timezone
from ninja import Field, Router, Schema
from ninja.errors import HttpError

from scheduler.models import Todo
from users.models import ComptechUser

from . import service as svc
from .api_helpers import (
    SORTS,
    _anchor,
    _cursor,
    _filter,
    _project,
    _project_out,
    _tasks_qs,
)
from .models import Bucket, Label, Project, ProjectMember, SavedView
from .schemas import (
    BoardOut,
    BucketIn,
    BucketOut,
    BucketPatch,
    LabelIn,
    LabelOut,
    LabelPatch,
    MemberIn,
    MemberOut,
    OverviewOut,
    PlaceIn,
    PlaceOut,
    ProjectIn,
    ProjectOut,
    ProjectPatch,
    ViewIn,
    ViewOut,
    ViewPatch,
    _clean,
)

router = Router()  # tags come from tasks.api.router


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
