from django.shortcuts import render
from django.http import JsonResponse
from django.contrib.auth.decorators import login_required
from django.db.models import Q
from .models import Location, LocationGroup
from Comptech.utils import error_response, success_response, login_required_api
import json

@login_required
def index(request):
    """Main map view showing all locations and groups."""
    return render(request, 'map/index.html')


@login_required_api
def location_groups(request):
    """API endpoint to get all location groups accessible to the user."""
    # Get groups owned by user or public groups
    groups = LocationGroup.objects.filter(
        Q(owner=request.user) |  # User's own groups
        Q(is_public=True)        # Public groups
    ).distinct()
    
    return JsonResponse([{
        'id': group.id,
        'name': group.name,
        'description': group.description,
        'is_public': group.is_public,
    } for group in groups], safe=False)


@login_required_api
def locations(request):
    """API endpoint to get locations for a specific group."""
    group_id = request.GET.get('group')
    if not group_id:
        return error_response("Group ID is required", 400)
    
    try:
        group = LocationGroup.objects.get(id=group_id)
        
        # Check if user has access to this group
        if not (group.owner == request.user or 
                group.is_public):
            return error_response("Not authorized", 401)
        
        locations = Location.objects.filter(group=group).order_by('category', 'name')
        
        return JsonResponse([{
            'id': loc.id,
            'name': loc.name,
            'description': loc.description,
            'latitude': float(loc.latitude),
            'longitude': float(loc.longitude),
            'altitude': float(loc.altitude) if loc.altitude else None,
            'category': loc.category,
            'address': loc.address,
            'rating': loc.rating,
            'notes': loc.notes,
        } for loc in locations], safe=False)
        
    except LocationGroup.DoesNotExist:
        return error_response("Group not found", 404)


@login_required_api
def add_location(request):
    """API endpoint to add a new location."""
    if request.method != 'POST':
        return error_response("Method not allowed", 405)

    try:
        data = json.loads(request.body)
        print(data)
        group = LocationGroup.objects.get(id=int(data.get('group_id')))
        
        # Check if user has write access to this group
        if not (group.owner == request.user):
            return error_response("Not authorized", 401)
        
        location = Location.objects.create(
            name=data.get('name'),
            description=data.get('description', ''),
            latitude=data.get('latitude'),
            longitude=data.get('longitude'),
            altitude=data.get('altitude'),
            category=data.get('category', 'other'),
            address=data.get('address', ''),
            group=group,
            rating=data.get('rating') if data.get('rating') in range(1, 6) else None,
            notes=data.get('notes', '')
        )
        
        return success_response("Location added successfully")
        
    except LocationGroup.DoesNotExist:
        return error_response("Group not found", 404)
    except Exception as e:
        return error_response(str(e), 400)


@login_required_api
def edit_location(request, location_id):
    """API endpoint to edit a location."""
    if request.method != 'POST':
        return error_response("Method not allowed", 405)

    print(location_id)
    print(request.body)
    try:
        location = Location.objects.get(id=location_id)
        
        # Check if user has write access to this group
        if not (location.group.owner == request.user):
            return error_response("Not authorized", 401)

        data = json.loads(request.body)

        location.name = data.get('name')
        location.description = data.get('description')
        location.latitude = data.get('latitude')
        location.longitude = data.get('longitude')
        location.altitude = data.get('altitude')
        location.category = data.get('category')
        location.address = data.get('address')

        location.save()

        return success_response("Location updated successfully")
    
    except Location.DoesNotExist:
        return error_response("Location not found", 404)
    except Exception as e:
        return error_response(str(e), 400)


@login_required_api
def delete_location(request, location_id):
    """API endpoint to delete a location."""
    if request.method != 'POST':
        return error_response("Method not allowed", 405)
    
    try:
        location = Location.objects.get(id=location_id)
        
        # Check if user has write access to this group
        if not (location.group.owner == request.user):
            return error_response("Not authorized", 401)
        
        location.delete()
        return success_response("Location deleted successfully")
        
    except Location.DoesNotExist:
        return error_response("Location not found", 404)
