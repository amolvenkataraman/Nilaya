from django.urls import include, path
from . import views

# URL patterns for calendar app
urlpatterns = [
    path("", views.index, name='display_calendar'),
    path("countdown/<slug:event_id>/<slug:time>/", views.countdown, name='countdown_to_event'),

    path("events/", views.get_events, name='get_events'),
    path("todos/", views.get_todos, name='get_todos'), 
    path("sync/", views.sync_events, name='sync_events'),
    path("calendar/", views.calendar, name='calendar'),
    path("visibility/", views.toggle_visibility, name='toggle_visibility'),
    path("create/", views.create_edit_event, name='create_edit_event'),
    path("delete/", views.delete_event, name='delete_event'),
    path("todo/<slug:command>/", views.todo, name='todo'),
    path("subscribe/", views.subscribe, name='subscribe'),
    path("invite/", views.invite, name='invite'),
    path("block/", views.get_block_status, name='get_block_status'),
]
