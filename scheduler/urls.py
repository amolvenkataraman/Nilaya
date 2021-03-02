from django.urls import include, path
from . import views

# URL patterns for calendar app
urlpatterns = [
    path("", views.index, name='calendar'),

    path("api/events", views.get_events, name='get_events'),
    path("data/", views.get_data, name='data'),
    path("class/", views.class_, name='class_'),
    path("add/", views.add, name='add'),
    path("edit/", views.edit, name='edit'),
    path("delete/", views.delete, name='delete'),
    path("enroll/", views.enroll, name='enroll'),
    path("invite/", views.invite, name='invite'),
    path("settings/", views.settings, name='settings'),
    path("stats/", views.stats, name='stats'),
    path("add_from_gc/", views.add_from_gc, name='add_from_gc'),
]
