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

    context = {'photos':
        [i.getinfo_zip() for i in Photo.objects.filter(album__in=albums, date_taken__date=datetime.datetime.strptime(f"{year}-{month}-{day}", "%Y-%m-%d").date()).order_by('date_taken')]
    }
    return render(request, 'photos/day.html', context)

@login_required
def event(request, event_id):
    album_subs = request.user.album_subscribed.filter(visible=True)
    albums = [i.album for i in album_subs]

    try:
        e = Event.objects.filter(id=event_id)[0]

        if e.enddate == None: return error_response("Event is not bounded on the end time.")
        context = { 'photos': [i.getinfo_zip() for i in Photo.objects.filter(album__in=albums, date_taken__gte=e.startdate, date_taken__lte=e.enddate).order_by('date_taken')] }
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
