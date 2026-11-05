"""V2 API: typed, documented JSON API for every app, mounted at /api/v2/.

- Auth: the normal login session (cookies); unsafe methods need the CSRF token
  (X-CSRFToken header), like the rest of the site.
- Interactive docs for staff: /api/v2/docs
- Each app adds its router here.
"""

from django.contrib.admin.views.decorators import staff_member_required
from ninja import NinjaAPI
from ninja.security import django_auth

api = NinjaAPI(
    title="AVNet Superapp API",
    version="2.0",
    urls_namespace="api-v2",
    auth=django_auth,
    docs_url="/docs",
    docs_decorator=staff_member_required,
)

api.add_router("/notifications/", "notifications.api.router")
api.add_router("/me", "users.api_v2.router")
api.add_router("/calendar/", "scheduler.api_v2.router")
api.add_router("/photos/", "photos.api_v2.router")
api.add_router("/places/", "map.api_v2.router")
api.add_router("/tasks/", "tasks.api.router")
