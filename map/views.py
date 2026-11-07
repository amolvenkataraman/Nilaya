from decimal import Decimal
from django.conf import settings
from django.core.exceptions import ValidationError
from django.middleware.csrf import get_token
from django.shortcuts import render
from django.http import JsonResponse
from django.contrib.auth.decorators import login_required
from django.db.models import Q
from .models import Location, LocationGroup
from Comptech.utils import error_response, success_response, login_required_api, server_error
import json
import urllib.request
import urllib.parse

@login_required
def index(request):
    """Main map view showing all locations and groups (data for the script goes through json_script)."""
    config = {
        "csrf": get_token(request),
        "online": bool(getattr(settings, "ONLINE_MODE", True)),
        "categories": [{"key": k, "label": v} for k, v in Location.CATEGORY_CHOICES],
        "statuses": [{"key": k, "label": v} for k, v in Location.STATUS_CHOICES],
    }
    return render(request, 'map/index.html', {"map_config": config})


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
def add_group(request):
    """API endpoint to create a new location group."""
    if request.method != 'POST':
        return error_response("Method not allowed", 405)

    try:
        data = json.loads(request.body)
        
        # Create new group
        group = LocationGroup.objects.create(
            name=data.get('name'),
            description=data.get('description', ''),
            owner=request.user,
            is_public=data.get('is_public', False)
        )
        
        return JsonResponse({
            'status': 'success',
            'message': 'Group created successfully',
            'group': {
                'id': group.id,
                'name': group.name,
                'description': group.description,
                'is_public': group.is_public
            }
        })

    except Exception as e:
        return server_error(e)


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
            'group_id': loc.group_id,  # pre-selects the group in the edit form
        } for loc in locations], safe=False)
        
    except LocationGroup.DoesNotExist:
        return error_response("Group not found", 404)


def _location_fields(data, user):
    """Validated model fields from a location payload: only the keys that were sent,
    so an edit never wipes fields the form doesn't include (notes, altitude, ...)."""
    fields = {}
    for key in ("name", "description", "latitude", "longitude", "altitude", "category", "address", "notes"):
        if key in data:
            value = data[key]
            if key in ("latitude", "longitude", "altitude"):
                # the UI round-trips floats (43.472300000000004); store 6 decimals like the column
                value = None if value in ("", None) else Decimal(str(value)).quantize(Decimal("0.000001"))
            fields[key] = value
    if "rating" in data:  # the form sends strings ("4"); empty = no rating
        rating = int(data["rating"]) if str(data["rating"]).strip() else None
        if rating is not None and not 1 <= rating <= 5:
            raise ValidationError({"rating": "Rating must be 1-5"})
        fields["rating"] = rating
    group_id = data.get("group_id", data.get("group"))
    if group_id not in (None, ""):
        fields["group"] = LocationGroup.objects.get(id=int(group_id), owner=user)  # own groups only
    return fields


def _save_location(location, fields):
    for key, value in fields.items():
        setattr(location, key, value)
    location.full_clean()  # lat/lng ranges, category choices, required name
    location.save()


@login_required_api
def add_location(request):
    """API endpoint to add a new location."""
    if request.method != 'POST':
        return error_response("Method not allowed", 405)
    try:
        fields = _location_fields(json.loads(request.body), request.user)
        if "group" not in fields:
            return error_response("Group is required")
        _save_location(Location(category="other"), fields)
        return success_response("Location added successfully")
    except LocationGroup.DoesNotExist:
        return error_response("Group not found", 404)
    except ValidationError as e:
        return error_response("; ".join(f"{k}: {', '.join(v)}" for k, v in e.message_dict.items()))
    except (ValueError, TypeError):
        return error_response("Invalid location data")


@login_required_api
def edit_location(request, location_id):
    """API endpoint to edit a location (only the fields that are sent change)."""
    if request.method != 'POST':
        return error_response("Method not allowed", 405)
    try:
        location = Location.objects.select_related('group').get(id=location_id)
        if location.group.owner != request.user:
            return error_response("Not authorized", 401)
        _save_location(location, _location_fields(json.loads(request.body), request.user))
        return success_response("Location updated successfully")
    except (Location.DoesNotExist, LocationGroup.DoesNotExist):
        return error_response("Location or group not found", 404)
    except ValidationError as e:
        return error_response("; ".join(f"{k}: {', '.join(v)}" for k, v in e.message_dict.items()))
    except (ValueError, TypeError):
        return error_response("Invalid location data")


@login_required_api
def nominatim_search(request):
    """Server-side proxy for Nominatim geocoding to include proper User-Agent."""
    query = request.GET.get('q', '').strip()[:200]
    if not query:
        return error_response("Query parameter 'q' is required", 400)
    if not getattr(settings, "ONLINE_MODE", True):  # same switch as scheduler/notifications
        return error_response("Place search is off on this server (offline mode)", 503)

    params = urllib.parse.urlencode({'format': 'json', 'q': query})
    url = f'https://nominatim.openstreetmap.org/search?{params}'

    req = urllib.request.Request(url, headers={
        # Nominatim's policy: an identifying User-Agent and Referer (this site's own address).
        'User-Agent': f'AVNet-Superapp/1.0 (+{settings.SITE_URL})',
        'Referer': settings.SITE_URL,
    })

    try:
        with urllib.request.urlopen(req, timeout=10) as response:
            data = json.loads(response.read().decode('utf-8'))
        return JsonResponse(data, safe=False)
    except Exception:
        return error_response("Place search is unavailable right now", 502)


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
