from django.shortcuts import render
from django.http import HttpResponse, JsonResponse, FileResponse
from django.contrib.auth.decorators import login_required
from photos.models import *
from photos.models import _reverse_geocode_city
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
import reverse_geocode as rg

def _extract_date_taken(filepath) -> datetime.datetime:
    import re
    # 1. Try to read from EXIF using PIL
    try:
        with Image.open(filepath) as img:
            exif = img._getexif()
            if exif:
                # Try tags in order: 36867 (DateTimeOriginal), 306 (DateTime), 36868 (DateTimeDigitized)
                for tag in (36867, 306, 36868):
                    val = exif.get(tag)
                    if val:
                        try:
                            return datetime.datetime.strptime(str(val), '%Y:%m:%d %H:%M:%S')
                        except (ValueError, TypeError):
                            pass
    except Exception:
        pass

    # 2. Try parsing filename with regex for YYYYMMDD_HHMMSS
    try:
        filename = os.path.basename(filepath)
        match = re.search(r'(\d{8})_(\d{6})', filename)
        if match:
            return datetime.datetime.strptime(f"{match.group(1)}_{match.group(2)}", "%Y%m%d_%H%M%S")
    except Exception:
        pass

    # 3. Fallback to file mtime/ctime
    try:
        return datetime.datetime.fromtimestamp(os.path.getmtime(filepath))
    except Exception:
        try:
            return datetime.datetime.fromtimestamp(os.path.getctime(filepath))
        except Exception:
            return datetime.datetime.now()

def photo_ingest_for_album(album, user, refresh_matviews=True) -> list:
    SOURCE_DIR = album.location + "Ingest/**"
    DEST_DIR = album.location
    files = [i for i in glob.glob(f"{SOURCE_DIR}/*.*") if str(i).split('.')[-1].lower() in ["jpg", "jpeg", "png", "mp4", "mpg", "m4v", "mov", "mod", "avi", "3gp", "mkv", "gif", "heic"]]

    dtn = datetime.datetime.now()
    new_photos = []

    for ff in files:
        # print(ff)
        dt = _extract_date_taken(ff)
        
        if album.split:
            destdir = f"{DEST_DIR}{dt.year}/{dt.month}/"
            destdir1 = f"{dt.year}/{dt.month}/"
        else:
            destdir = f"{DEST_DIR}"
            destdir1 = ""
        if not os.path.exists(destdir): os.makedirs(destdir)

        if os.path.isfile(f"{destdir}{os.path.basename(ff)}"):
            # print(f"IGNORED {ff}")

            if (dtn - dt).days >= 300:
                # print(f"DELETE {ff}")
                os.remove(ff)

            continue

        shutil.copy2(ff, f"{destdir}{os.path.basename(ff)}")
        # print(f"{destdir}{os.path.basename(ff)}")

        p = Photo()
        p.owner = user
        p.album = album
        p.filepath = f"{destdir1}{os.path.basename(ff)}"
        p.save()

        # print(f"Saved photo {p.id}")

        f = p.album.location + p.filepath #; print(p.id)

        try:
            sz = os.path.getsize(f)
            p.size = int(sz / 1024)
            try:
                if p.orig_filepath: sz += os.path.getsize(p.album.location + p.orig_filepath)
            except FileNotFoundError: pass
            try:
                if p.raw_filepath: sz += os.path.getsize(p.album.location + p.raw_filepath)
            except FileNotFoundError: pass

            p.size_total = int(sz / 1024)
        except FileNotFoundError: pass


        if f.split('.')[-1].lower() in ['mp4', 'mpg', 'm4v', 'mov', "mod", "avi", "3gp", "mkv"]:
            p.video = True
            p.update_info_exiftool()
        else:
            try:
                img = Image.open(f)
                p.width = img.size[0]
                p.height = img.size[1]
                p.calculate_megapixels()
                try:
                    gpsdata = gpsphoto.getGPSData(f)
                    try:
                        p.latitude = gpsdata['Latitude']
                        p.longitude = gpsdata['Longitude']
                        try:
                            p.altitude = gpsdata['Altitude']
                        except: pass
                    except: pass
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

        dt = _extract_date_taken(f)
        try: p.date_taken = dt   
        except: pass

        # print(p, dt)

        if p.latitude != 0 and p.longitude != 0 and p.latitude != None and p.longitude != None:
            p.location_city, p.location_country = _reverse_geocode_city(p.latitude, p.longitude)

        p.save()

        p.gen_thumbnail()

        p.regen_hashes()

        new_photos.append(p)

    if refresh_matviews:
        refresh_photo_location_cache()

    return new_photos
