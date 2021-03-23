from django.urls import include, path
from . import views

# URL patterns for calendar app
urlpatterns = [
    path("", views.chat, name='chat'),
    path("get_messages/", views.messages, name='get_messages'),
    path("<int:dm_id>/", views.chat),
]