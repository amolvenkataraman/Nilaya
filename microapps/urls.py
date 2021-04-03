from django.urls import include, path

# URL patterns for microapps
urlpatterns = [
    path('birthday/', include("microapps.birthday.urls")),
]