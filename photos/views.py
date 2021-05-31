from django.shortcuts import render
from django.http import HttpResponse, JsonResponse, FileResponse
from django.contrib.auth.decorators import login_required
from .models import *

import exifread
from PIL import Image, ExifTags, ImageOps
from PIL.ExifTags import TAGS, GPSTAGS
from GPSPhoto import gpsphoto
import datetime
import dateparser

# Create your views here.
@login_required(login_url="/users/login")
def photos(request):
    try:
        context = {
            'newest': Photo.objects.filter(owner=request.user).order_by('date_taken').reverse()[0].date_taken.date()
        }
    except IndexError:
        context = {
            'newest': None
        }
    return render(request, 'photo/photos.html', context)

def get_photos_for_date(request):
    return JsonResponse({'photos': 
        [i.get_info() for i in Photo.objects.filter(owner=request.user, date_taken__date=dateparser.parse(request.GET.get('date')).date()).order_by('date_taken')]
    })

def get_photo(request):
    photo_id = request.GET.get("id")
    type_ = request.GET.get("type")
    if photo_id != None and type_ != None:
        try:
            photo = Photo.objects.filter(id=photo_id)[0]
            response = HttpResponse(content_type='image/jpeg')
            img = Image.open(photo.photo.path)
            img = ImageOps.exif_transpose(img)

            if type_ == 'thumbnail':
                img.thumbnail((500, 200), Image.ANTIALIAS)
                img.save(response, "JPEG")
                return response
        except IndexError:
            return HttpResponse("")

def upload_photo(request):
    if request.method == 'POST':
        if request.user.is_authenticated:
            try:
                _ = Photo(owner=request.user)
                _.photo = request.FILES['photo']
                _.save()

                filepath = _.photo.path
                image = Image.open(_.photo.path)

                _.width = image.size[0]
                _.height = image.size[1]

                try:
                    gpsdata = gpsphoto.getGPSData(filepath)
                    _.latitude = gpsdata['Latitude']
                    _.longitude = gpsdata['Longitude']
                except ValueError:
                    pass
                except IndexError:
                    pass
                except KeyError:
                    pass

                exif = image._getexif()

                if exif is not None:
                    exif1 = {}
                    for key, value in exif.items():
                        name = TAGS.get(key, key)
                        exif1[name] = exif[key]


                try:
                    datetaken = datetime.datetime.strptime(exif['DateTime'], "%Y:%m:%d %H:%M:%S")
                except KeyError:
                    try:
                        datetaken = datetime.datetime.strptime(exif['DateTimeOriginal'], "%Y:%m:%d %H:%M:%S")
                    except KeyError:
                        try:
                            datetaken = datetime.datetime.strptime(exif['DateTimeDigitized'], "%Y:%m:%d %H:%M:%S")
                        except KeyError:
                            pass
                except TypeError:
                    pass
                except IndexError:
                    pass

                try:
                    _.date_taken = datetaken
                except UnboundLocalError:
                    _.date_taken = datetime.datetime.now()
                
                
                try:
                    try:
                        _.camera_make = exif['Make']
                    except KeyError:
                        pass
                    try:
                        _.camera_model = exif['Model']
                    except KeyError:
                        pass
                    try:
                        _.exposure = exif['ExposureTime']
                    except KeyError:
                        pass
                    try:
                        _.fnumber = exif['FNumber']
                    except KeyError:
                        pass
                    try:
                        _.isospeed = exif['ISOSpeedRatings']
                    except KeyError:
                        pass
                    try:
                        _.shutterspeed = exif['ShutterSpeedValue']
                    except KeyError:
                        pass
                    try:
                        _.aperture = exif['ApertureValue']
                    except KeyError:
                        pass
                    try:
                        _.flash = exif['Flash']
                    except KeyError:
                        pass
                    try:
                        _.focallength = exif['FocalLength']
                    except KeyError:
                        pass
                except TypeError:
                    pass

                _.save()

                return JsonResponse({'status': 'success', 'data': 'Photos uploaded successfully'})

            except IndexError:
                return JsonResponse({'status': 'error', 'data': 'No file provided'})
        else:
            return JsonResponse({'status': 'error', 'data': 'Not authenticated'})
