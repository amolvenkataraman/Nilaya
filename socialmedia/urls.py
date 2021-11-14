from django.urls import include, path
from . import views

# URL patterns for main app
urlpatterns = [
    path("", views.home, name='sm_home'),
]