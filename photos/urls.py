from django.urls import include, path
from . import views

# URL patterns for photos app
urlpatterns = [
    path("", views.photos, name='photos'),
    path("map/", views.map, name='photos_map'),
    path("day/<int:year>/<int:month>/<int:day>/", views.day, name='day_photos'),
    path("event/<slug:event_id>/", views.event, name='event_photos'),
    path("month-stats/<int:year>/<int:month>/", views.month_stats, name='month_stats'),
    path("date/", views.get_photos_for_date, name='get_photos_for_date'),
    path("photo/<slug:photo_id>/<slug:ret_type>/", views.get_photo, name='get_photo'),
]
