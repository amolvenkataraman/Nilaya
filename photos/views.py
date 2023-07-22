from django.shortcuts import render
from django.http import HttpResponse, JsonResponse, FileResponse
from django.contrib.auth.decorators import login_required
from django.utils import timezone
from .models import *
from scheduler.models import *
from Comptech.settings import BASE_DIR, TIME_ZONE

from PIL import Image, ExifTags, ImageOps
from Comptech.utils import *
import datetime
import dateparser
import pytz

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
                newest = timezone.localtime(Photo.objects.filter(album__in=albums, latitude__lte=request.GET.get('north'), longitude__gte=request.GET.get('west'), longitude__lte=request.GET.get('east')).order_by('date_taken').reverse()[0].date_taken, pytz.timezone(TIME_ZONE)).date()
            else:
                bounds = None
                newest = timezone.localtime(Photo.objects.filter(album__in=albums).order_by('date_taken').reverse()[0].date_taken, pytz.timezone(TIME_ZONE)).date()
        except IndexError: newest = None
    else:
        newest = dateparser.parse(request.GET.get('date')).date()
        bounds = None

    return render(request, 'photos/photos.html', { 'newest': newest, 'forward': request.GET.get('forward') == '1', 'bounds': bounds, "left_sidebar": True, "right_sidebar": True})

@login_required
def map(request):
    year = request.GET.get('year')
    year1 = request.GET.get('year-')

    album_subs = request.user.album_subscribed.all()
    albums = [i.album for i in album_subs]

    if year == None and year1 == None:
        photos = Photo.objects.filter(album__in=albums, latitude__isnull=False, longitude__isnull=False).exclude(latitude=0, longitude=0)
    elif year != None:
        photos = Photo.objects.filter(album__in=albums, latitude__isnull=False, longitude__isnull=False, date_taken__year=year).exclude(latitude=0, longitude=0)
    elif year1 != None:
        photos = Photo.objects.filter(album__in=albums, latitude__isnull=False, longitude__isnull=False, date_taken__year__lte=year1).exclude(latitude=0, longitude=0)

    return render(request, 'photos/map.html', { 'coords': [[i.latitude, i.longitude] for i in photos] })

@login_required
def geoguessr(request):
    album_subs = request.user.album_subscribed.all()
    albums = [i.album for i in album_subs]

    photo = Photo.objects.filter(album__in=albums, latitude__isnull=False, longitude__isnull=False).exclude(latitude=0, longitude=0).order_by("?").first()

    return render(render, 'photos/geoguessr.html', { 'photo': photo.get_info() })

@login_required
def day(request, year, month, day):
    album_subs = request.user.album_subscribed.all()
    albums = [i.album for i in album_subs]

    context = {'photos':
        [i.get_info() for i in Photo.objects.filter(album__in=albums, date_taken__date=datetime.datetime.strptime(f"{year}-{month}-{day}", "%Y-%m-%d").date()).order_by('date_taken')]
    }
    return render(request, 'photos/day.html', context)

@login_required
def event(request, event_id):
    album_subs = request.user.album_subscribed.all()
    albums = [i.album for i in album_subs]

    try:
        e = Event.objects.filter(id=event_id)[0]

        if e.enddate == None: return error_response("Event is not bounded on the end time.")
        context = { 'photos': [i.get_info() for i in Photo.objects.filter(album__in=albums, date_taken__gte=e.startdate, date_taken__lte=e.enddate).order_by('date_taken')] }
        return render(request, 'photos/day.html', context)
    except IndexError: return error_response("Invalid event")

@login_required_api
def month_stats(request, year, month):
    album_subs = request.user.album_subscribed.all()
    albums = [i.album for i in album_subs]

    pl = [timezone.localtime(i.date_taken, pytz.timezone(TIME_ZONE)).day for i in Photo.objects.filter(album__in=albums, date_taken__month=month, date_taken__year=year)]
    ans = {i:pl.count(i) for i in pl}
    return JsonResponse(ans)

@login_required_api
def get_photos_for_date(request):
    album_subs = request.user.album_subscribed.all()
    albums = [i.album for i in album_subs]

    ord = 'date_taken' if request.GET.get('forward') == '1' else '-date_taken'
    if (request.GET.get('north') and request.GET.get('south') and request.GET.get('east') and request.GET.get('west')):
        photos = Photo.objects.filter(album__in=albums, date_taken__date=dateparser.parse(request.GET.get('date')).date(),
            latitude__gte=request.GET.get('south'), latitude__lte=request.GET.get('north'), longitude__gte=request.GET.get('west'), longitude__lte=request.GET.get('east'))

        if request.GET.get('forward') == '1':
            nphoto = Photo.objects.filter(album__in=albums, date_taken__date=dateparser.parse(request.GET.get('date')).date(),
                latitude__gte=request.GET.get('south'), latitude__lte=request.GET.get('north'), longitude__gte=request.GET.get('west'), longitude__lte=request.GET.get('east'))

        else:
            nphoto = Photo.objects.filter(album__in=albums, date_taken__date=dateparser.parse(request.GET.get('date')).date(),
                latitude__gte=request.GET.get('south'), latitude__lte=request.GET.get('north'), longitude__gte=request.GET.get('west'), longitude__lte=request.GET.get('east'))

    else:
        photos = Photo.objects.filter(album__in=albums, date_taken__date=dateparser.parse(request.GET.get('date')).date())
    return JsonResponse({'photos':
        [i.get_info() for i in photos.order_by(ord)]
    })

@login_required_api
def get_photo(request, photo_id, ret_type):
    album_subs = request.user.album_subscribed.all()
    albums = [i.album for i in album_subs]

    try:
        photo = Photo.objects.filter(id=photo_id)[0]

        if photo.album in albums or request.user.is_superuser:
            if ret_type == "info":
                return JsonResponse(photo.get_info())
            elif ret_type == "thumbnail":
                response = HttpResponse(content_type='image/jpeg')
                response['X-Accel-Redirect'] = f"/thumbnail/{photo.id}.jpg"
                response['Content-Disposition'] = f'attachment; filename="{BASE_DIR}photo_cache/thumbnail/{photo.id}.jpg"'
                return response
            elif ret_type == "image":
                response = HttpResponse(content_type='image/jpeg')
                img = Image.open(photo.album.location + photo.filepath)
                img = ImageOps.exif_transpose(img)
                img.save(response, "JPEG")
                return response
            else:
                return error_response("Invalid return type")
        else:
            return error_response("Not authorized", 401)
    except:
        return error_response("Invalid photo")
