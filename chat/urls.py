from django.urls import include, path
from . import views

# URL patterns for calendar app
urlpatterns = [
    path("", views.chat, name='chat'),
    path("<int:dm_id>/", views.chat),
]