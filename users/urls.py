from django.urls import include, path
from django.contrib.auth import views as auth_views
from . import views

# URL patterns for users app

urlpatterns = [
    path("login/", views.login_view, name='login'),
    path("register/", views.register_view, name='register'),
    path("profile/", views.profile_view, name='profile'),
    path("profile/<slug:user>/", views.profile_view, name='profile'),
    path("profile_picture/", views.profile_picture, name='profile_picture'),
    path("get_user_info/", views.get_user_info, name='get_user_info'),
    path("change_password/", views.password_change_view, name='change_password'),
    path("darkmode/", views.toggle_dark_mode, name='dark_mode'),
    path("friend_request/", views.friend_request, name='friend_request'),
    path("logout/", views.logout_view, name='logout'),
]
