from django.shortcuts import render
from django.http import HttpResponse, JsonResponse, FileResponse
from django.contrib.auth.decorators import login_required
from django.conf import settings
from photos.models import *
from photos.models import _reverse_geocode_city
from django.db.models import Q
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

import re

def _place(src, dest):
    """Copy a file into the library (server). Local testing hardlinks instead:
    instant, no extra disk, and nothing in the app writes library files in place."""
    if getattr(settings, 'PHOTOS_INGEST_HARDLINK', False):
        try:
            os.link(src, dest)
            return
        except OSError:
            pass  # different filesystem: fall back to a copy
    shutil.copy2(src, dest)

def make_naive(dt):
    if dt is None:
        return None
    if dt.tzinfo is not None:
        return dt.replace(tzinfo=None)
    return dt

def photo_ingest_for_album(album, user, refresh_matviews=True) -> list:
    SOURCE_DIR = album.location + "Ingest/**"
    DEST_DIR = album.location
    
    all_files = list(glob.glob(f"{SOURCE_DIR}/*.*"))
    normal_extensions = ["jpg", "jpeg", "png", "mp4", "mpg", "m4v", "mov", "mod", "avi", "3gp", "mkv", "gif", "heic"]
    raw_extensions = ["dng", "cr2", "cr3", "nef", "arw", "srw", "orf", "rw2", "raf", "pef", "3fr", "erf", "mef", "mos", "crw", "kdc", "sr2", "x3f", "mrw"]
    
    normal_files = []
    raw_files = []
    for f in all_files:
        if os.path.basename(f).startswith('.'):
            continue
        ext = str(f).split('.')[-1].lower()
        if ext in normal_extensions:
            normal_files.append(f)
        elif ext in raw_extensions:
            raw_files.append(f)

    dtn = datetime.datetime.now()
    new_photos = []

    retention_days = getattr(settings, 'PHOTOS_INGEST_RETENTION_DAYS', 365)
    raw_retention_days = getattr(settings, 'PHOTOS_INGEST_RAW_RETENTION_DAYS', 365)

    related_albums = [album] + list(Album.objects.filter(parent_album=album))
    
    print(f"Starting ingestion for Album ID {album.id} ({album.name})")
    print(f"Found {len(normal_files)} normal files and {len(raw_files)} RAW files.")

    for ff in normal_files:
        dt = _extract_date_taken(ff)
        
        if album.split:
            destdir = f"{DEST_DIR}{dt.year}/{dt.month}/"
            destdir1 = f"{dt.year}/{dt.month}/"
        else:
            destdir = f"{DEST_DIR}"
            destdir1 = ""
        if not os.path.exists(destdir): os.makedirs(destdir)

        basename = os.path.basename(ff)
        dest_path = f"{destdir}{basename}"
        
        # Check if this file already exists anywhere in the album family (parent + children).
        # filepath is always stored relative to the album location, so iendswith=basename
        # will always match regardless of which album in the family holds the photo.
        photo_exists_in_db = Photo.objects.filter(
            album__in=related_albums,
            filepath=f"{destdir1}{basename}"
        ).exists()

        if photo_exists_in_db or os.path.isfile(dest_path):
            if (dtn - dt).days >= retention_days:
                print(f"  -> File {basename} is already ingested and older than {retention_days} days. Deleting from Ingest folder.")
                try: os.remove(ff)
                except OSError: pass
            else:
                print(f"  -> File {basename} is already ingested. Skipping (retaining in Ingest).")
            continue
        
        print(f"  -> Ingesting new file: {basename} -> {dest_path}")
        _place(ff, dest_path)

        p = Photo()
        p.owner = user
        p.album = album
        p.filepath = f"{destdir1}{basename}"
        p.video = (ff.split('.')[-1].lower() in ['mp4', 'mpg', 'm4v', 'mov', 'mod', 'avi', '3gp', 'mkv'])
        
        try:
            p.date_taken = dt
        except Exception:
            pass

        p.save()

        p.update_all_metadata()
        p.gen_thumbnail()
        p.regen_hashes()

        new_photos.append(p)
        
    for raw_filepath in raw_files:
        raw_dt = _extract_date_taken(raw_filepath)
        raw_base_name, _ = os.path.splitext(os.path.basename(raw_filepath))
        raw_base_name = re.sub(r'[\s\-\_]*\(\d+\)$', '', raw_base_name)
        raw_base_name = re.sub(r'[\s\-\_]+[1-9]$', '', raw_base_name)
        
        raw_match = re.search(r'\d{8}_\d{6,}', raw_base_name)
        
        search_term = raw_match.group() if raw_match else raw_base_name
        potential_photos = list(Photo.objects.filter(album__in=related_albums, filepath__icontains=search_term))
            
        matched_photos = []
        for p in potential_photos:
            p_base_name = os.path.splitext(os.path.basename(p.filepath))[0]
            p_base_name = re.sub(r'[\s\-\_]*\(\d+\)$', '', p_base_name)
            p_base_name = re.sub(r'[\s\-\_]+[1-9]$', '', p_base_name)
            
            p_match = re.search(r'\d{8}_\d{6,}', p_base_name)
            if p_base_name.lower() == raw_base_name.lower() or (raw_match and p_match and raw_match.group() == p_match.group()):
                matched_photos.append(p)
                
        if not matched_photos:
            if (dtn - raw_dt).days >= raw_retention_days:
                print(f"  -> RAW file {raw_base_name} matched no photos and is older than {raw_retention_days} days. Deleting from Ingest folder.")
                try: os.remove(raw_filepath)
                except OSError: pass
            else:
                print(f"  -> RAW file {raw_base_name} matched no photos. Skipping (retaining in Ingest).")
            continue
            
        naive_raw_date = make_naive(raw_dt)
        chosen_photo = min(matched_photos, key=lambda p: abs(make_naive(p.date_taken) - naive_raw_date) if make_naive(p.date_taken) and naive_raw_date else datetime.timedelta.max)
        
        dest_raw_path = os.path.join(os.path.dirname(os.path.join(chosen_photo.album.location, chosen_photo.filepath)), os.path.basename(raw_filepath))
        
        if os.path.isfile(dest_raw_path):
            if (dtn - raw_dt).days >= raw_retention_days:
                print(f"  -> RAW file {raw_base_name} is already associated and older than {raw_retention_days} days. Deleting from Ingest folder.")
                try: os.remove(raw_filepath)
                except OSError: pass
            else:
                print(f"  -> RAW file {raw_base_name} is already associated. Skipping (retaining in Ingest).")
            continue
            
        print(f"  -> Associating RAW file {raw_base_name} with Photo ID {chosen_photo.id}")
        os.makedirs(os.path.dirname(dest_raw_path), exist_ok=True)
        _place(raw_filepath, dest_raw_path)
        
        chosen_photo.raw_filepath = os.path.relpath(dest_raw_path, chosen_photo.album.location)
        chosen_photo.update_file_sizes()
        chosen_photo.save()

    if refresh_matviews:
        refresh_photo_location_cache()

    return new_photos
