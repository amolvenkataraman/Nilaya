from django.urls import include, path
from . import views

# URL patterns for photos app
urlpatterns = [
    path("", views.photos, name='photos'),
    path("albums/", views.my_albums_page, name='my_albums_page'),
    path("map/", views.map, name='photos_map'),
    path("map_new/", views.map_new, name='photos_map_new'),
    path("geoguessr/", views.geoguessr, name='geoguessr'),
    path("geoguessr_ent/", views.geoguessr_ent, name='geoguessr_ent'),
    path("day/<int:year>/<int:month>/<int:day>/", views.day, name='day_photos'),
    path("event/<slug:event_id>/", views.event, name='event_photos'),
    path("view-photo/<slug:photo_id>/", views.view_photo, name="view_photo"),
    path("date/", views.get_photos_for_date, name='get_photos_for_date'),
    path("photo/<slug:photo_id>/<slug:ret_type>/", views.get_photo, name='get_photo'),
    path("ingest/", views.ingest_photos, name='ingest_photos'),
    path("delete/<slug:photo_id>/", views.del_photo_req, name='del_photo_req'),
    path("albums/json-list/", views.list_my_albums, name='list_my_albums'),
    path("albums/add/", views.add_photo_to_album, name='add_photo_to_album'),
    path("albums/remove/", views.remove_photo_from_album, name='remove_photo_from_album'),
    path("albums/create/", views.create_share_album, name='create_share_album'),
    path("albums/<slug:album_id>/edit/", views.edit_share_album, name='edit_share_album'),
    path("albums/<slug:album_id>/subscribers/", views.manage_subscribers, name='manage_subscribers'),
]
