from django.urls import include, path
from . import views

# URL patterns for calendar app
urlpatterns = [
    path("flappyblock/", views.flappyblock, name='flappyblock'),
]