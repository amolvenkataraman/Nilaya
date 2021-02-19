from django.urls import include, path
from . import views

# URL patterns for users app

urlpatterns = [
    path("login/", views.login_view, name='login'),
    path("register/", views.register_view, name='register'),
    path("logout/", views.logout_view, name='logout'),
]
