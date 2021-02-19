from django.urls import include, path
from . import views

# URL patterns for bg_images app

urlpatterns = [
    path("bg_image/", views.image, name='bg_image'),
]
