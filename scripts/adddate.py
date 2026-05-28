from django.shortcuts import render
from django.http import HttpResponse, JsonResponse, FileResponse
from django.contrib.auth.decorators import login_required
from photos.models import *
from users.models import *

import exifread
from PIL import Image, ExifTags, ImageOps
from PIL.ExifTags import TAGS, GPSTAGS
from GPSPhoto import gpsphoto
import datetime
import os
import glob
import shutil
import datetime
from pathlib import Path
from PIL import Image, UnidentifiedImageError


for p in Photo.objects.filter(date_taken=None):
    f = p.album.location + p.filepath #; print(p.id)
    if f.split('.')[-1].lower() in ['mp4', 'mpg', 'm4v', 'mov', "mod", "avi", "3gp", "mkv"]: p.video = True
    else:
        try:
            try: img = Image.open(f); p.width = img.size[0]; p.height = img.size[1]
            except FileNotFoundError: p.delete()
            try:
                gpsdata = gpsphoto.getGPSData(f); p.latitude = gpsdata['Latitude']; p.longitude = gpsdata['Longitude']
            except: pass
            p.orientation = 1

            try:
                exif = img._getexif()

                if exif is not None:
                    exif1 = {}
                    for key, value in exif.items():
                        name = TAGS.get(key, key)
                        exif1[name] = exif[key]

                    exif = exif1
                    try:
                        try:
                            p.camera_make = exif['Make'].replace('\x00', '').replace('\00', '').replace('\0', '')
                        except KeyError:
                            pass
                        try:
                            p.camera_model = exif['Model'].replace('\x00', '').replace('\00', '').replace('\0', '')
                        except KeyError:
                            pass
                        try:
                            p.exposure = exif['ExposureTime']
                        except KeyError:
                            pass
                        try:
                            p.fnumber = exif['FNumber']
                        except KeyError:
                            pass
                        try:
                            p.isospeed = exif['ISOSpeedRatings']
                        except KeyError:
                            pass
                        try:
                            p.shutterspeed = exif['ShutterSpeedValue']
                        except KeyError:
                            pass
                        try:
                            p.aperture = exif['ApertureValue']
                        except KeyError:
                            pass
                        try:
                            p.flash = exif['Flash']
                        except KeyError:
                            pass
                        try:
                            p.focallength = exif['FocalLength']
                        except KeyError:
                            pass
                        try:
                            p.orientation = exif['Orientation']
                        except KeyError:
                            pass
                    except TypeError:
                        pass
            except AttributeError: pass
        except UnidentifiedImageError: pass

    try: dt = datetime.datetime.strptime(Image.open(f)._getexif()[36867], '%Y:%m:%d %H:%M:%S')
    except (UnidentifiedImageError, AttributeError, KeyError, TypeError) as e:
        try:
            dt = datetime.datetime.fromtimestamp(os.path.getmtime(f))
        except:
            dt = datetime.datetime.fromtimestamp(os.path.getctime(f))
    try: p.date_taken = dt   
    except: pass
    p.save()

    try:
        p.gen_thumbnail()
    except: pass
