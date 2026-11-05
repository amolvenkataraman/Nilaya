from django.urls import re_path

from . import views

urlpatterns = [re_path(r"^(?P<token>f_[0-9a-f]{8}_[A-Za-z0-9_-]+)\.ics$", views.feed, name="feed")]
