from django.shortcuts import render
from django.db.models import Q, Count, Sum
from django.http import HttpResponse, JsonResponse, FileResponse
from django.contrib.auth.decorators import login_required
from django.utils import timezone
from wsgiref.util import FileWrapper
from .models import *
from .indeximg import photo_ingest_for_album
from .tasks import ingest_all_photos
from .AI.objects import NAME_TO_ID_MAPPING
from scheduler.models import *
from Comptech.settings import BASE_DIR, TIME_ZONE

from PIL import Image, ExifTags, ImageOps
from Comptech.utils import *
import datetime
import dateparser
import pytz
import json


# Create your views here.
# @login_required
def photos(request):
    album_obj = None
    is_owner = False
    if request.GET.get('album'):
        album = ShareAlbum.objects.filter(id=request.GET.get('album'))
        if album.exists():
            album_obj = album[0]
            is_owner = request.user.is_authenticated and (album_obj.owner == request.user or request.user.is_superuser)
            if album_obj.public or \
                request.user.is_authenticated and (
                    ShareAlbum_Subscriber.objects.filter(album=album_obj, user=request.user).exists() \
                    or album_obj.owner == request.user \
                    or request.user.is_superuser
                ):
                sphotos = ShareAlbum_Photo.objects.filter(sharealbum=album_obj)
                photos = Photo.objects.filter(id__in=[i.photo.id for i in sphotos]).order_by('-date_taken')
            else:
                return error_response("Not authorized", 401)
        else:
            return error_response("Album does not exist", 404)
    else:
        if not request.user.is_authenticated:
            return redirect("/accounts/login/?next=" + request.path)
        album_subs = request.user.album_subscribed.filter(visible=True)
        albums = [i.album for i in album_subs]
        album = None

        photos = Photo.objects.filter(album__in=albums).order_by('-date_taken')

    if request.GET.get("video") == "1":
        photos = photos.filter(video=True)
        video_only = True
    else: video_only = False

    if request.GET.get("camera_make"):
        cam_make = request.GET.get("camera_make")
        photos = photos.filter(camera_make__icontains=cam_make)
    else:
        cam_make = None

    if request.GET.get('country'):
        country = request.GET.get('country')
        photos = photos.filter(location_country=country)
    else:
        country = None

    if request.GET.get('city'):
        city = request.GET.get('city')
        photos = photos.filter(location_city=city)
    else:
        city = None

    if request.GET.get('objects'):
        raw_objects = request.GET.get('objects').strip().lower().split(",")
        
        object_ids = [
            NAME_TO_ID_MAPPING[obj.strip()] 
            for obj in raw_objects 
            if obj.strip() in NAME_TO_ID_MAPPING
        ]

        if object_ids:
            photos = photos.filter(ai_index_info__objects__contains=object_ids)
        else:
            photos = photos.none() 
        
        objects_ = object_ids
    else:
        objects_ = None


    rd = request.GET.get('date')
    if rd == None:
        try:
            if (request.GET.get('north') and request.GET.get('south') and request.GET.get('east') and request.GET.get('west')):
                bounds = {"north": request.GET.get('north'), "south": request.GET.get('south'), "east": request.GET.get('east'), "west": request.GET.get('west')}
                photos = photos.filter(
                    latitude__lte=request.GET.get('north'),
                    latitude__gte=request.GET.get('south'),
                    longitude__gte=request.GET.get('west'),
                    longitude__lte=request.GET.get('east')
                ).order_by('-date_taken')
                newest = photos[0].date_taken.date() + datetime.timedelta(days=1)
            else:
                bounds = None
                newest = photos[0].date_taken.date() + datetime.timedelta(days=1)
        except IndexError: newest = None
        date_filter = None  # Not explicitly provided
    else:
        newest = dateparser.parse(request.GET.get('date')).date()
        bounds = None
        date_filter = datetime.datetime.strftime(newest, "%Y-%m-%d")  # Explicitly provided

    ntotal = photos.count()

    # Set defaults when no photos are found
    if ntotal == 0:
        nphotos = 0
        nvideos = 0
        fyear = None
        lyear = None
        countries = 0
        no_photos = True
    else:
        nphotos = photos.filter(video=False).count()
        nvideos = ntotal - nphotos
        fyear = photos[0].date_taken.year
        lyear = photos.reverse()[0].date_taken.year
        countries = photos.filter(Q(location_country__isnull=False) & Q(Q(altitude__isnull=True) | Q(altitude__lte=1000))).values_list('location_country').distinct().count()
        no_photos = False

    return render(request, 'photos/photos.html', {
        'newest': datetime.datetime.strftime(newest, "%Y-%m-%d") if newest else None,
        'date_filter': date_filter,  # Only set when explicitly provided
        'forward': request.GET.get('forward') == '1',
        'bounds': bounds,
        "left_sidebar": True,
        "right_sidebar": True,
        "video": video_only,
        "cam_make": cam_make,
        "country": country,
        "city": city,
        "objects": ",".join([f"{i}" for i in objects_]) if objects_ else None,
        "share_album": album_obj.id if album_obj else None,
        "album_obj": album_obj,
        "is_owner": is_owner,
        "ntotal": ntotal,
        "nphotos": nphotos,
        "nvideos": nvideos,
        "drange": f"{lyear}-{fyear}" if fyear and lyear else "N/A",
        "countries": countries,
        "no_photos": no_photos,
        "active_page": "photos"
    })

@login_required
def my_albums_page(request):
    ses = ShareAlbum_Subscriber.objects.filter(user=request.user)
    sa = [s.album.getinfo() for s in ses]

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
    alt = request.GET.get('alt-')
    vals = request.GET.get('vals')
    spec = request.GET.get('special')
    f_album = request.GET.get('album')

    album_subs = request.user.album_subscribed.all()
    albums = [i.album.id for i in album_subs]

    if f_album != None: albums = [f_album]

    photos = Photo.objects.filter(album__in=albums, latitude__isnull=False, longitude__isnull=False)
    print(PhotoLocationCache.objects.filter(album_id__in=albums).count())

    if year != None:
        photos = photos.filter(date_taken__year=year)
    elif year1 != None:
        photos = photos.filter(date_taken__year__lte=year1)

    if spec == "1":
        photos = photos.filter(file_not_available=True)
    
    if alt != None:
        if alt == "NIL":
            qry = Q(altitude=None)
        else:
            qry = Q(altitude__lte=alt) | Q(altitude=None)

        photos = photos.filter(qry)


    if vals:
        return JsonResponse({ 'coords': [[i.latitude, i.longitude] for i in photos] })
    else:
        return render(request, 'photos/map.html', { 'coords': [[i.latitude, i.longitude] for i in photos] })

@login_required
def map_new(request):
    year = request.GET.get('year')
    year1 = request.GET.get('year-')
    op = request.GET.get('op')
    vals = request.GET.get('vals')
    f_album = request.GET.get('album')

    album_subs = request.user.album_subscribed.filter(visible=True)
    albums = [i.album.id for i in album_subs]

    if f_album != None: albums = [f_album]

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
        return render(request, 'photos/map.html', { "coords": [[float(i['lat']), float(i['lng']), i['total_cnt']] for i in locs], "new_format": True })

@login_required
def geoguessr(request):
    album_subs = request.user.album_subscribed.filter(visible=True)
    albums = [i.album for i in album_subs]

    photo = Photo.objects.filter(album__in=albums, latitude__isnull=False, longitude__isnull=False).exclude(latitude=0, longitude=0).order_by("?").first()

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
            photo = Photo.objects.filter(oq & Q(album__in=albums) & (Q(latitude=0) & Q(longitude=0))).order_by('-date_taken').first()
        else:
            photo = Photo.objects.filter(oq & Q(album__in=albums) & (Q(latitude__isnull=True) | Q(longitude__isnull=True))).order_by("?").first()

        return render(request, 'photos/geoguessr_ent.html', { 'photo': photo.getinfo_zip() })

    elif request.method == "POST":
        b = json.loads(request.body.decode('utf8'))

        album_subs = request.user.album_subscribed.all()
        albums = [i.album for i in album_subs]

        p = Photo.objects.filter(id=b['photo'])[0]
        if p.album in albums:
            p.latitude = b['lat']
            p.longitude = b['lng']
            p.save()
            print(f"Saved location ({b['lat']}, {b['lng']}) for photo {b['photo']}")
            with open("/home/user/photo_gg_ent_log.txt", "a") as f:
                f.write(f"{b['photo']} --> ({b['lat']}, {b['lng']}) [{request.user.username}]\n")
            return success_response("Success!")
        else: return error_response("Not authorized", 401)

@login_required
def day(request, year, month, day):
    album_subs = request.user.album_subscribed.filter(visible=True)
    albums = [i.album for i in album_subs]

    date_str = f"{year}-{month}-{day}"
    context = {
        'title': f"Photos from {date_str}",
        'photos': [i.getinfo_zip() for i in Photo.objects.filter(album__in=albums, date_taken__date=datetime.datetime.strptime(date_str, "%Y-%m-%d").date()).order_by('date_taken')]
    }
    return render(request, 'photos/day.html', context)

@login_required
def event(request, event_id):
    album_subs = request.user.album_subscribed.filter(visible=True)
    albums = [i.album for i in album_subs]

    try:
        e = Event.objects.filter(id=event_id)[0]

        if e.enddate == None: return error_response("Event is not bounded on the end time.")
        context = {
            'title': f"Photos from Event: {e.name}",
            'photos': [i.getinfo_zip() for i in Photo.objects.filter(album__in=albums, date_taken__gte=e.startdate, date_taken__lte=e.enddate).order_by('date_taken')]
        }
        return render(request, 'photos/day.html', context)
    except IndexError: return error_response("Invalid event")

@login_required
def view_photo(request, photo_id):
    album_subs = request.user.album_subscribed.all()
    albums = [i.album for i in album_subs]

    try:
        p = Photo.objects.filter(id=photo_id)[0]
        if p.album in albums or request.user.is_superuser:
            return render(request, 'photos/view_photo.html', { 'video': p.video, 'p_id': p.id, 'img_path': f"/photo_cdn/{p.photo_hash}/{p.get_path()}" })
        else:
            return error_response("Not authorized", 401)
    except IndexError: pass

def get_photos_for_date(request):
    if request.GET.get('album'):
        album = ShareAlbum.objects.filter(id=request.GET.get('album'))
        if album.exists():
            if album[0].public or \
                request.user.is_authenticated and (
                    ShareAlbum_Subscriber.objects.filter(album=album[0], user=request.user).exists() \
                    or album[0].owner == request.user \
                    or request.user.is_superuser
                ):
                sphotos = ShareAlbum_Photo.objects.filter(sharealbum=album[0])
                photos = Photo.objects.filter(id__in=[i.photo.id for i in sphotos]).order_by('-date_taken')
            else:
                return error_response("Not authorized", 401)
        else:
            return error_response("Album does not exist", 404)
    else:
        if not request.user.is_authenticated:
            return error_response("Not logged in", 401)

        album_subs = request.user.album_subscribed.filter(visible=True)
        albums = [i.album for i in album_subs]

        photos = Photo.objects.filter(album__in=albums)

    if request.GET.get("video") == "1":
        photos = photos.filter(video=True)

    numdays = int(request.GET.get("ndays")) if request.GET.get("ndays") else None
    numphotos = int(request.GET.get("nphotos")) if request.GET.get("nphotos") else None
    donedays = 0
    donephotos = 0
    next = None

    ans = []

    while (numdays is None and numphotos is None and donedays == 0) or ((numdays is None or donedays < numdays) and (numphotos is None or donephotos < numphotos)):
        if (request.GET.get('north') and request.GET.get('south') and request.GET.get('east') and request.GET.get('west')):
            photos = photos.filter(latitude__gte=request.GET.get('south'), latitude__lte=request.GET.get('north'), longitude__gte=request.GET.get('west'), longitude__lte=request.GET.get('east'))

        dt = next if next else dateparser.parse(request.GET.get('date')).date()

        if request.GET.get('forward') == '1':
            photos = photos.filter(date_taken__date__gte=dt).order_by('date_taken')
        else:
            photos = photos.filter(date_taken__date__lte=dt).order_by('-date_taken')

        if request.GET.get('camera_make') != None:
            photos = photos.filter(camera_make__icontains=request.GET.get('camera_make'))

        if request.GET.get('country') != None:
            photos = photos.filter(location_country=request.GET.get('country'))

        if request.GET.get('city') != None:
            photos = photos.filter(location_city=request.GET.get('city'))

        if request.GET.get('objects') != None:
            try:
                object_ids = [int(x.strip()) for x in request.GET.get('objects').split(',') if x.strip()]
                photos = photos.filter(ai_index_info__objects__contains=object_ids)
            except ValueError:
                photos = photos.none()

        p1 = photos.filter(date_taken__date=dt)

        citcount = p1.filter(location_city__isnull=False, location_country__isnull=False).values_list('location_city', 'location_country').annotate(count=Count('id')).order_by('-count')

        ans.append({
            'date': datetime.datetime.strftime(dt, "%Y-%m-%d"),
            'photos': [i.getinfo_zip() for i in p1],
            'cities': [list(i) for i in citcount],
        })

        next = timezone.localtime(photos[p1.count()].date_taken, pytz.timezone(TIME_ZONE)).date() if photos.count() > p1.count() else None

        donedays += 1
        donephotos += p1.count()

        if (numdays is None and numphotos is None) or next is None:
            break


    return JsonResponse({
        "photos": ans,
        "next": datetime.datetime.strftime(next, "%Y-%m-%d") if next else None
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
                sp = ShareAlbum_Photo.objects.filter(photo__id=photo_id, sharealbum=album[0])
                try:
                    photo = sp[0].photo
                except IndexError:
                    return error_response("Invalid photo")
            else:
                return error_response("Not authorized", 401)
        else:
            return error_response("Album does not exist", 404)

    else:
        album_subs = request.user.album_subscribed.all()
        albums = [i.album for i in album_subs]

        try:
            photo = Photo.objects.filter(id=photo_id)[0]
        except:
            return error_response("Invalid photo")

        if photo.album not in albums and not request.user.is_superuser:
            return error_response("Not authorized", 401)


    if ret_type == "info":
        return JsonResponse(photo.getinfo())
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
            response = HttpResponse(content_type='image/webp')
            response['X-Accel-Redirect'] = f"/media_private/photo_cache/thumbnail/{photo.id}.webp"
            response['Content-Disposition'] = f'attachment; filename="{BASE_DIR}media_private/photo_cache/thumbnail/{photo.id}.webp"'
            return response
    else:
        return error_response("Invalid return type")

@login_required_api
def ingest_photos(request):
    try:
        ingest_all_photos.delay(user_id=request.user.id)
        
        return success_response("Ingest started")
    except Exception as ex:
        return error_response(f"A(n) {type(ex).__name__} occurred. {ex.args}", 500)

@post_request_only
@login_required_api
def del_photo_req(request, photo_id):
    album_subs = request.user.album_subscribed.all()
    albums = [i.album for i in album_subs]

    try:
        p = Photo.objects.filter(id=photo_id)[0]
        if p.album in albums or request.user.is_superuser:
            delete_photo(p)
            return success_response()
        else:
            return error_response("Not authorized", 401)
    except IndexError: pass


@login_required_api
def list_my_albums(request):
    if request.GET.get('all') == '1':
        ses = ShareAlbum_Subscriber.objects.filter(user=request.user)
        sa = [s.album.getinfo() for s in ses]

    else:
        sas = ShareAlbum.objects.filter(owner=request.user)
        sa = [album.getinfo() for album in sas]
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

    for pid in photo_id:
        try:
            p = Photo.objects.get(id=pid)
        except Photo.DoesNotExist:
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

    return success_response()

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
                
            try:
                target_user = ComptechUser.objects.get(username=username)
            except ComptechUser.DoesNotExist:
                return error_response("User not found", 404)
                
            if ShareAlbum_Subscriber.objects.filter(album=album, user=target_user).exists():
                return error_response("User is already subscribed", 400)
                
            sub = ShareAlbum_Subscriber(album=album, user=target_user, subscribe_type=sub_type)
            sub.save()
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


@login_required_api
def toggle_album_visibility(request, album_id):
    try:
        sub = request.user.album_subscribed.get(album_id=album_id)
        sub.visible = not sub.visible
        sub.save()
        return success_response({"visible": sub.visible})
    except Album_Subscriber.DoesNotExist:
        return error_response("Album subscription not found", 404)

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
    qs = Photo.objects.filter(album__in=albums)

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

    # Camera makes/models
    cameras = qs.exclude(camera_model__isnull=True).exclude(camera_model='').values('camera_make', 'camera_model').annotate(count=Count('id')).order_by('-count')[:5]

    # Average Megapixels
    avg_mp = qs.filter(video=False, megapixels__isnull=False).aggregate(Avg('megapixels'))['megapixels__avg'] or 0
    avg_mp = round(avg_mp, 1)

    # Collect monthly and hourly data
    dates_and_types = qs.filter(date_taken__isnull=False).values_list('date_taken', 'video')

    from collections import defaultdict
    month_histogram = defaultdict(lambda: {'all': 0, 'photo': 0, 'video': 0})
    year_histogram = defaultdict(lambda: {'all': 0, 'photo': 0, 'video': 0})
    hour_histogram = defaultdict(lambda: {'all': 0, 'photo': 0, 'video': 0})

    for dt, is_video in dates_and_types:
        month_str = dt.strftime('%Y-%m')
        year_str = dt.strftime('%Y')
        hr = dt.hour
        key = 'video' if is_video else 'photo'

        month_histogram[month_str]['all'] += 1
        month_histogram[month_str][key] += 1

        year_histogram[year_str]['all'] += 1
        year_histogram[year_str][key] += 1

        hour_histogram[hr]['all'] += 1
        hour_histogram[hr][key] += 1

    # Hourly histogram (0 to 23)
    hours_labels = [f"{h:02d}:00" for h in range(24)]
    hours_data_all = [hour_histogram[h]['all'] for h in range(24)]
    hours_data_photo = [hour_histogram[h]['photo'] for h in range(24)]
    hours_data_video = [hour_histogram[h]['video'] for h in range(24)]

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

    # Past 24 months
    months_24_labels = months_60_labels[-24:]
    months_24_all = months_60_all[-24:]
    months_24_photo = months_60_photo[-24:]
    months_24_video = months_60_video[-24:]

    # Past 12 months
    months_12_labels = months_60_labels[-12:]
    months_12_all = months_60_all[-12:]
    months_12_photo = months_60_photo[-12:]
    months_12_video = months_60_video[-12:]

    # 10 years yearly
    this_year = now.year
    years_10_labels = [str(y) for y in range(this_year - 9, this_year + 1)]
    years_10_all = [year_histogram[y]['all'] for y in years_10_labels]
    years_10_photo = [year_histogram[y]['photo'] for y in years_10_labels]
    years_10_video = [year_histogram[y]['video'] for y in years_10_labels]

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
        "taken_month": taken_month,
        "taken_ytd": taken_ytd,
        "taken_year": taken_year,
        "cameras": list(cameras),
        "avg_mp": avg_mp,
        "hours_labels": hours_labels,
        "hours_data_all": hours_data_all,
        "hours_data_photo": hours_data_photo,
        "hours_data_video": hours_data_video,
        "months_12_labels": months_12_labels,
        "months_12_data_all": months_12_all,
        "months_12_data_photo": months_12_photo,
        "months_12_data_video": months_12_video,
        "months_24_labels": months_24_labels,
        "months_24_data_all": months_24_all,
        "months_24_data_photo": months_24_photo,
        "months_24_data_video": months_24_video,
        "months_60_labels": months_60_labels,
        "months_60_data_all": months_60_all,
        "months_60_data_photo": months_60_photo,
        "months_60_data_video": months_60_video,
        "years_10_labels": years_10_labels,
        "years_10_data_all": years_10_all,
        "years_10_data_photo": years_10_photo,
        "years_10_data_video": years_10_video,
        "all_years_labels": sorted_all_years,
        "all_years_data_all": all_years_all,
        "all_years_data_photo": all_years_photo,
        "all_years_data_video": all_years_video,
    }
    return render(request, 'photos/stats.html', context)


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

    return {
        'all': {'opt': all_opt, 'tot': all_tot, 'cnt': all_cnt, 'overhead': all_tot - all_opt},
        'photo': {'opt': photo_opt, 'tot': photo_tot, 'cnt': photo_cnt, 'overhead': photo_tot - photo_opt},
        'video': {'opt': video_opt, 'tot': video_tot, 'cnt': video_cnt, 'overhead': video_tot - video_opt},
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
    qs = Photo.objects.filter(album__in=albums)

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
        album_qs = Photo.objects.filter(album=album)
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
                                      'video_opt': 0, 'video_tot': 0, 'video_cnt': 0})
    for dt, opt, tot, is_video in qs.filter(date_taken__isnull=False).values_list('date_taken', 'size', 'size_total', 'video'):
        yr = dt.year
        opt_val = opt or 0
        tot_val = tot or 0
        year_stats[yr]['all_opt'] += opt_val
        year_stats[yr]['all_tot'] += tot_val
        year_stats[yr]['all_cnt'] += 1
        if is_video:
            year_stats[yr]['video_opt'] += opt_val
            year_stats[yr]['video_tot'] += tot_val
            year_stats[yr]['video_cnt'] += 1
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
                                       'video_opt': 0, 'video_tot': 0, 'video_cnt': 0})
    for dt, opt, tot, is_video in qs.filter(date_taken__isnull=False).values_list('date_taken', 'size', 'size_total', 'video'):
        m_str = dt.strftime('%Y-%m')
        opt_val = opt or 0
        tot_val = tot or 0
        month_stats[m_str]['all_opt'] += opt_val
        month_stats[m_str]['all_tot'] += tot_val
        month_stats[m_str]['all_cnt'] += 1
        if is_video:
            month_stats[m_str]['video_opt'] += opt_val
            month_stats[m_str]['video_tot'] += tot_val
            month_stats[m_str]['video_cnt'] += 1
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


