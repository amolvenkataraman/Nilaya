from django.urls import include, path
from . import views

# URL patterns for calendar app
urlpatterns = [
    path("", views.index, name='display_calendar'),
    path("countdown/<slug:event_id>/<slug:time>/", views.countdown, name='countdown_to_event'),

    path("events/", views.get_events, name='get_events'),
    #path("events_gc/", views.get_events_from_google_calendar, name='get_events_gc'),
    path("calendar/", views.calendar, name='calendar'),
    path("add/", views.add, name='add_event'),
    path("delete/", views.delete, name='delete_event'),
    path("enroll/", views.enroll, name='enroll'),
    path("invite/", views.invite, name='invite'),
]
