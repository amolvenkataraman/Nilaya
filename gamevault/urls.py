from django.urls import include, path
from . import views

# URL patterns for calendar app
urlpatterns = [
    path("", views.gamevault, name='gamevault'),
    path("scrabble/", views.scrabble, name='scrabble'),
    path("<slug:game_code>/", views.game),
]