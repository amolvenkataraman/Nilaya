from django.urls import path
from . import views

urlpatterns = [
    # Main view
    path('', views.index, name='map'),
    
    # API endpoints
    path('location-groups/', views.location_groups, name='location_groups'),
    path('locations/', views.locations, name='locations'),
    path('locations/add/', views.add_location, name='add_location'),
    path('locations/<slug:location_id>/edit/', views.edit_location, name='edit_location'),
    path('locations/<slug:location_id>/delete/', views.delete_location, name='delete_location'),
]
