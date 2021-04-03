from django.urls import include, path
from . import views

# URL patterns for calendar app
urlpatterns = [
    path("", views.index, name='calendar'),

    path("events/", views.get_events, name='get_events'),
    path("create_calendar/", views.create_calendar, name='create_calendar'),
    path("add/", views.add, name='add'),
    path("enroll/", views.enroll, name='enroll'),
    path("invite/", views.invite, name='invite'),
]
