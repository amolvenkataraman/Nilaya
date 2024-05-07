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
import hashlib
import datetime
from pathlib import Path
from PIL import Image, UnidentifiedImageError

def photo_ingest_for_album(album, user):
    SOURCE_DIR = album.location + "Ingest/**"
    DEST_DIR = album.location
    files = [i for i in glob.glob(f"{SOURCE_DIR}/*.*") if str(i).split('.')[-1].lower() in ["jpg", "jpeg", "png", "mp4", "mpg", "m4v", "mov", "mod", "avi", "3gp", "mkv", "gif", "heic"]]

    dtn = datetime.datetime.now()

    for ff in files:
        print(ff)
        try: dt = datetime.datetime.strptime(Image.open(ff)._getexif()[36867], '%Y:%m:%d %H:%M:%S')
        except (UnidentifiedImageError, AttributeError, KeyError, TypeError) as e:
            try:
                dtstr = ff.split("/")[-1].replace("VID_", "")[:15]
                dt = datetime.datetime.strptime(dtstr, "%Y%m%d_%H%M%S")
            except:
                try:
                    dt = datetime.datetime.fromtimestamp(os.path.getmtime(ff))
                except:
                    dt = datetime.datetime.fromtimestamp(os.path.getctime(ff))
        
        if album.split:
            destdir = f"{DEST_DIR}{dt.year}/{dt.month}/"
            destdir1 = f"{dt.year}/{dt.month}/"
        else:
            destdir = f"{DEST_DIR}"
            destdir1 = ""
        if not os.path.exists(destdir): os.makedirs(destdir)

        if os.path.isfile(f"{destdir}{os.path.basename(ff)}"):
            print(f"IGNORED {ff}")

            if (dtn - dt).days >= 30:
                print(f"DELETE {ff}")
                os.remove(ff)

            continue

        shutil.copy(ff, f"{destdir}{os.path.basename(ff)}")
        print(f"{destdir}{os.path.basename(ff)}")

        p = Photo()
        p.owner = user
        p.album = album
        p.filepath = f"{destdir1}{os.path.basename(ff)}"
        p.save()

        print(f"Saved photo {p.id}")

        f = p.album.location + p.filepath #; print(p.id)
        if f.split('.')[-1].lower() in ['mp4', 'mpg', 'm4v', 'mov', "mod", "avi", "3gp", "mkv"]: p.video = True
        else:
            try:
                img = Image.open(f); p.width = img.size[0]; p.height = img.size[1]
                try:
                    gpsdata = gpsphoto.getGPSData(f); p.latitude = gpsdata['Latitude']; p.longitude = gpsdata['Longitude']; p.altitude = gpsdata['Altitude']
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
                dtstr = f.split("/")[-1].replace("VID_", "")[:15]
                dt = datetime.datetime.strptime(dtstr, "%Y%m%d_%H%M%S")
            except:
                try:
                    dt = datetime.datetime.fromtimestamp(os.path.getmtime(f))
                except:
                    dt = datetime.datetime.fromtimestamp(os.path.getctime(f))
        try: p.date_taken = dt   
        except: pass
        p.save()

        try:
            if p.video == False:
                u = p.album.location + p.filepath
                img = Image.open(u)
                img = ImageOps.exif_transpose(img)
                img.thumbnail((500, 200), Image.ANTIALIAS)
                img.save('/www/private/photos_cache/thumbnail/' + str(p.id) + '.jpg', "JPEG")
        except: pass

        fp = (p.album.location + p.filepath + "__HASH_SALT_GOES_HERE__").replace("/mnt/drv0/Photos/", "")
        fp1 = f"photos_cache/thumbnail/{p.id}.jpg__HASH_SALT_GOES_HERE__"
        hash_ = hashlib.md5(fp.encode('utf-8')).hexdigest()
        hash1_ = hashlib.md5(fp1.encode('utf-8')).hexdigest()

        p.photo_hash = hash_
        p.thumbnail_hash = hash1_
        p.save()
