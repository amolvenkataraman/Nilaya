from django.shortcuts import render, redirect
from django.db.models import Q, Count, Sum, Min, Max
from django.db.models.functions import TruncMonth
from django.http import HttpResponse, JsonResponse, FileResponse
from django.contrib.auth.decorators import login_required
from django.utils import timezone
from django.conf import settings
from django.db import connection
from django.core.exceptions import ValidationError
from wsgiref.util import FileWrapper
from .models import *
from .indeximg import photo_ingest_for_album
from .tasks import ingest_all_photos
from notifications.service import notify
from .AI.objects import NAME_TO_ID_MAPPING
from .hidden import can_control, visible, show_hidden
from scheduler.models import *
from django.conf import settings as _settings
BASE_DIR, TIME_ZONE = _settings.BASE_DIR, _settings.TIME_ZONE

from PIL import Image, ExifTags, ImageOps
from Comptech.utils import *
import datetime
import dateparser
import pytz
import json
import base64
from collections import Counter
from django.db import transaction
from . import cache as photo_cache
from .models import Album, BROKEN_GPS

def get_bounds_from_request(request):
    bounds_b64 = request.GET.get('bounds')
    if bounds_b64:
        try:
            missing_padding = len(bounds_b64) % 4
            if missing_padding:
                bounds_b64 += '=' * (4 - missing_padding)
            decoded = base64.b64decode(bounds_b64.encode('utf-8')).decode('utf-8')
            parts = decoded.split(',')
            if len(parts) == 4:
                return {
                    "north": parts[0].strip(),
                    "south": parts[1].strip(),
                    "east": parts[2].strip(),
                    "west": parts[3].strip()
                }, bounds_b64
        except Exception:
            pass

    # Fallback to separate params
    north = request.GET.get('north')
    south = request.GET.get('south')
    east = request.GET.get('east')
    west = request.GET.get('west')
    if north and south and east and west:
        try:
            n_val = f"{float(north):.5f}"
            s_val = f"{float(south):.5f}"
            e_val = f"{float(east):.5f}"
            w_val = f"{float(west):.5f}"
            csv_str = f"{n_val},{s_val},{e_val},{w_val}"
            computed_b64 = base64.b64encode(csv_str.encode('utf-8')).decode('utf-8')
        except Exception:
            computed_b64 = None
        return {
            "north": north,
            "south": south,
            "east": east,
            "west": west
        }, computed_b64

    return None, None




def _get_base_photo_pool(request):
    """Resolve auth and return the base accessible Photo queryset.

    Returns (qs, album_obj, is_owner, err) where err is a non-None HttpResponse
    if auth failed (caller must return it).  qs is None when no album param is
    given and the user isn't authenticated (caller decides whether to redirect
    or return an API error).
    """
    album_obj = None
    is_owner = False

    if request.GET.get('album'):
        try:
            album_qs = ShareAlbum.objects.filter(id=request.GET.get('album'))
            missing = not album_qs.exists()
        except ValidationError:  # not a UUID
            missing = True
        if missing:
            return None, None, False, error_response("Album does not exist", 404)
        album_obj = album_qs[0]
        is_owner = request.user.is_authenticated and (
            album_obj.owner == request.user or request.user.is_superuser
        )
        can_view = album_obj.public or (
            request.user.is_authenticated and (
                ShareAlbum_Subscriber.objects.filter(album=album_obj, user=request.user).exists()
                or album_obj.owner == request.user
                or request.user.is_superuser
            )
        )
        if not can_view:
            return None, None, False, error_response("Not authorized", 401)
        sp_ids = ShareAlbum_Photo.objects.filter(sharealbum=album_obj).values_list('photo_id', flat=True)
        qs = Photo.objects.filter(id__in=sp_ids)
    else:
        if not request.user.is_authenticated:
            return None, None, False, None  # caller decides redirect vs API error
        album_subs = request.user.album_subscribed.filter(visible=True)
        albums = [s.album for s in album_subs]
        qs = Photo.objects.filter(album__in=albums)

    return visible(qs, request), album_obj, is_owner, None


def _apply_standard_filters(qs, request):
    """Apply all common photo filters from request.GET to the queryset.

    Handles: video, camera_make, camera_model, country, city, objects, bounds, similar.
    Returns (filtered_qs, ctx) where ctx is a flat dict of filter values ready
    to be spread into a template context with **ctx.
    """
    ctx = {}

    # free-text search box: place, camera or a detected object name
    q = (request.GET.get("q") or "").strip()
    if q:
        match = (Q(location_city__icontains=q) | Q(location_country__icontains=q)
                 | Q(camera_make__icontains=q) | Q(camera_model__icontains=q))
        if q.lower() in NAME_TO_ID_MAPPING and connection.vendor == "postgresql":  # JSON contains: Postgres only
            match |= Q(ai_index_info__objects__contains=[NAME_TO_ID_MAPPING[q.lower()]])
        qs = qs.filter(match)
    ctx["q"] = q

    # video
    if request.GET.get("video") == "1":
        qs = qs.filter(video=True)
        ctx["video"] = True
    else:
        ctx["video"] = False

    # camera
    cam_make = request.GET.get("camera_make") or None
    if cam_make:
        qs = qs.filter(camera_make__icontains=cam_make)
    ctx["cam_make"] = cam_make

    cam_model = request.GET.get("camera_model") or None
    if cam_model:
        qs = qs.filter(camera_model=cam_model)
    ctx["cam_model"] = cam_model

    # location
    country = request.GET.get("country") or None
    if country:
        qs = qs.filter(location_country=country)
    ctx["country"] = country

    city = request.GET.get("city") or None
    if city:
        qs = qs.filter(location_city=city)
    ctx["city"] = city

    # AI objects
    raw_objects = request.GET.get("objects")
    if raw_objects:
        raw_list = raw_objects.strip().lower().split(",")
        object_ids = [
            NAME_TO_ID_MAPPING[o.strip()]
            for o in raw_list if o.strip() in NAME_TO_ID_MAPPING
        ]
        if object_ids:
            from .browse import with_objects
            qs = with_objects(qs, object_ids)  # works on SQLite too (no JSON containment lookup there)
        else:
            qs = qs.none()
        ctx["objects"] = ",".join(str(i) for i in object_ids) if object_ids else None
    else:
        ctx["objects"] = None

    # geographic bounds
    bounds, bounds_b64 = get_bounds_from_request(request)
    if bounds:
        qs = qs.filter(
            latitude__gte=bounds['south'], latitude__lte=bounds['north'],
            longitude__gte=bounds['west'], longitude__lte=bounds['east'],
        )
    ctx["bounds"] = bounds
    ctx["bounds_b64"] = bounds_b64


    # Blur / Sharpness filter (12MP normalized)
    min_blur = request.GET.get("min_blur") or None
    max_blur = request.GET.get("max_blur") or None
    if min_blur or max_blur:
        qs = qs.filter(video=False, ai_index_info__blur_score__isnull=False)
        from django.db.models import F, FloatField, Case, When, Value
        from django.db.models.functions import Cast
        from django.db.models.fields.json import KeyTextTransform

        megapixels_expr = Case(
            When(megapixels__gt=0, then=F('megapixels')),
            default=Value(12.0),
            output_field=FloatField()
        )
        raw_blur_expr = Cast(
            KeyTextTransform('blur_score', 'ai_index_info'),
            output_field=FloatField()
        )
        qs = qs.annotate(
            normalized_blur=raw_blur_expr * (12.0 / megapixels_expr)
        )

        if min_blur:
            try:
                qs = qs.filter(normalized_blur__gte=float(min_blur))
            except ValueError:
                pass
        if max_blur:
            try:
                qs = qs.filter(normalized_blur__lte=float(max_blur))
            except ValueError:
                pass

    ctx["min_blur"] = min_blur
    ctx["max_blur"] = max_blur

    return qs, ctx


# ---------------------------------------------------------------------------
# Page views
# ---------------------------------------------------------------------------

# @login_required
def photos(request):
    qs, album_obj, is_owner, err = _get_base_photo_pool(request)
    if err is not None:
        return err
    if qs is None:  # not authenticated, no album param
        return redirect("/accounts/login/?next=" + request.path)

    qs = qs.order_by('-date_taken')
    qs, fctx = _apply_standard_filters(qs, request)

    # Determine start date / date filter for the infinite-scroll JS
    rd = request.GET.get('date')
    if rd is None:
        try:
            newest = qs[0].date_taken.date() + datetime.timedelta(days=1)
        except IndexError:
            newest = None
        date_filter = None
    else:
        newest = dateparser.parse(rd).date()
        date_filter = datetime.datetime.strftime(newest, "%Y-%m-%d")

    ntotal = qs.count()
    cities = cameras = size_kb = 0
    first_date = last_date = None
    if ntotal == 0:
        nphotos = nvideos = fyear = lyear = countries = 0
        no_photos = True
    else:
        nphotos = qs.filter(video=False).count()
        nvideos = ntotal - nphotos
        fyear = qs[0].date_taken.year
        lyear = qs.reverse()[0].date_taken.year
        countries = qs.filter(
            Q(location_country__isnull=False) &
            Q(Q(altitude__isnull=True) | Q(altitude__lt=PLANE_ALTITUDE_M))
        ).values_list('location_country').distinct().count()
        # Library summary strip: distinct places / cameras, storage and the exact date span.
        cities = qs.filter(location_city__isnull=False, location_country__isnull=False) \
            .values_list('location_city', 'location_country').distinct().count()
        cameras = qs.filter(camera_make__isnull=False, camera_model__isnull=False) \
            .values_list('camera_make', 'camera_model').distinct().count()
        agg = qs.aggregate(kb=Sum('size_total'), first=Min('date_taken'), last=Max('date_taken'))
        size_kb = agg['kb'] or 0
        local = lambda dt: timezone.localtime(dt).date() if dt and timezone.is_aware(dt) else (dt.date() if dt else None)  # noqa: E731
        first_date, last_date = local(agg['first']), local(agg['last'])
        no_photos = False

    # Items per month, newest first, for the date scrubber.
    months = [
        [m.strftime("%Y-%m"), n] for m, n in
        qs.annotate(m=TruncMonth('date_taken')).values_list('m').annotate(n=Count('id')).order_by('-m')
        if m is not None
    ]

    return render(request, 'photos/photos.html', {
        'newest':       datetime.datetime.strftime(newest, "%Y-%m-%d") if newest else None,
        'date_filter':  date_filter,
        'forward':      request.GET.get('forward') == '1',
        'left_sidebar': True,
        'right_sidebar': False,
        'months':       months,
        'share_album':  album_obj.id if album_obj else None,
        'album_obj':    album_obj,
        'is_owner':     is_owner,
        'ntotal':       ntotal,
        'nphotos':      nphotos,
        'nvideos':      nvideos,
        'drange':       f"{lyear}-{fyear}" if fyear and lyear else "N/A",
        'countries':    countries,
        'cities':       cities,
        'cameras':      cameras,
        'size_kb':      size_kb,
        'first_date':   first_date,
        'last_date':    last_date,
        'no_photos':    no_photos,
        'active_page':  'photos',
        **fctx,   # video, cam_make, cam_model, country, city, objects, bounds, bounds_b64, similar_*
    })


def _share_album_info(album, request):
    """ShareAlbum.getinfo(), but counts, size, dates and cover only use photos this request may see."""
    info = album.getinfo()
    all_qs = Photo.objects.filter(photo_in_sharealbum__sharealbum=album)
    qs = visible(all_qs, request)
    if qs.count() == all_qs.count():
        return info
    agg = qs.aggregate(kb=Sum('size_total'), oldest=Min('date_taken'), newest=Max('date_taken'))
    cover = album.cover_photo if album.cover_photo and qs.filter(id=album.cover_photo_id).exists() else qs.order_by('-date_taken').first()
    kb = agg['kb'] or 0
    mb = kb / 1024.0
    info.update({
        "photo_count": qs.filter(video=False).count(),
        "video_count": qs.filter(video=True).count(),
        "space_used_kb": kb,
        "space_used": f"{mb / 1048576:.2f} TB" if mb >= 1048576 else f"{mb / 1024:.2f} GB" if mb >= 1024 else f"{mb:.1f} MB",
        "cover_photo_id": str(cover.id) if cover else None,
        "cover_photo_hash": cover.thumbnail_hash if cover else None,
        "oldest_date": agg['oldest'].isoformat() if agg['oldest'] else "",
        "newest_date": agg['newest'].isoformat() if agg['newest'] else "",
    })
    return info


@login_required
def my_albums_page(request):
    ses = ShareAlbum_Subscriber.objects.filter(user=request.user)
    sa = [_share_album_info(s.album, request) for s in ses]

    return render(request, 'photos/albums.html', {
        "albums": sa,
        "left_sidebar": True,
        "right_sidebar": False,
        "active_page": "albums"
    })

@login_required
def map(request):
    year = request.GET.get('year')
    year1 = request.GET.get('year-')
    date = request.GET.get('date')
    alt = request.GET.get('alt-')
    vals = request.GET.get('vals')
    spec = request.GET.get('special')
    f_album = request.GET.get('album')

    album_subs = request.user.album_subscribed.all()
    albums = [i.album.id for i in album_subs]

    if f_album != None:
        if f_album not in [str(a) for a in albums]:
            return error_response("Not authorized", 401)
        albums = [f_album]

    photos = visible(Photo.objects.filter(album__in=albums, latitude__isnull=False, longitude__isnull=False), request)

    if date != None:
        try:
            parsed_date = datetime.datetime.strptime(date, '%Y-%m-%d').date()
            photos = photos.filter(date_taken__date=parsed_date)
        except (ValueError, TypeError):
            pass
    elif year != None:
        photos = photos.filter(date_taken__year=year)
    elif year1 != None:
        photos = photos.filter(date_taken__year__lte=year1)

    if spec == "1":
        photos = photos.filter(file_not_available=True)
    
    if alt != None:
        if alt == "NIL":
            qry = Q(altitude=None)
        else:
            qry = Q(altitude__lt=alt) | Q(altitude=None)  # "max altitude" excludes the limit itself

        photos = photos.filter(qry)


    if vals:
        return JsonResponse({ 'coords': [[i.latitude, i.longitude] for i in photos] })
    else:
        return render(request, 'photos/map.html', {
            'coords': [[i.latitude, i.longitude, 1] for i in photos],
            "left_sidebar": True, "right_sidebar": False, "active_page": "map",
        })

@login_required
def map_new(request):
    year = request.GET.get('year')
    year1 = request.GET.get('year-')
    op = request.GET.get('op')
    vals = request.GET.get('vals')
    f_album = request.GET.get('album')

    album_subs = request.user.album_subscribed.filter(visible=True)
    albums = [i.album.id for i in album_subs]

    if f_album != None:
        # Check against all subscriptions (not just visible ones) but never beyond them
        if f_album not in [str(a.album_id) for a in request.user.album_subscribed.all()]:
            return error_response("Not authorized", 401)
        albums = [f_album]

    locs = PhotoLocationCache.objects.filter(album_id__in=albums)

    if year != None:
        locs = locs.filter(dt_year=year)
    elif year1 != None:
        locs = locs.filter(dt_year__lte=year1)

    if op != '1':
        locs = locs.filter(Q(on_plane=False) | Q(on_plane=None))

    locs = locs.values('lat', 'lng').annotate(total_cnt=Sum('cnt'))

    if vals:
        return JsonResponse({ "coords": [[float(i['lat']), float(i['lng']), i['total_cnt']] for i in locs] })
    else:
        return render(request, 'photos/map.html', {
            "coords": [[float(i['lat']), float(i['lng']), i['total_cnt']] for i in locs],
            "left_sidebar": True, "right_sidebar": False, "active_page": "map",
        })

@login_required
def geoguessr(request):
    album_subs = request.user.album_subscribed.filter(visible=True)
    albums = [i.album for i in album_subs]

    photo = visible(Photo.objects.filter(album__in=albums, latitude__isnull=False, longitude__isnull=False), request).exclude(BROKEN_GPS).order_by("?").first()
    if photo is None:
        return error_response("No geotagged photos available", 404)

    return render(request, 'photos/geoguessr.html', { 'photo': {**photo.getinfo_zip(), **photo.get_gps_data()} })

@login_required
def geoguessr_ent(request):
    if request.method == "GET":
        album_subs = request.user.album_subscribed.filter(visible=True)
        albums = [i.album for i in album_subs]

        oq = Q()

        if request.GET.get('year'):
            oq = oq & Q(date_taken__year=request.GET.get('year'))
        if request.GET.get('month'):
            oq = oq & Q(date_taken__month=request.GET.get('month'))

        if request.GET.get('zero'):
            photo = visible(Photo.objects.filter(oq & Q(album__in=albums) & BROKEN_GPS), request).order_by('-date_taken').first()
        else:
            photo = visible(Photo.objects.filter(oq & Q(album__in=albums) & (Q(latitude__isnull=True) | Q(longitude__isnull=True))), request).order_by("?").first()

        if photo is None:
            return error_response("No photos without a location", 404)

        return render(request, 'photos/geoguessr_ent.html', { 'photo': photo.getinfo_zip() })

    elif request.method == "POST":
        try:
            b = json.loads(request.body.decode('utf8'))
            p = Photo.objects.get(id=b['photo'])
        except (ValueError, KeyError):
            return error_response("Malformed request")
        except Photo.DoesNotExist:
            return error_response("Photo does not exist", 404)

        # Changing a photo's location is an edit: library owners/editors only (viewers could write before).
        album_subs = request.user.album_subscribed.filter(subscribe_type__in=[0, 1])
        albums = [i.album for i in album_subs]

        if p.album in albums:
            p.set_location(b['lat'], b['lng'])  # clears city/country for null or broken (0) coordinates
            transaction.on_commit(lambda: photo_cache.schedule_matview_refresh(("photos_photo_location_cache",)))
            print(f"Saved location ({b['lat']}, {b['lng']}) for photo {b['photo']}")
            with open(os.path.join(BASE_DIR, "photo_gg_ent_log.txt"), "a") as f:
                f.write(f"{b['photo']} --> ({b['lat']}, {b['lng']}) [{request.user.username}]\n")
            return success_response("Success!")
        else: return error_response("Not authorized", 401)

@login_required
def day(request, year, month, day):
    album_subs = request.user.album_subscribed.filter(visible=True)
    albums = [i.album for i in album_subs]

    date_str = f"{year}-{month}-{day}"
    the_date = datetime.datetime.strptime(date_str, "%Y-%m-%d").date()
    context = {
        'title': f"Photos from {date_str}",
        'date': the_date,
        'photos': [i.getinfo_zip() for i in visible(Photo.objects.filter(album__in=albums, date_taken__date=the_date), request).order_by('date_taken')]
    }
    return render(request, 'photos/day.html', context)

@login_required
def event(request, event_id):
    album_subs = request.user.album_subscribed.filter(visible=True)
    albums = [i.album for i in album_subs]

    try:
        e = Event.objects.filter(id=event_id)[0]
        if not (e.public or e.calendar.public or e.calendar.users_subscribed.filter(user=request.user).exists()):
            return error_response("Not authorized", 401)

        if e.enddate == None: return error_response("Event is not bounded on the end time.")
        context = {
            'title': f"Photos from Event: {e.name}",
            'photos': [i.getinfo_zip() for i in visible(Photo.objects.filter(album__in=albums, date_taken__gte=e.startdate, date_taken__lte=e.enddate), request).order_by('date_taken')]
        }
        return render(request, 'photos/day.html', context)
    except IndexError: return error_response("Invalid event")

@login_required
def view_photo(request, photo_id):
    album_subs = request.user.album_subscribed.all()
    albums = [i.album for i in album_subs]

    try:
        p = visible(Photo.objects.filter(id=photo_id), request)[0]
        if p.album in albums or request.user.is_superuser:
            return render(request, 'photos/view_photo.html', { 'video': p.video, 'p_id': p.id, 'img_path': f"/photo_cdn/{p.photo_hash}/{p.get_path()}" })
        else:
            return error_response("Not authorized", 401)
    except IndexError:
        return error_response("Photo does not exist", 404)

def get_photos_for_date(request):
    """AJAX endpoint called repeatedly as the user scrolls.

    Standard filter params (same as the main photos page):
      ?date=YYYY-MM-DD  — starting date for this batch
      &ndays=N          — stop after N days (even if nphotos not reached)
      &nphotos=N        — stop after N photos (even if ndays not reached)
      &forward=1        — walk forward in time instead of backward

    All other common filters (video, camera_make, country, city, objects,
    bounds, similar, tol, album) are handled via _apply_standard_filters.

    Returns JSON:
      { photos: [{date, photos[], cities[], total_size}…], next: "YYYY-MM-DD" }
    """
    qs, _album_obj, _is_owner, err = _get_base_photo_pool(request)
    if err is not None:
        return err
    if qs is None:
        return error_response("Not logged in", 401)

    # Apply all static filters once before the date loop
    qs, _fctx = _apply_standard_filters(qs, request)
    uid = request.user.id if request.user.is_authenticated else None
    owned = set(Album.objects.filter(owner_id=uid).values_list('id', flat=True)) if uid else set()  # may hide/unhide

    numdays   = int(request.GET.get("ndays"))   if request.GET.get("ndays")   else None
    numphotos = int(request.GET.get("nphotos")) if request.GET.get("nphotos") else None
    forward   = request.GET.get('forward') == '1'
    donedays = donephotos = 0
    next_dt  = None
    ans      = []

    while (
        (numdays is None and numphotos is None and donedays == 0) or
        ((numdays is None or donedays < numdays) and (numphotos is None or donephotos < numphotos))
    ):
        dt = next_dt if next_dt else dateparser.parse(request.GET.get('date')).date()

        if forward:
            window = qs.filter(date_taken__date__gte=dt).order_by('date_taken')
        else:
            window = qs.filter(date_taken__date__lte=dt).order_by('-date_taken')

        day_qs = window.filter(date_taken__date=dt)

        citcount = (
            day_qs
            .filter(location_city__isnull=False, location_country__isnull=False)
            .values_list('location_city', 'location_country')
            .annotate(count=Count('id'))
            .order_by('-count')
        )
        total_size = day_qs.aggregate(ts=Sum('size'))['ts'] or 0

        ans.append({
            'date':       datetime.datetime.strftime(dt, "%Y-%m-%d"),
            'photos':     [{**p.getinfo_zip(), 'hidden': p.hidden, 'mine': p.owner_id == uid or p.album_id in owned}
                           for p in day_qs],
            'cities':     [list(c) for c in citcount],
            'total_size': total_size,
        })

        day_count = day_qs.count()
        next_dt   = (
            timezone.localtime(window[day_count].date_taken, pytz.timezone(TIME_ZONE)).date()
            if window.count() > day_count else None
        )
        donedays   += 1
        donephotos += day_count

        if (numdays is None and numphotos is None) or next_dt is None:
            break

    return JsonResponse({
        "photos": ans,
        "next":   datetime.datetime.strftime(next_dt, "%Y-%m-%d") if next_dt else None,
    })


def get_photo(request, photo_id, ret_type):

    if request.GET.get('album'):
        album = ShareAlbum.objects.filter(id=request.GET.get('album'))

        if album.exists():
            if album[0].public or \
                request.user.is_authenticated and (
                    ShareAlbum_Subscriber.objects.filter(album=album[0], user=request.user).exists() \
                    or album[0].owner == request.user \
                    or request.user.is_superuser
                ):
                sp = visible(ShareAlbum_Photo.objects.filter(photo__id=photo_id, sharealbum=album[0]), request, prefix="photo__")
                try:
                    photo = sp[0].photo
                except (IndexError, ValueError, ValidationError):
                    return error_response("Photo does not exist", 404)
            else:
                return error_response("Not authorized", 401)
        else:
            return error_response("Album does not exist", 404)

    else:
        if not request.user.is_authenticated:
            return error_response("Not logged in", 401)
        album_subs = request.user.album_subscribed.all()
        albums = [i.album for i in album_subs]

        try:
            photo = visible(Photo.objects.filter(id=photo_id), request)[0]
        except (IndexError, ValueError, ValidationError):
            return error_response("Photo does not exist", 404)

        if photo.album not in albums and not request.user.is_superuser:
            return error_response("Not authorized", 401)


    if ret_type == "info":
        mine = can_control(photo, request.user)  # may hide/unhide
        return JsonResponse({**photo.getinfo(), "hidden": photo.hidden, "mine": mine})
    elif ret_type == "thumbnail":
        if photo.video:
            import cv2
            f = cv2.VideoCapture(photo.album.location + photo.filepath)

            ret, fr = f.read()
            if ret:
                fr = cv2.rectangle(fr, (0, 0), (fr.shape[0], 400), (255, 255, 255), -1)
                fr = cv2.cvtColor(fr, cv2.COLOR_BGR2RGB)
                fr = cv2.putText(fr, 'Video', (100, 300), cv2.FONT_HERSHEY_SIMPLEX, 10, (255, 0), 10, cv2.LINE_AA)

                thumb = Image.fromarray(fr)
                thumb.thumbnail((500, 200), Image.Resampling.LANCZOS)

                response = HttpResponse(content_type='image/webp')
                thumb.save(response, "WEBP", quality=85)
                return response

        else:
            if settings.SERVE_FILES_WITH_DJANGO:  # local testing: no nginx
                return FileResponse(open(f"{settings.THUMBNAIL_DIR}{photo.id}.webp", "rb"), content_type='image/webp')
            response = HttpResponse(content_type='image/webp')
            response['X-Accel-Redirect'] = f"/media_private/photo_cache/thumbnail/{photo.id}.webp"
            response['Content-Disposition'] = f'attachment; filename="{BASE_DIR}media_private/photo_cache/thumbnail/{photo.id}.webp"'
            return response
    else:
        return error_response("Invalid return type")

@post_request_only
@login_required_api
def ingest_photos(request):
    # Only owners/editors can trigger an ingest (it writes into the album's library).
    if not request.user.album_subscribed.filter(subscribe_type__in=[0, 1]).exists():
        return error_response("Only album owners and editors can ingest photos", 403)
    try:
        ingest_all_photos.delay(user_id=request.user.id)
        return success_response("Ingest started")
    except Exception as ex:
        return server_error(ex)

@post_request_only
@login_required_api
def del_photo_req(request, photo_id):
    # Deleting removes files from disk: library owners/editors only, never viewers.
    album_subs = request.user.album_subscribed.filter(subscribe_type__in=[0, 1])
    albums = [i.album for i in album_subs]

    try:
        p = Photo.objects.filter(id=photo_id)[0]
        if p.album in albums or request.user.is_superuser:
            delete_photo(p)
            transaction.on_commit(photo_cache.schedule_matview_refresh)  # per-day counts and the heat map
            return success_response()
        else:
            return error_response("Not authorized", 401)
    except IndexError:
        return error_response("Photo does not exist", 404)


@post_request_only
@login_required_api
def delete_photo_original(request, photo_id):
    album_subs = request.user.album_subscribed.filter(subscribe_type__in=[0, 1])  # owners/editors only
    albums = [i.album for i in album_subs]

    try:
        p = Photo.objects.get(id=photo_id)
        if p.album not in albums and not request.user.is_superuser:
            return error_response("Not authorized", 401)

        freed_kb = 0

        # Safety Check 1: Must have orig_filepath and it MUST be different from p.filepath (the file used by the app)
        if p.orig_filepath and p.orig_filepath != p.filepath:
            album_loc = p.album.location if p.album else None
            if album_loc:
                orig_full = os.path.normpath(os.path.join(album_loc, p.orig_filepath))
                app_file_full = os.path.normpath(os.path.join(album_loc, p.filepath))

                # Safety Check 2: Never delete the app's optimized file
                if orig_full != app_file_full and os.path.exists(orig_full):
                    try:
                        freed_kb += os.path.getsize(orig_full) // 1024
                        os.remove(orig_full)
                    except OSError:
                        pass

            # Safety Check 3: Delete standalone DB record for the original file (if any), ensuring p itself is never deleted
            Photo.objects.filter(album=p.album, filepath=p.orig_filepath).exclude(id=p.id).delete()
            p.orig_filepath = None
            p.update_file_sizes()
            p.save()
            transaction.on_commit(photo_cache.schedule_matview_refresh)  # sizes per day; the original's own row is gone

        return JsonResponse({
            "status": "success",
            "size": p.size,
            "size_total": p.size_total,
            "opt_size_str": get_size_str(p.size),
            "tot_size_str": get_size_str(p.size_total),
            "freed_kb": freed_kb,
        })
    except Photo.DoesNotExist:
        return error_response("Photo does not exist", 404)


@login_required_api
def list_my_albums(request):
    if request.GET.get('all') == '1':
        ses = ShareAlbum_Subscriber.objects.filter(user=request.user)
        sa = [_share_album_info(s.album, request) for s in ses]

    else:
        sas = ShareAlbum.objects.filter(owner=request.user)
        sa = [_share_album_info(album, request) for album in sas]
    return JsonResponse({ "albums": sa })

@post_request_only
@login_required_api
def add_photo_to_album(request):
    body = json.loads(request.body.decode('utf8'))
    try:
        photo_id = body['photo_id']
        share_album_id = body['share_album_id']
    except KeyError:
        return error_response("Invalid parameters", 400)

    if type(photo_id) == str:
        photo_id = [photo_id]

    try:
        sa = ShareAlbum.objects.get(id=share_album_id)
    except ShareAlbum.DoesNotExist:
        return error_response("Target album does not exist", 404)

    # Check write access to target ShareAlbum sa (owner, editor, or superuser)
    has_album_write_access = (
        sa.owner == request.user or 
        request.user.is_superuser or 
        ShareAlbum_Subscriber.objects.filter(album=sa, user=request.user, subscribe_type__in=[0, 1]).exists()
    )
    if not has_album_write_access:
        return error_response("Not authorized to modify this album", 401)

    added = []
    for pid in photo_id:
        try:
            p = visible(Photo.objects.filter(id=pid), request).get()
        except (Photo.DoesNotExist, ValueError, ValidationError):
            continue
        
        # Check read access to photo p (owner, subscriber to physical album, or superuser)
        has_photo_access = (
            request.user.is_superuser or
            p.owner == request.user or
            p.album.owner == request.user or
            p.album.users_subscribed.filter(user=request.user).exists()
        )
        if has_photo_access:
            if not ShareAlbum_Photo.objects.filter(sharealbum=sa, photo=p).exists():
                sap = ShareAlbum_Photo(sharealbum=sa, photo=p)
                sap.save()
                added.append(str(p.id))

    # Only the newly added ids, so an Undo removes exactly what this call added.
    return success_response({"added": added})

@post_request_only
@login_required_api
def remove_photo_from_album(request):
    body = json.loads(request.body.decode('utf8'))
    try:
        photo_id = body['photo_id']
        share_album_id = body['share_album_id']
    except KeyError:
        return error_response("Invalid parameters", 400)

    if type(photo_id) == str:
        photo_id = [photo_id]

    try:
        sa = ShareAlbum.objects.get(id=share_album_id)
    except ShareAlbum.DoesNotExist:
        return error_response("Target album does not exist", 404)

    # Check write access to target ShareAlbum sa (owner, editor, or superuser)
    has_album_write_access = (
        sa.owner == request.user or 
        request.user.is_superuser or 
        ShareAlbum_Subscriber.objects.filter(album=sa, user=request.user, subscribe_type__in=[0, 1]).exists()
    )
    if not has_album_write_access:
        return error_response("Not authorized to modify this album", 401)

    for pid in photo_id:
        try:
            p = Photo.objects.get(id=pid)
        except Photo.DoesNotExist:
            continue
        ShareAlbum_Photo.objects.filter(sharealbum=sa, photo=p).delete()

    return success_response()

@post_request_only
@login_required_api
def create_share_album(request):
    body = json.loads(request.body.decode('utf8'))
    name = body.get('name')
    description = body.get('description', '')
    public = body.get('public', False)
    if not name:
        return error_response("Name is required", 400)
    
    album = ShareAlbum(owner=request.user, name=name, description=description, public=public)
    album.save()
    
    sub = ShareAlbum_Subscriber(album=album, user=request.user, subscribe_type=0)
    sub.save()
    
    return JsonResponse({"status": "success", "album": album.getinfo()})

@post_request_only
@login_required_api
def edit_share_album(request, album_id):
    try:
        album = ShareAlbum.objects.get(id=album_id)
    except ShareAlbum.DoesNotExist:
        return error_response("Album does not exist", 404)
    
    if album.owner != request.user and not request.user.is_superuser:
        return error_response("Not authorized", 401)
    
    body = json.loads(request.body.decode('utf8'))
    name = body.get('name')
    description = body.get('description', '')
    public = body.get('public', False)
    if not name:
        return error_response("Name is required", 400)
    
    album.name = name
    album.description = description
    album.public = public
    album.save()
    
    return JsonResponse({"status": "success", "album": album.getinfo()})

@post_request_only
@login_required_api
def set_album_cover(request, album_id):
    try:
        album = ShareAlbum.objects.get(id=album_id)
    except ShareAlbum.DoesNotExist:
        return error_response("Album does not exist", 404)
    
    if album.owner != request.user and not request.user.is_superuser:
        return error_response("Not authorized", 401)
    
    body = json.loads(request.body.decode('utf8'))
    cover_photo_id = body.get('cover_photo_id')
    if not cover_photo_id:
        return error_response("cover_photo_id is required", 400)
        
    try:
        photo = visible(Photo.objects.filter(id=cover_photo_id), request).get()
        if not ShareAlbum_Photo.objects.filter(sharealbum=album, photo=photo).exists():
            return error_response("Photo is not part of this album", 400)
    except Photo.DoesNotExist:
        return error_response("Photo does not exist", 404)
        
    album.cover_photo = photo
    album.save()
    
    return JsonResponse({"status": "success", "album": album.getinfo()})

@login_required_api
def manage_subscribers(request, album_id):
    try:
        album = ShareAlbum.objects.get(id=album_id)
    except ShareAlbum.DoesNotExist:
        return error_response("Album does not exist", 404)
    
    if album.owner != request.user and not request.user.is_superuser:
        return error_response("Not authorized", 401)
    
    if request.method == "GET":
        subs = ShareAlbum_Subscriber.objects.filter(album=album).exclude(subscribe_type=0)
        subscribers_list = []
        for s in subs:
            subscribers_list.append({
                "id": s.id,
                "username": s.user.username,
                "subscribe_type": s.subscribe_type
            })
        return JsonResponse({"status": "success", "subscribers": subscribers_list})
    
    elif request.method == "POST":
        body = json.loads(request.body.decode('utf8'))
        action = body.get('action')
        
        if action == "add":
            username = body.get('username')
            sub_type = body.get('subscribe_type', 2) # Default to Viewer (2)
            
            if not username:
                return error_response("Username is required", 400)
            # Only Editor (1) or Viewer (2) can be granted; Owner (0) is reserved
            try:
                sub_type = int(sub_type)
            except (TypeError, ValueError):
                return error_response("Invalid subscribe type", 400)
            if sub_type not in (1, 2):
                return error_response("Invalid subscribe type", 400)

            try:
                target_user = ComptechUser.objects.get(username=username)
            except ComptechUser.DoesNotExist:
                return error_response("User not found", 404)
                
            if ShareAlbum_Subscriber.objects.filter(album=album, user=target_user).exists():
                return error_response("User is already subscribed", 400)
                
            sub = ShareAlbum_Subscriber(album=album, user=target_user, subscribe_type=sub_type)
            sub.save()
            notify(target_user, f"{request.user.get_full_name() or request.user.username} shared \"{album.name}\" with you",
                   f"You can {'edit' if sub_type == 1 else 'view'} this album.", source="Photos",
                   url=f"/photos/?album={album.id}")
            return success_response()
            
        elif action == "remove":
            sub_id = body.get('subscriber_id')
            if not sub_id:
                return error_response("Subscriber ID is required", 400)
                
            try:
                sub = ShareAlbum_Subscriber.objects.get(id=sub_id, album=album)
                sub.delete()
                return success_response()
            except ShareAlbum_Subscriber.DoesNotExist:
                return error_response("Subscriber not found", 404)
                
        else:
            return error_response("Invalid action", 400)


@post_request_only
@login_required_api
def toggle_album_visibility(request, album_id):
    try:
        sub = request.user.album_subscribed.get(album_id=album_id)
        sub.visible = not sub.visible
        sub.save()
        return success_response({"visible": sub.visible})
    except Album_Subscriber.DoesNotExist:
        return error_response("Album subscription not found", 404)

@post_request_only
@login_required_api
def display_only_album(request, album_id):
    try:
        target_sub = request.user.album_subscribed.get(album_id=album_id)
        request.user.album_subscribed.exclude(album_id=album_id).update(visible=False)
        target_sub.visible = True
        target_sub.save()
        return success_response("Success")
    except Album_Subscriber.DoesNotExist:
        return error_response("Album subscription not found", 404)


@login_required
def stats_page(request):
    from django.db.models import Avg, Count, Sum
    is_admin = request.user.is_superuser or request.user.is_staff
    admin_override = False

    if request.GET.get('admin') == '1':
        if is_admin:
            admin_override = True
            albums = Album.objects.all()
        else:
            from django.shortcuts import redirect
            return redirect(request.path)
    else:
        album_subs = request.user.album_subscribed.filter(visible=True)
        albums = [i.album for i in album_subs]

    # Base queryset for photos in visible albums
    qs = visible(Photo.objects.filter(album__in=albums), request)

    total_count = qs.count()
    video_count = qs.filter(video=True).count()
    photo_count = total_count - video_count
    video_pct = round(video_count / total_count * 100, 1) if total_count > 0 else 0

    # Recent counts
    now = timezone.now()
    one_week_ago = now - datetime.timedelta(days=7)
    one_month_ago = now - datetime.timedelta(days=30)
    ytd_start = timezone.make_aware(datetime.datetime(now.year, 1, 1))
    one_year_ago = now - datetime.timedelta(days=365)

    taken_week = qs.filter(date_taken__gte=one_week_ago).count()
    taken_month = qs.filter(date_taken__gte=one_month_ago).count()
    taken_ytd = qs.filter(date_taken__gte=ytd_start).count()
    taken_year = qs.filter(date_taken__gte=one_year_ago).count()

    # Prior periods for comparison
    two_weeks_ago = now - datetime.timedelta(days=14)
    two_months_ago = now - datetime.timedelta(days=60)
    two_years_ago = now - datetime.timedelta(days=730)
    try:
        ytd_prior_end = now.replace(year=now.year - 1)
    except ValueError:
        ytd_prior_end = now - datetime.timedelta(days=365)
    ytd_prior_start = timezone.make_aware(datetime.datetime(now.year - 1, 1, 1))

    taken_week_prior = qs.filter(date_taken__gte=two_weeks_ago, date_taken__lt=one_week_ago).count()
    taken_month_prior = qs.filter(date_taken__gte=two_months_ago, date_taken__lt=one_month_ago).count()
    taken_ytd_prior = qs.filter(date_taken__gte=ytd_prior_start, date_taken__lt=ytd_prior_end).count()
    taken_year_prior = qs.filter(date_taken__gte=two_years_ago, date_taken__lt=one_year_ago).count()

    def get_pct_change(current, prior):
        if prior == 0:
            if current > 0:
                return "+100.0", "green"
            return "0.0", "gray"
        diff = current - prior
        pct = (diff / prior) * 100
        if pct > 0:
            return f"+{pct:.1f}", "green"
        elif pct < 0:
            return f"{pct:.1f}", "red"
        return "0.0", "gray"

    week_pct, week_color = get_pct_change(taken_week, taken_week_prior)
    month_pct, month_color = get_pct_change(taken_month, taken_month_prior)
    ytd_pct, ytd_color = get_pct_change(taken_ytd, taken_ytd_prior)
    year_pct, year_color = get_pct_change(taken_year, taken_year_prior)

    # Camera makes/models
    cameras = qs.exclude(camera_model__isnull=True).exclude(camera_model='').values('camera_make', 'camera_model').annotate(count=Count('id')).order_by('-count')[:10]

    # Average Megapixels
    avg_mp = qs.filter(video=False, megapixels__isnull=False).aggregate(Avg('megapixels'))['megapixels__avg'] or 0
    avg_mp = round(avg_mp, 1)

    # Collect monthly, hourly, daily, and month-of-year data
    dates_and_types = qs.filter(date_taken__isnull=False).values_list('date_taken', 'video', 'length')

    from collections import defaultdict
    month_histogram = defaultdict(lambda: {'all': 0, 'photo': 0, 'video': 0, 'video_duration': 0})
    year_histogram = defaultdict(lambda: {'all': 0, 'photo': 0, 'video': 0, 'video_duration': 0})
    hour_histogram = defaultdict(lambda: {'all': 0, 'photo': 0, 'video': 0, 'video_duration': 0})
    day_histogram = defaultdict(lambda: {'all': 0, 'photo': 0, 'video': 0, 'video_duration': 0})
    month_of_year_histogram = defaultdict(lambda: {'all': 0, 'photo': 0, 'video': 0, 'video_duration': 0})

    for dt, is_video, length in dates_and_types:
        month_str = dt.strftime('%Y-%m')
        year_str = dt.strftime('%Y')
        hr = dt.hour
        day_num = dt.day
        moy = dt.month
        key = 'video' if is_video else 'photo'

        month_histogram[month_str]['all'] += 1
        month_histogram[month_str][key] += 1

        year_histogram[year_str]['all'] += 1
        year_histogram[year_str][key] += 1

        hour_histogram[hr]['all'] += 1
        hour_histogram[hr][key] += 1

        day_histogram[day_num]['all'] += 1
        day_histogram[day_num][key] += 1

        month_of_year_histogram[moy]['all'] += 1
        month_of_year_histogram[moy][key] += 1

        if is_video and length:
            month_histogram[month_str]['video_duration'] += length
            year_histogram[year_str]['video_duration'] += length
            hour_histogram[hr]['video_duration'] += length
            day_histogram[day_num]['video_duration'] += length
            month_of_year_histogram[moy]['video_duration'] += length

    # Hourly histogram (0 to 23)
    hours_labels = [f"{h:02d}:00" for h in range(24)]
    hours_data_all = [hour_histogram[h]['all'] for h in range(24)]
    hours_data_photo = [hour_histogram[h]['photo'] for h in range(24)]
    hours_data_video = [hour_histogram[h]['video'] for h in range(24)]
    hours_data_video_duration = [round(hour_histogram[h]['video_duration'] / 60.0, 1) for h in range(24)]

    # Daily histogram (1 to 31)
    days_labels = [str(d) for d in range(1, 32)]
    days_data_all = [day_histogram[d]['all'] for d in range(1, 32)]
    days_data_photo = [day_histogram[d]['photo'] for d in range(1, 32)]
    days_data_video = [day_histogram[d]['video'] for d in range(1, 32)]
    days_data_video_duration = [round(day_histogram[d]['video_duration'] / 60.0, 1) for d in range(1, 32)]

    # Month of year histogram (1 to 12)
    months_year_labels = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    months_year_data_all = [month_of_year_histogram[m]['all'] for m in range(1, 13)]
    months_year_data_photo = [month_of_year_histogram[m]['photo'] for m in range(1, 13)]
    months_year_data_video = [month_of_year_histogram[m]['video'] for m in range(1, 13)]
    months_year_data_video_duration = [round(month_of_year_histogram[m]['video_duration'] / 60.0, 1) for m in range(1, 13)]

    # Generate labels chronologically going back 60 months (5 years)
    months_60_labels = []
    curr = now
    for _ in range(60):
        months_60_labels.append(curr.strftime('%Y-%m'))
        first = curr.replace(day=1)
        prev = first - datetime.timedelta(days=1)
        curr = prev
    months_60_labels.reverse()

    months_60_all = [month_histogram[m]['all'] for m in months_60_labels]
    months_60_photo = [month_histogram[m]['photo'] for m in months_60_labels]
    months_60_video = [month_histogram[m]['video'] for m in months_60_labels]
    months_60_video_duration = [round(month_histogram[m]['video_duration'] / 60.0, 1) for m in months_60_labels]

    # Past 24 months
    months_24_labels = months_60_labels[-24:]
    months_24_all = months_60_all[-24:]
    months_24_photo = months_60_photo[-24:]
    months_24_video = months_60_video[-24:]
    months_24_video_duration = months_60_video_duration[-24:]

    # Past 12 months
    months_12_labels = months_60_labels[-12:]
    months_12_all = months_60_all[-12:]
    months_12_photo = months_60_photo[-12:]
    months_12_video = months_60_video[-12:]
    months_12_video_duration = months_60_video_duration[-12:]

    # 10 years yearly
    this_year = now.year
    years_10_labels = [str(y) for y in range(this_year - 9, this_year + 1)]
    years_10_all = [year_histogram[y]['all'] for y in years_10_labels]
    years_10_photo = [year_histogram[y]['photo'] for y in years_10_labels]
    years_10_video = [year_histogram[y]['video'] for y in years_10_labels]
    years_10_video_duration = [round(year_histogram[y]['video_duration'] / 60.0, 1) for y in years_10_labels]

    # All years yearly
    sorted_all_years = sorted(year_histogram.keys())
    if not sorted_all_years:
        sorted_all_years = [str(this_year)]
    else:
        min_yr = int(sorted_all_years[0])
        max_yr = int(sorted_all_years[-1])
        sorted_all_years = [str(y) for y in range(min_yr, max_yr + 1)]
    all_years_all = [year_histogram[y]['all'] for y in sorted_all_years]
    all_years_photo = [year_histogram[y]['photo'] for y in sorted_all_years]
    all_years_video = [year_histogram[y]['video'] for y in sorted_all_years]
    all_years_video_duration = [round(year_histogram[y]['video_duration'] / 60.0, 1) for y in sorted_all_years]

    context = {
        "active_page": "stats",
        "left_sidebar": True,
        "right_sidebar": False,
        "admin_override": admin_override,
        "total_count": total_count,
        "photo_count": photo_count,
        "video_count": video_count,
        "video_pct": video_pct,
        "taken_week": taken_week,
        "week_pct": week_pct,
        "week_color": week_color,
        "taken_month": taken_month,
        "month_pct": month_pct,
        "month_color": month_color,
        "taken_ytd": taken_ytd,
        "ytd_pct": ytd_pct,
        "ytd_color": ytd_color,
        "taken_year": taken_year,
        "year_pct": year_pct,
        "year_color": year_color,
        "cameras": list(cameras),
        "avg_mp": avg_mp,
        "hours_labels": hours_labels,
        "hours_data_all": hours_data_all,
        "hours_data_photo": hours_data_photo,
        "hours_data_video": hours_data_video,
        "hours_data_video_duration": hours_data_video_duration,
        "days_labels": days_labels,
        "days_data_all": days_data_all,
        "days_data_photo": days_data_photo,
        "days_data_video": days_data_video,
        "days_data_video_duration": days_data_video_duration,
        "months_year_labels": months_year_labels,
        "months_year_data_all": months_year_data_all,
        "months_year_data_photo": months_year_data_photo,
        "months_year_data_video": months_year_data_video,
        "months_year_data_video_duration": months_year_data_video_duration,
        "months_12_labels": months_12_labels,
        "months_12_data_all": months_12_all,
        "months_12_data_photo": months_12_photo,
        "months_12_data_video": months_12_video,
        "months_12_data_video_duration": months_12_video_duration,
        "months_24_labels": months_24_labels,
        "months_24_data_all": months_24_all,
        "months_24_data_photo": months_24_photo,
        "months_24_data_video": months_24_video,
        "months_24_data_video_duration": months_24_video_duration,
        "months_60_labels": months_60_labels,
        "months_60_data_all": months_60_all,
        "months_60_data_photo": months_60_photo,
        "months_60_data_video": months_60_video,
        "months_60_data_video_duration": months_60_video_duration,
        "years_10_labels": years_10_labels,
        "years_10_data_all": years_10_all,
        "years_10_data_photo": years_10_photo,
        "years_10_data_video": years_10_video,
        "years_10_data_video_duration": years_10_video_duration,
        "all_years_labels": sorted_all_years,
        "all_years_data_all": all_years_all,
        "all_years_data_photo": all_years_photo,
        "all_years_data_video": all_years_video,
        "all_years_data_video_duration": all_years_video_duration,
    }
    return render(request, 'photos/stats.html', context)


def get_duration_str(seconds):
    if not seconds:
        return "00:00:00"
    h = seconds // 3600
    m = (seconds % 3600) // 60
    s = seconds % 60
    return f"{int(h):02d}:{int(m):02d}:{int(s):02d}"


def get_size_str(kb):
    if not kb:
        return "0.0 MB"
    mb = kb / 1024.0
    if mb >= 1024.0 * 1024.0: # 1 TB
        return f"{mb / (1024.0 * 1024.0):.2f} TB"
    elif mb >= 1024.0: # 1 GB
        return f"{mb / 1024.0:.2f} GB"
    else:
        return f"{mb:.1f} MB"


def get_storage_breakdown(qs):
    from django.db.models import Sum, Count, Q
    totals = qs.aggregate(
        all_opt=Sum('size'),
        all_tot=Sum('size_total'),
        all_cnt=Count('id'),
        photo_opt=Sum('size', filter=Q(video=False)),
        photo_tot=Sum('size_total', filter=Q(video=False)),
        photo_cnt=Count('id', filter=Q(video=False)),
        video_opt=Sum('size', filter=Q(video=True)),
        video_tot=Sum('size_total', filter=Q(video=True)),
        video_cnt=Count('id', filter=Q(video=True)),
        video_length=Sum('length', filter=Q(video=True)),
    )
    all_opt = totals['all_opt'] or 0
    all_tot = totals['all_tot'] or 0
    all_cnt = totals['all_cnt'] or 0

    photo_opt = totals['photo_opt'] or 0
    photo_tot = totals['photo_tot'] or 0
    photo_cnt = totals['photo_cnt'] or 0

    video_opt = totals['video_opt'] or 0
    video_tot = totals['video_tot'] or 0
    video_cnt = totals['video_cnt'] or 0
    video_length = totals['video_length'] or 0

    return {
        'all': {'opt': all_opt, 'tot': all_tot, 'cnt': all_cnt, 'overhead': all_tot - all_opt},
        'photo': {'opt': photo_opt, 'tot': photo_tot, 'cnt': photo_cnt, 'overhead': photo_tot - photo_opt},
        'video': {'opt': video_opt, 'tot': video_tot, 'cnt': video_cnt, 'overhead': video_tot - video_opt, 'length': video_length},
    }


@login_required
def storage_page(request):
    is_admin = request.user.is_superuser or request.user.is_staff
    admin_override = False

    if request.GET.get('admin') == '1':
        if is_admin:
            admin_override = True
            albums_list = Album.objects.all()
            albums = albums_list
        else:
            from django.shortcuts import redirect
            return redirect(request.path)
    else:
        album_subs = request.user.album_subscribed.filter(visible=True)
        albums_list = [sub.album for sub in album_subs]
        albums = albums_list

    # Base queryset for photos in visible/admin albums
    qs = visible(Photo.objects.filter(album__in=albums), request)

    # Overall totals
    bd = get_storage_breakdown(qs)
    overall_stats = {
        'all': {
            'count': bd['all']['cnt'],
            'opt_size_gb': round(bd['all']['opt'] / 1024 / 1024, 2),
            'tot_size_gb': round(bd['all']['tot'] / 1024 / 1024, 2),
            'overhead_gb': round(bd['all']['overhead'] / 1024 / 1024, 2),
            'opt_size_str': get_size_str(bd['all']['opt']),
            'tot_size_str': get_size_str(bd['all']['tot']),
            'overhead_str': get_size_str(bd['all']['overhead']),
        },
        'photo': {
            'count': bd['photo']['cnt'],
            'opt_size_gb': round(bd['photo']['opt'] / 1024 / 1024, 2),
            'tot_size_gb': round(bd['photo']['tot'] / 1024 / 1024, 2),
            'overhead_gb': round(bd['photo']['overhead'] / 1024 / 1024, 2),
            'opt_size_str': get_size_str(bd['photo']['opt']),
            'tot_size_str': get_size_str(bd['photo']['tot']),
            'overhead_str': get_size_str(bd['photo']['overhead']),
        },
        'video': {
            'count': bd['video']['cnt'],
            'opt_size_gb': round(bd['video']['opt'] / 1024 / 1024, 2),
            'tot_size_gb': round(bd['video']['tot'] / 1024 / 1024, 2),
            'overhead_gb': round(bd['video']['overhead'] / 1024 / 1024, 2),
            'opt_size_str': get_size_str(bd['video']['opt']),
            'tot_size_str': get_size_str(bd['video']['tot']),
            'overhead_str': get_size_str(bd['video']['overhead']),
        },
    }

    # Group by Album
    album_storage = []
    for album in albums_list:
        album_qs = visible(Photo.objects.filter(album=album), request)
        bd_album = get_storage_breakdown(album_qs)
        tot = bd_album['all']['tot']
        opt_photo = bd_album['photo']['opt']
        raw_photo = bd_album['photo']['overhead']
        opt_video = bd_album['video']['opt']
        orig_video = bd_album['video']['overhead']
        album_storage.append({
            'name': album.name,
            # ALL
            'count_all': bd_album['all']['cnt'],
            'opt_size_mb_all': bd_album['all']['opt'] / 1024,
            'tot_size_mb_all': tot / 1024,
            'overhead_mb_all': bd_album['all']['overhead'] / 1024,
            'opt_size_str_all': get_size_str(bd_album['all']['opt']),
            'tot_size_str_all': get_size_str(tot),
            'overhead_str_all': get_size_str(bd_album['all']['overhead']),
            # PHOTO
            'count_photo': bd_album['photo']['cnt'],
            'opt_size_mb_photo': opt_photo / 1024,
            'tot_size_mb_photo': bd_album['photo']['tot'] / 1024,
            'overhead_mb_photo': raw_photo / 1024,
            'opt_size_str_photo': get_size_str(opt_photo),
            'tot_size_str_photo': get_size_str(bd_album['photo']['tot']),
            'overhead_str_photo': get_size_str(raw_photo),
            # VIDEO
            'count_video': bd_album['video']['cnt'],
            'duration_video': get_duration_str(bd_album['video']['length']),
            'opt_size_mb_video': opt_video / 1024,
            'tot_size_mb_video': bd_album['video']['tot'] / 1024,
            'overhead_mb_video': orig_video / 1024,
            'opt_size_str_video': get_size_str(opt_video),
            'tot_size_str_video': get_size_str(bd_album['video']['tot']),
            'overhead_str_video': get_size_str(orig_video),
            # PERCENTAGES
            'pct_photo_opt': (opt_photo / tot * 100) if tot > 0 else 0,
            'pct_photo_raw': (raw_photo / tot * 100) if tot > 0 else 0,
            'pct_video_opt': (opt_video / tot * 100) if tot > 0 else 0,
            'pct_video_orig': (orig_video / tot * 100) if tot > 0 else 0,
        })
    album_storage.sort(key=lambda x: x['tot_size_mb_all'], reverse=True)

    # Group by Year
    from collections import defaultdict
    year_stats = defaultdict(lambda: {'all_opt': 0, 'all_tot': 0, 'all_cnt': 0,
                                      'photo_opt': 0, 'photo_tot': 0, 'photo_cnt': 0,
                                      'video_opt': 0, 'video_tot': 0, 'video_cnt': 0,
                                      'video_length': 0})
    for dt, opt, tot, is_video, length in qs.filter(date_taken__isnull=False).values_list('date_taken', 'size', 'size_total', 'video', 'length'):
        yr = dt.year
        opt_val = opt or 0
        tot_val = tot or 0
        length_val = length or 0
        year_stats[yr]['all_opt'] += opt_val
        year_stats[yr]['all_tot'] += tot_val
        year_stats[yr]['all_cnt'] += 1
        if is_video:
            year_stats[yr]['video_opt'] += opt_val
            year_stats[yr]['video_tot'] += tot_val
            year_stats[yr]['video_cnt'] += 1
            year_stats[yr]['video_length'] += length_val
        else:
            year_stats[yr]['photo_opt'] += opt_val
            year_stats[yr]['photo_tot'] += tot_val
            year_stats[yr]['photo_cnt'] += 1

    year_storage = []
    for yr, vals in sorted(year_stats.items(), reverse=True):
        all_oh = vals['all_tot'] - vals['all_opt']
        photo_oh = vals['photo_tot'] - vals['photo_opt']
        video_oh = vals['video_tot'] - vals['video_opt']
        tot = vals['all_tot']
        opt_photo = vals['photo_opt']
        raw_photo = photo_oh
        opt_video = vals['video_opt']
        orig_video = video_oh
        year_storage.append({
            'year': yr,
            # ALL
            'count_all': vals['all_cnt'],
            'opt_size_str_all': get_size_str(vals['all_opt']),
            'tot_size_str_all': get_size_str(tot),
            'overhead_str_all': get_size_str(all_oh),
            # PHOTO
            'count_photo': vals['photo_cnt'],
            'opt_size_str_photo': get_size_str(opt_photo),
            'tot_size_str_photo': get_size_str(vals['photo_tot']),
            'overhead_str_photo': get_size_str(raw_photo),
            # VIDEO
            'count_video': vals['video_cnt'],
            'duration_video': get_duration_str(vals['video_length']),
            'opt_size_str_video': get_size_str(opt_video),
            'tot_size_str_video': get_size_str(vals['video_tot']),
            'overhead_str_video': get_size_str(orig_video),
            # PERCENTAGES
            'pct_photo_opt': (opt_photo / tot * 100) if tot > 0 else 0,
            'pct_photo_raw': (raw_photo / tot * 100) if tot > 0 else 0,
            'pct_video_opt': (opt_video / tot * 100) if tot > 0 else 0,
            'pct_video_orig': (orig_video / tot * 100) if tot > 0 else 0,
        })

    # Group by Month
    month_stats = defaultdict(lambda: {'all_opt': 0, 'all_tot': 0, 'all_cnt': 0,
                                       'photo_opt': 0, 'photo_tot': 0, 'photo_cnt': 0,
                                       'video_opt': 0, 'video_tot': 0, 'video_cnt': 0,
                                       'video_length': 0})
    for dt, opt, tot, is_video, length in qs.filter(date_taken__isnull=False).values_list('date_taken', 'size', 'size_total', 'video', 'length'):
        m_str = dt.strftime('%Y-%m')
        opt_val = opt or 0
        tot_val = tot or 0
        length_val = length or 0
        month_stats[m_str]['all_opt'] += opt_val
        month_stats[m_str]['all_tot'] += tot_val
        month_stats[m_str]['all_cnt'] += 1
        if is_video:
            month_stats[m_str]['video_opt'] += opt_val
            month_stats[m_str]['video_tot'] += tot_val
            month_stats[m_str]['video_cnt'] += 1
            month_stats[m_str]['video_length'] += length_val
        else:
            month_stats[m_str]['photo_opt'] += opt_val
            month_stats[m_str]['photo_tot'] += tot_val
            month_stats[m_str]['photo_cnt'] += 1

    now = datetime.datetime.now()
    months_list = []
    curr = now
    for _ in range(60):
        months_list.append(curr.strftime('%Y-%m'))
        first = curr.replace(day=1)
        prev = first - datetime.timedelta(days=1)
        curr = prev

    month_storage = []
    for m_str in months_list:
        vals = month_stats[m_str]
        all_oh = vals['all_tot'] - vals['all_opt']
        photo_oh = vals['photo_tot'] - vals['photo_opt']
        video_oh = vals['video_tot'] - vals['video_opt']
        tot = vals['all_tot']
        opt_photo = vals['photo_opt']
        raw_photo = photo_oh
        opt_video = vals['video_opt']
        orig_video = video_oh
        month_storage.append({
            'month': m_str,
            # ALL
            'count_all': vals['all_cnt'],
            'opt_size_mb_all': vals['all_opt'] / 1024,
            'tot_size_mb_all': tot / 1024,
            'overhead_mb_all': all_oh / 1024,
            'opt_size_str_all': get_size_str(vals['all_opt']),
            'tot_size_str_all': get_size_str(tot),
            'overhead_str_all': get_size_str(all_oh),
            # PHOTO
            'count_photo': vals['photo_cnt'],
            'opt_size_mb_photo': opt_photo / 1024,
            'tot_size_mb_photo': vals['photo_tot'] / 1024,
            'overhead_mb_photo': raw_photo / 1024,
            'opt_size_str_photo': get_size_str(opt_photo),
            'tot_size_str_photo': get_size_str(vals['photo_tot']),
            'overhead_str_photo': get_size_str(raw_photo),
            # VIDEO
            'count_video': vals['video_cnt'],
            'duration_video': get_duration_str(vals['video_length']),
            'opt_size_mb_video': opt_video / 1024,
            'tot_size_mb_video': vals['video_tot'] / 1024,
            'overhead_mb_video': video_oh / 1024,
            'opt_size_str_video': get_size_str(opt_video),
            'tot_size_str_video': get_size_str(vals['video_tot']),
            'overhead_str_video': get_size_str(video_oh),
            # PERCENTAGES
            'pct_photo_opt': (opt_photo / tot * 100) if tot > 0 else 0,
            'pct_photo_raw': (raw_photo / tot * 100) if tot > 0 else 0,
            'pct_video_opt': (opt_video / tot * 100) if tot > 0 else 0,
            'pct_video_orig': (orig_video / tot * 100) if tot > 0 else 0,
        })

    context = {
        "active_page": "storage",
        "left_sidebar": True,
        "right_sidebar": False,
        "admin_override": admin_override,
        "overall": overall_stats,
        "album_storage": album_storage,
        "year_storage": year_storage,
        "month_storage": month_storage,
    }
    return render(request, 'photos/storage.html', context)


@login_required
def superlatives_page(request, category='biggest-files'):
    from django.shortcuts import redirect
    from django.db.models import F, Q

    ITEM_CATEGORIES = [
        {'id': 'biggest-files', 'name': 'Disk Footprint', 'icon': '💾', 'desc': 'Top media items ranked by total disk space used.', 'type': 'item'},
        {'id': 'longest-videos', 'name': 'Longest Videos', 'icon': '🎬', 'desc': 'Top longest individual videos by duration.', 'type': 'item'},
        {'id': 'biggest-orig-videos', 'name': 'Original Videos', 'icon': '📼', 'desc': 'Top videos with original uncompressed source backups.', 'type': 'item'},
        {'id': 'biggest-resolution', 'name': 'Highest Resolution', 'icon': '🖼️', 'desc': 'Top media items ranked by megapixel resolution.', 'type': 'item'},
        {'id': 'biggest-photos', 'name': 'Largest Photos', 'icon': '📸', 'desc': 'Top photo files (excluding videos) by file size.', 'type': 'item'},
        {'id': 'biggest-overhead', 'name': 'Overhead Gap', 'icon': '⚡', 'desc': 'Top files with largest original vs. compressed size gap.', 'type': 'item'},
        {'id': 'biggest-raw', 'name': 'RAW Files', 'icon': '🎞️', 'desc': 'Top photos with attached RAW camera images.', 'type': 'item'},
    ]

    DAY_CATEGORIES = [
        {'id': 'day-most-photos', 'name': 'Most Photos (1 Day)', 'icon': '📅', 'desc': 'Days with the highest number of photos taken.', 'type': 'day'},
        {'id': 'day-most-videos', 'name': 'Most Videos (1 Day)', 'icon': '📹', 'desc': 'Days with the highest number of videos recorded.', 'type': 'day'},
        {'id': 'day-most-storage', 'name': 'Most Storage (1 Day)', 'icon': '📊', 'desc': 'Days with the largest total storage footprint.', 'type': 'day'},
        {'id': 'day-longest-video-time', 'name': 'Most Video Time (1 Day)', 'icon': '⏱️', 'desc': 'Days with the longest combined video duration recorded.', 'type': 'day'},
    ]

    ALL_CATEGORIES = ITEM_CATEGORIES + DAY_CATEGORIES
    cat_dict = {c['id']: c for c in ALL_CATEGORIES}
    if category not in cat_dict:
        category = 'biggest-files'
    current_category = cat_dict[category]
    is_day_category = current_category.get('type') == 'day'

    is_admin = request.user.is_superuser or request.user.is_staff
    admin_override = False

    if request.GET.get('admin') == '1':
        if is_admin:
            admin_override = True
            albums = Album.objects.all()
        else:
            return redirect(request.path)
    else:
        album_subs = request.user.album_subscribed.filter(visible=True)
        albums = [sub.album for sub in album_subs]

    album_qs = visible(Photo.objects.filter(album__in=albums), request)

    # Exclude standalone Photo entries whose filepath is already linked as an orig_filepath or raw_filepath of another primary photo
    orig_paths = set(album_qs.exclude(orig_filepath__isnull=True).exclude(orig_filepath='').values_list('orig_filepath', flat=True)) | \
                 set(album_qs.exclude(raw_filepath__isnull=True).exclude(raw_filepath='').values_list('raw_filepath', flat=True))

    base_qs = album_qs.exclude(filepath__in=orig_paths).select_related('album', 'owner')

    try:
        limit = int(request.GET.get("limit", 50))
        if limit not in (20, 50, 100, 200):
            limit = 50
    except (ValueError, TypeError):
        limit = 50

    top_photos = []
    top_days = []
    summary = {}

    if is_day_category:
        day_base = base_qs.filter(date_taken__isnull=False)

        if category == 'day-most-photos':
            rows = day_base.filter(video=False).values(d=F('date_taken__date')).annotate(
                metric_val=Count('id'),
                tot_size=Sum('size_total')
            ).order_by('-metric_val')[:limit]

            for idx, r in enumerate(rows, 1):
                dt = r['d']
                top_days.append({
                    'rank': idx,
                    'date': dt,
                    'year': dt.year,
                    'month': dt.month,
                    'day': dt.day,
                    'date_str': dt.strftime('%A, %b %d, %Y'),
                    'primary_metric': f"{r['metric_val']:,} Photos",
                    'secondary_info': f"{get_size_str(r['tot_size'] or 0)} storage",
                })

        elif category == 'day-most-videos':
            rows = day_base.filter(video=True).values(d=F('date_taken__date')).annotate(
                metric_val=Count('id'),
                tot_length=Sum('length'),
                tot_size=Sum('size_total')
            ).order_by('-metric_val')[:limit]

            for idx, r in enumerate(rows, 1):
                dt = r['d']
                dur_str = get_duration_str(r['tot_length'] or 0)
                top_days.append({
                    'rank': idx,
                    'date': dt,
                    'year': dt.year,
                    'month': dt.month,
                    'day': dt.day,
                    'date_str': dt.strftime('%A, %b %d, %Y'),
                    'primary_metric': f"{r['metric_val']:,} Videos",
                    'secondary_info': f"{dur_str} total length • {get_size_str(r['tot_size'] or 0)} storage",
                })

        elif category == 'day-most-storage':
            rows = day_base.values(d=F('date_taken__date')).annotate(
                metric_val=Sum('size_total'),
                count=Count('id'),
                video_count=Count('id', filter=Q(video=True)),
                photo_count=Count('id', filter=Q(video=False))
            ).order_by(F('metric_val').desc(nulls_last=True))[:limit]

            for idx, r in enumerate(rows, 1):
                dt = r['d']
                top_days.append({
                    'rank': idx,
                    'date': dt,
                    'year': dt.year,
                    'month': dt.month,
                    'day': dt.day,
                    'date_str': dt.strftime('%A, %b %d, %Y'),
                    'primary_metric': get_size_str(r['metric_val'] or 0),
                    'secondary_info': f"{r['count']:,} items ({r['photo_count']} photos, {r['video_count']} videos)",
                })

        elif category == 'day-longest-video-time':
            rows = day_base.filter(video=True, length__gt=0).values(d=F('date_taken__date')).annotate(
                metric_val=Sum('length'),
                count=Count('id'),
                tot_size=Sum('size_total')
            ).order_by(F('metric_val').desc(nulls_last=True))[:limit]

            for idx, r in enumerate(rows, 1):
                dt = r['d']
                top_days.append({
                    'rank': idx,
                    'date': dt,
                    'year': dt.year,
                    'month': dt.month,
                    'day': dt.day,
                    'date_str': dt.strftime('%A, %b %d, %Y'),
                    'primary_metric': get_duration_str(r['metric_val'] or 0),
                    'secondary_info': f"{r['count']:,} videos • {get_size_str(r['tot_size'] or 0)} storage",
                })

        summary = {'count': len(top_days)}

    else:
        # Apply category specific filters & ordering
        if category == 'biggest-files':
            qs = base_qs.order_by(F('size_total').desc(nulls_last=True), F('size').desc(nulls_last=True))[:limit]
        elif category == 'longest-videos':
            qs = base_qs.filter(video=True).exclude(length__isnull=True).order_by(F('length').desc(nulls_last=True))[:limit]
        elif category == 'biggest-orig-videos':
            qs = base_qs.filter(video=True, orig_filepath__isnull=False).exclude(orig_filepath='').order_by(F('size_total').desc(nulls_last=True), F('size').desc(nulls_last=True))[:limit]
        elif category == 'biggest-resolution':
            qs = base_qs.exclude(megapixels__isnull=True).order_by(F('megapixels').desc(nulls_last=True))[:limit]
        elif category == 'biggest-photos':
            qs = base_qs.filter(video=False).order_by(F('size_total').desc(nulls_last=True), F('size').desc(nulls_last=True))[:limit]
        elif category == 'biggest-overhead':
            qs = base_qs.annotate(overhead_gap=F('size_total') - F('size')).filter(overhead_gap__gt=0).order_by(F('overhead_gap').desc(nulls_last=True))[:limit]
        elif category == 'biggest-raw':
            qs = base_qs.filter(Q(raw_filepath__isnull=False) & ~Q(raw_filepath='')).order_by(F('size_total').desc(nulls_last=True), F('size').desc(nulls_last=True))[:limit]
        else:
            qs = base_qs.order_by(F('size_total').desc(nulls_last=True))[:limit]

        tot_size_sum = 0
        opt_size_sum = 0
        photo_count = 0
        video_count = 0
        total_duration_sec = 0
        max_mp = 0.0

        for idx, photo in enumerate(qs, 1):
            tot = photo.size_total or photo.size or 0
            opt = photo.size or photo.size_total or 0

            if tot == 0:
                try:
                    full_p = photo.get_filepath()
                    if os.path.exists(full_p):
                        tot = os.path.getsize(full_p) // 1024
                        opt = tot
                except Exception:
                    pass
            tot_size_sum += tot
            opt_size_sum += opt

            if photo.video:
                video_count += 1
                if photo.length:
                    total_duration_sec += photo.length
            else:
                photo_count += 1

            if photo.megapixels and photo.megapixels > max_mp:
                max_mp = photo.megapixels

            duration_text = ""
            if photo.video and photo.length:
                m, s = divmod(photo.length, 60)
                duration_text = f"{m:02d}:{s:02d}"

            info_dict = photo.getinfo()

            local_dt = timezone.localtime(photo.date_taken, pytz.timezone(TIME_ZONE)) if (photo.date_taken and timezone.is_aware(photo.date_taken)) else photo.date_taken
            date_taken_str = local_dt.strftime("%Y-%m-%d %H:%M") if local_dt else "—"

            top_photos.append({
                'rank': idx,
                'id': str(photo.id),
                'filename': os.path.basename(photo.filepath),
                'filepath': photo.filepath,
                'album_name': photo.album.name,
                'owner_username': photo.owner.username,
                'video': photo.video,
                'size': photo.size,
                'size_total': photo.size_total,
                'opt_size_str': get_size_str(opt),
                'tot_size_str': get_size_str(tot),
                'overhead_str': get_size_str(max(0, tot - opt)),
                'date_taken': local_dt,
                'date_taken_str': date_taken_str,
                'thumbnail_hash': photo.thumbnail_hash,
                'photo_hash': photo.photo_hash,
                'path': photo.get_path(),
                'has_raw': photo.has_raw,
                'has_orig': photo.has_orig,
                'duration_text': duration_text,
                'megapixels': photo.megapixels,
                'dimensions': f"{photo.width or 0} × {photo.height or 0}" if (photo.width and photo.height) else "",
                'info': info_dict,
                'info_json': json.dumps(info_dict),
            })

        summary = {
            'count': len(top_photos),
            'photo_count': photo_count,
            'video_count': video_count,
            'tot_size_str': get_size_str(tot_size_sum),
            'opt_size_str': get_size_str(opt_size_sum),
            'overhead_str': get_size_str(max(0, tot_size_sum - opt_size_sum)),
            'total_duration_str': get_duration_str(total_duration_sec),
            'max_mp': round(max_mp, 1),
        }

    top_photos_meta_json = json.dumps({p['id']: p['info'] for p in top_photos})

    context = {
        "active_page": "superlatives",
        "category": category,
        "item_categories": ITEM_CATEGORIES,
        "day_categories": DAY_CATEGORIES,
        "current_category": current_category,
        "is_day_category": is_day_category,
        "left_sidebar": True,
        "right_sidebar": False,
        "admin_override": admin_override,
        "limit": limit,
        "top_photos": top_photos,
        "top_days": top_days,
        "top_photos_meta_json": top_photos_meta_json,
        "summary": summary,
    }
    return render(request, 'photos/superlatives.html', context)


# --- Search Features ---

ID_TO_NAME_MAPPING = {}
for name, idx in NAME_TO_ID_MAPPING.items():
    if idx not in ID_TO_NAME_MAPPING:
        ID_TO_NAME_MAPPING[idx] = []
    ID_TO_NAME_MAPPING[idx].append(name)


def search_page(request):
    if not request.user.is_authenticated:
        return redirect("/accounts/login/?next=" + request.path)

    context = {
        "active_page": "search",
        "left_sidebar": True,
        "right_sidebar": False,
    }
    return render(request, "photos/search.html", context)


def search_category(request, category):
    if not request.user.is_authenticated:
        return redirect("/accounts/login/?next=" + request.path)

    from django.db import connection

    album_subs = request.user.album_subscribed.filter(visible=True)
    albums = [i.album for i in album_subs]
    user_photos = visible(Photo.objects.filter(album__in=albums), request)

    items = []
    category_name = ""

    if category == "objects":
        category_name = "Objects"
        album_ids = list(user_photos.values_list('album_id', flat=True).distinct())
        if album_ids:
            with connection.cursor() as cursor:
                if connection.vendor == 'postgresql':
                    cursor.execute("""
                        SELECT elem::int AS object_id, COUNT(*) AS count
                        FROM photos_photo,
                             jsonb_array_elements_text(COALESCE(ai_index_info->'objects', '[]'::jsonb)) AS elem
                        WHERE album_id = ANY(%s) AND NOT hidden
                        GROUP BY object_id
                    """, [album_ids])
                else:  # SQLite (local testing)
                    marks = ",".join("%s" for _ in album_ids)
                    cursor.execute(f"""
                        SELECT CAST(j.value AS INTEGER) AS object_id, COUNT(*) AS count
                        FROM photos_photo, json_each(photos_photo.ai_index_info, '$.objects') AS j
                        WHERE album_id IN ({marks}) AND NOT hidden
                        GROUP BY object_id
                    """, album_ids)  # noqa: S608 - placeholders only
                rows = cursor.fetchall()
            if show_hidden(request):  # the owner's own hidden photos (few), counted in Python
                extra = Counter()
                for info in user_photos.filter(hidden=True).values_list('ai_index_info', flat=True):
                    extra.update(int(o) for o in set((info or {}).get('objects') or []))
                merged = Counter(dict(rows))
                merged.update(extra)
                rows = list(merged.items())

            for object_id, count in rows:
                names = ID_TO_NAME_MAPPING.get(object_id, [])
                if names:
                    display_names = [n.replace("_", " ").title() for n in names]
                    display_name = " / ".join(display_names)
                    filter_val = ",".join(names)
                    items.append({
                        "display": display_name,
                        "filter_val": filter_val,
                        "count": count,
                    })
        items.sort(key=lambda x: x["count"], reverse=True)

    elif category == "cameras":
        category_name = "Camera Models"
        counts = (
            user_photos.exclude(camera_model__isnull=True)
            .exclude(camera_model="")
            .values("camera_make", "camera_model")
            .annotate(count=Count("id"))
            .order_by("-count")
        )
        for item in counts:
            make = item["camera_make"]
            model = item["camera_model"]
            if make and model:
                if model.lower().startswith(make.lower()):
                    display_name = model
                else:
                    display_name = f"{model} ({make})"
            elif model:
                display_name = model
            else:
                display_name = make or "Unknown"

            items.append({
                "display": display_name,
                "filter_val": model,
                "count": item["count"],
            })

    elif category == "countries":
        category_name = "Countries"
        counts = (
            user_photos.exclude(altitude__gte=PLANE_ALTITUDE_M)
            .exclude(location_country__isnull=True)
            .exclude(location_country="")
            .values("location_country")
            .annotate(count=Count("id"))
            .order_by("-count")
        )
        for item in counts:
            items.append({
                "display": item["location_country"],
                "filter_val": item["location_country"],
                "count": item["count"],
            })

    elif category == "cities":
        category_name = "Cities"
        counts = (
            user_photos.exclude(altitude__gte=PLANE_ALTITUDE_M)
            .exclude(location_city__isnull=True)
            .exclude(location_city="")
            .values("location_city", "location_country")
            .annotate(count=Count("id"))
            .order_by("-count")
        )
        for item in counts:
            display_name = f"{item['location_city']}, {item['location_country']}" if item['location_country'] else item['location_city']
            items.append({
                "display": display_name,
                "filter_val": item["location_city"],
                "count": item["count"],
            })
    else:
        return redirect("search_page")

    context = {
        "active_page": "search",
        "left_sidebar": True,
        "right_sidebar": False,
        "category": category,
        "category_name": category_name,
        "items": items,
    }
    return render(request, "photos/search_category.html", context)


ALLOWED_MEDIA_EXTENSIONS = {
    "jpg", "jpeg", "png", "mp4", "mpg", "m4v", "mov", "mod", "avi", "3gp", "mkv", "gif", "heic", "webp"
}
UPLOAD_TARGET_DIR = settings.UPLOADS_DIR


def upload_photos(request):
    """Google Drive style uploader view for ingesting photos and videos with full metadata preservation."""
    recipient_name = getattr(settings, 'PHOTOS_UPLOAD_RECIPIENT_NAME', 'Amol Venkataraman')

    # Check if upload route is enabled in settings
    if not getattr(settings, 'ALLOW_PHOTO_UPLOADS', True):
        if request.headers.get('x-requested-with') == 'XMLHttpRequest' or 'multipart/form-data' in request.content_type:
            return JsonResponse({'status': 'error', 'message': 'Photo uploads are currently disabled.'}, status=403)
        return render(request, "photos/upload.html", {
            "active_page": "upload",
            "left_sidebar": False,
            "right_sidebar": False,
            "recipient_name": recipient_name,
            "uploads_disabled": True,
        }, status=403)

    if request.method == "POST":
        uploaded_files = request.FILES.getlist('files') or request.FILES.getlist('file')
        if not uploaded_files and len(request.FILES) > 0:
            uploaded_files = list(request.FILES.values())

        if not uploaded_files:
            return JsonResponse({'status': 'error', 'message': 'No files provided for upload.'}, status=400)

        os.makedirs(UPLOAD_TARGET_DIR, exist_ok=True)

        saved_files = []
        errors = []

        for f in uploaded_files:
            # Strip path elements to prevent directory traversal
            orig_name = Path(f.name).name
            ext = orig_name.split('.')[-1].lower() if '.' in orig_name else ''

            if ext not in ALLOWED_MEDIA_EXTENSIONS:
                errors.append(f"File '{orig_name}' has an unsupported extension (.{ext}).")
                continue

            # Ensure unique filename to prevent accidental overwriting
            target_path = os.path.join(UPLOAD_TARGET_DIR, orig_name)
            base_name, file_ext = os.path.splitext(orig_name)
            counter = 1
            while os.path.exists(target_path):
                target_path = os.path.join(UPLOAD_TARGET_DIR, f"{base_name}_{counter}{file_ext}")
                counter += 1

            try:
                # Write raw chunks directly to disk to preserve 100% EXIF & video metadata
                with open(target_path, 'wb+') as destination:
                    for chunk in f.chunks():
                        destination.write(chunk)
                saved_files.append(os.path.basename(target_path))
            except Exception as e:
                errors.append(f"Failed to save '{orig_name}': {str(e)}")

        if not saved_files and errors:
            return JsonResponse({'status': 'error', 'message': '; '.join(errors)}, status=400)

        return JsonResponse({
            'status': 'success',
            'saved_count': len(saved_files),
            'files': saved_files,
            'errors': errors
        })

    # GET request
    context = {
        "active_page": "upload",
        "left_sidebar": False,
        "right_sidebar": False,
        "recipient_name": recipient_name,
        "allowed_extensions": sorted(list(ALLOWED_MEDIA_EXTENSIONS)),
        "uploads_disabled": False,
    }
    return render(request, "photos/upload.html", context)



