from django.urls import include, path
from . import views

# URL patterns for photos app
urlpatterns = [
    path("", views.photos, name='photos'),
    path("date/", views.get_photos_for_date, name='get_photos_for_date'),
    path("get/", views.get_photo, name='get_photo'),
    path("upload/", views.upload_photo, name='upload_photo'),
]
