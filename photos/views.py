from django.shortcuts import render
from django.db.models import Q
from django.http import HttpResponse, JsonResponse, FileResponse
from django.contrib.auth.decorators import login_required
from django.utils import timezone
from wsgiref.util import FileWrapper
from .models import *
from scheduler.models import *
from .indeximg import photo_ingest_for_album
from Comptech.settings import BASE_DIR, TIME_ZONE

from PIL import Image, ExifTags, ImageOps
from Comptech.utils import *
import datetime
import dateparser
import pytz
import json

# Create your views here.
@login_required
def photos(request):
    album_subs = request.user.album_subscribed.all()
    albums = [i.album for i in album_subs]

    rd = request.GET.get('date')
    if rd == None:
        try:
            if (request.GET.get('north') and request.GET.get('south') and request.GET.get('east') and request.GET.get('west')):
                bounds = {"north": request.GET.get('north'), "south": request.GET.get('south'), "east": request.GET.get('east'), "west": request.GET.get('west')}
                newest = Photo.objects.filter(album__in=albums, latitude__lte=request.GET.get('north'), latitude__gte=request.GET.get('south'), longitude__gte=request.GET.get('west'), longitude__lte=request.GET.get('east')).order_by('date_taken').reverse()[0].date_taken.date() + datetime.timedelta(days=1)
            else:
                bounds = None
                newest = Photo.objects.filter(album__in=albums).order_by('-date_taken')[0].date_taken.date() + datetime.timedelta(days=1)
        except IndexError: newest = None
    else:
        newest = dateparser.parse(request.GET.get('date')).date()
        bounds = None

    return render(request, 'photos/photos.html', { 'newest': datetime.datetime.strftime(newest, "%Y-%m-%d"), 'forward': request.GET.get('forward') == '1', 'bounds': bounds, "left_sidebar": True, "right_sidebar": True})

@login_required
def map(request):
    year = request.GET.get('year')
    year1 = request.GET.get('year-')
    alt = request.GET.get('alt-')
    vals = request.GET.get('vals')
    spec = request.GET.get('special')

    album_subs = request.user.album_subscribed.all()
    albums = [i.album for i in album_subs]

    photos = Photo.objects.filter(album__in=albums, latitude__isnull=False, longitude__isnull=False)

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

    if request.GET.get('date'):
        photos = photos.filter(date_taken__date=dateparser.parse(request.GET.get('date')).date())

    if vals:
        return JsonResponse({ 'coords': [[i.latitude, i.longitude] for i in photos] })
    else:
        return render(request, 'photos/map.html', { 'coords': [[i.latitude, i.longitude] for i in photos] })

@login_required
def geoguessr(request):
    album_subs = request.user.album_subscribed.all()
    albums = [i.album for i in album_subs]

    photo = Photo.objects.filter(album__in=albums, latitude__isnull=False, longitude__isnull=False).exclude(latitude=0, longitude=0).order_by("?").first()

    return render(request, 'photos/geoguessr.html', { 'photo': {**photo.getinfo_zip(), **photo.get_gps_data()} })

@login_required
def geoguessr_ent(request):
    if request.method == "GET":
        album_subs = request.user.album_subscribed.all()
        albums = [i.album for i in album_subs]

        oq = Q(video=False)

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
    album_subs = request.user.album_subscribed.all()
    albums = [i.album for i in album_subs]

    context = {'photos':
        [i.getinfo_zip() for i in Photo.objects.filter(album__in=albums, date_taken__date=datetime.datetime.strptime(f"{year}-{month}-{day}", "%Y-%m-%d").date()).order_by('date_taken')]
    }
    return render(request, 'photos/day.html', context)

@login_required
def event(request, event_id):
    album_subs = request.user.album_subscribed.all()
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

@login_required_api
def get_photos_for_date(request):
    album_subs = request.user.album_subscribed.all()
    albums = [i.album for i in album_subs]

    photos = Photo.objects.filter(album__in=albums)

    if (request.GET.get('north') and request.GET.get('south') and request.GET.get('east') and request.GET.get('west')):
        photos = photos.filter(latitude__gte=request.GET.get('south'), latitude__lte=request.GET.get('north'), longitude__gte=request.GET.get('west'), longitude__lte=request.GET.get('east'))

    dt = dateparser.parse(request.GET.get('date')).date()
    if request.GET.get('forward') == '1':
        photos = photos.filter(date_taken__date__gte=dt).order_by('date_taken')
    else:
        photos = photos.filter(date_taken__date__lte=dt).order_by('-date_taken')

    p1 = photos.filter(date_taken__date=dt)
    print(f"{dateparser.parse(request.GET.get('date')).date()} -> {datetime.datetime.strftime(timezone.localtime(photos[p1.count()].date_taken, pytz.timezone(TIME_ZONE)).date(), '%Y-%m-%d') if photos.count() > p1.count() else 'NONE'}")

    return JsonResponse({
        'photos': [i.getinfo_zip() for i in p1],
        'next': datetime.datetime.strftime(timezone.localtime(photos[p1.count()].date_taken, pytz.timezone(TIME_ZONE)).date(), "%Y-%m-%d") if photos.count() > p1.count() else "NONE"
    })

@login_required_api
def get_photo(request, photo_id, ret_type):
    album_subs = request.user.album_subscribed.all()
    albums = [i.album for i in album_subs]

    try:
        photo = Photo.objects.filter(id=photo_id)[0]
    except:
        return error_response("Invalid photo")

    if photo.album in albums or request.user.is_superuser:
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
                    thumb.thumbnail((500, 200), Image.ANTIALIAS)

                    response = HttpResponse(content_type='image/jpeg')
                    thumb.save(response, "JPEG")
                    return response

            else:
                response = HttpResponse(content_type='image/jpeg')
                response['X-Accel-Redirect'] = f"/media_private/photo_cache/thumbnail/{photo.id}.jpg"
                response['Content-Disposition'] = f'attachment; filename="{BASE_DIR}media_private/photo_cache/thumbnail/{photo.id}.jpg"'
                return response
        else:
            return error_response("Invalid return type")
    else:
        return error_response("Not authorized", 401)

@login_required_api
def ingest_photos(request):
    try:
        for album in Album.objects.filter(owner=request.user).order_by('id'):
            photo_ingest_for_album(album, request.user)
        
        return success_response("Ingested")
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
