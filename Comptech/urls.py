"""Comptech URL Configuration

The `urlpatterns` list routes URLs to views. For more information please see:
    https://docs.djangoproject.com/en/3.1/topics/http/urls/
Examples:
Function views
    1. Add an import:  from my_app import views
    2. Add a URL to urlpatterns:  path('', views.home, name='home')
Class-based views
    1. Add an import:  from other_app.views import Home
    2. Add a URL to urlpatterns:  path('', Home.as_view(), name='home')
Including another URLconf
    1. Import the include() function: from django.urls import include, path
    2. Add a URL to urlpatterns:  path('blog/', include('blog.urls'))
"""
from django.contrib import admin
from django.urls import include, path, re_path
from django.conf.urls.static import static
from django.conf import settings

admin.site.site_header = admin.site.site_title = "AVNet Superapp admin"
admin.site.index_title = "Administration"

from Comptech.api_v2 import api as api_v2

urlpatterns = [
    path("", include("mainsite.urls")),
    path("accounts/", include("users.urls")),

    path("calendar/", include("scheduler.urls")),
    path("photos/", include("photos.urls")),
    path("map/", include("map.urls")),
    # path("social/", include("socialmedia.urls")),

    path("notifications/", include("notifications.urls")),
    path("api/v2/", api_v2.urls),

    path('admin/', admin.site.urls),
]

if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL,document_root=settings.MEDIA_ROOT)

if getattr(settings, 'SERVE_FILES_WITH_DJANGO', False):  # local testing only (no nginx)
    from Comptech import localfiles
    urlpatterns += [
        path("private/<str:signature>/<path:path>", localfiles.private),
        path("photo_cdn/<str:signature>/<path:path>", localfiles.photo_cdn),
    ]
