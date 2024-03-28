from django.urls import include, path
from . import views

# URL patterns for main app
urlpatterns = [
    path("", views.home, name='index'),
    path("apps/", views.apps, name='apps'),

    path("recent_events", views.get_recent_events, name='get_recent_events')
]