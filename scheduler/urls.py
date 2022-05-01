from django.urls import include, path
from . import views, api

# URL patterns for calendar app
urlpatterns = [
    path("", views.index, name='display_calendar'),
    path("countdown/<slug:event_id>/<slug:time>/", views.countdown, name='countdown_to_event'),

    path("api/events/", api.get_events, name='get_events'),
    path("api/todos/", api.get_todos, name='get_todos'), 
    path("api/calendar/", api.calendar, name='calendar'),
    path("api/calendarevents/", api.get_calendar_events, name='get_calendar_events'),
    path("api/sync/", api.sync_events, name='sync_events'),
    path("api/visibility/", api.toggle_visibility, name='toggle_visibility'),
    path("api/create/", api.create_edit_event, name='create_edit_event'),
    path("api/duplicate/", api.duplicate_event, name='duplicate_event'),
    path("api/delete/", api.delete_event, name='delete_event'),
    path("api/todo/<slug:command>/", api.todo, name='todo'),
    path("api/subscribe/", api.subscribe, name='subscribe'),
    path("api/unsubscribe/", api.unsubscribe, name='unsubscribe'),
    path("api/invite/", api.invite, name='invite'),
    path("api/block/", api.get_block_status, name='get_block_status'),
]
