from django.urls import include, path
from . import views

# URL patterns for calendar app
urlpatterns = [
    path("", views.index, name='calendar'),

    path("api/events", views.get_events, name='get_events'),
    path("class/", views.class_, name='class_'),
    path("add/", views.add, name='add'),
    path("enroll/", views.enroll, name='enroll'),
    path("invite/", views.invite, name='invite'),
]
