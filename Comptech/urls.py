"""Comptech URL configuration.

Everything a person opens in the browser is the React app (Comptech/spa.py): the catch-all at the
end serves it for every path outside the reserved prefixes below, and redirects old URLs. The
server itself only answers the V2 API, Django admin, ICS feeds and (locally) files.
"""
import re

from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.urls import include, path, re_path

from Comptech import spa
from Comptech.api_v2 import api as api_v2

admin.site.site_header = admin.site.site_title = "AVNet Superapp admin"
admin.site.index_title = "Administration"
admin.site.site_url = "/"

urlpatterns = [
    path("api/v2/", api_v2.urls),
    path("admin/", admin.site.urls),
    path("feeds/", include("feeds.urls")),
    path("favicon.ico", spa.favicon),
]

if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)

if getattr(settings, "SERVE_FILES_WITH_DJANGO", False):  # local testing only (no nginx)
    from Comptech import localfiles
    urlpatterns += [
        path("private/<str:signature>/<path:path>", localfiles.private),
        path("photo_cdn/<str:signature>/<path:path>", localfiles.photo_cdn),
    ]

# The app (and old-URL redirects) for every other path; unknown paths under a reserved prefix 404.
urlpatterns += [
    re_path(r"^(?!(?:%s)(?:/|$)).*$" % "|".join(map(re.escape, spa.RESERVED)), spa.index, name="spa"),
]
