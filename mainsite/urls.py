from django.urls import include, path
from . import views

# URL patterns for main app
urlpatterns = [
    path("apps/", views.apps, name='index'),   
]