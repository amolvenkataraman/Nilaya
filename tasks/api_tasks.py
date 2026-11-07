"""/api/v2/tasks/: listing, creating (incl. quick add and from an event), bulk edits, one task, comments, relations."""

import datetime
import uuid
from typing import Literal, Optional

from django.db import transaction
from django.db.models import Case, F, IntegerField, Max, Q, Value, When
from django.shortcuts import get_object_or_404
from django.utils import timezone
from ninja import Router
from ninja.errors import HttpError

from scheduler.models import Event, Todo
from users.models import ComptechUser

from . import service as svc
from .api_helpers import (
    PAGE_MAX,
    _anchor,
    _apply_task,
    _bucket_filter,
    _filter,
    _page,
    _project,
    _set_m2m,
    _task,
    _tasks_qs,
)
from .models import Bucket, Comment, Label, Project, ProjectMember, Relation, Reminder
from .schemas import (
    BulkIn,
    BulkOut,
    CommentIn,
    CommentOut,
    DoneOut,
    MoveIn,
    QuickIn,
    RelationIn,
    RelationOut,
    TaskDetailOut,
    TaskIn,
    TaskOut,
    TaskPage,
    TaskPatch,
    _clean,
)

router = Router()  # tags come from tasks.api.router


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
