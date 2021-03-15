from django.urls import include, path
from . import views

# URL patterns for users app

urlpatterns = [
    path("login/", views.login_view, name='login'),
    path("register/", views.register_view, name='register'),
    path("profile/", views.profile_view, name='profile'),
    path("profile_picture/", views.profile_picture, name='profile_picture'),
    path("darkmode/", views.toggle_dark_mode, name='dark_mode'),
    path("logout/", views.logout_view, name='logout'),
]
