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
    path("albums/<slug:album_id>/set-cover/", views.set_album_cover, name='set_album_cover'),
    path("albums/<slug:album_id>/subscribers/", views.manage_subscribers, name='manage_subscribers'),
    path("albums/toggle-visibility/<int:album_id>/", views.toggle_album_visibility, name='toggle_album_visibility'),
    path("albums/display-only/<int:album_id>/", views.display_only_album, name='display_only_album'),
    path("stats/", views.stats_page, name='photos_stats'),
    path("storage/", views.storage_page, name='photos_storage'),
    path("search/", views.search_page, name='search_page'),
    path("search/<str:category>/", views.search_category, name='search_category'),
]
