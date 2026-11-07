"""/api/v2/tasks/: projects, kanban buckets, labels, tasks, comments, relations, reminders, saved views."""

from ninja import Router

from . import api_projects, api_tasks

# Routes: api_projects (overview, projects, buckets, labels, saved views) and api_tasks (tasks, bulk,
# comments, relations); schemas in schemas.py, shared helpers in api_helpers.py.
router = Router(tags=["tasks"])
router.add_router("", api_projects.router)
router.add_router("", api_tasks.router)
