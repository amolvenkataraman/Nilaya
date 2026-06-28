#!/usr/bin/env python
import os
import sys
import shutil
import datetime
import django
import exifread
import re

# Set up Django environment
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if not os.environ.get('DJANGO_SETTINGS_MODULE'):
    os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'Comptech.settings')
try:
    django.setup()
except Exception:
    pass

from photos.models import Album, Photo

def make_naive(dt):
    if dt is None:
        return None
    if dt.tzinfo is not None:
        return dt.replace(tzinfo=None)
    return dt

def get_raw_file_date(raw_filepath):
    # 1. Try reading EXIF using exifread
    try:
        with open(raw_filepath, 'rb') as f:
            tags = exifread.process_file(f, stop_at_track_tag='EXIF DateTimeOriginal', details=False)
            dt_tag = tags.get('EXIF DateTimeOriginal') or tags.get('Image DateTime')
            if dt_tag:
                dt_str = str(dt_tag)
                return datetime.datetime.strptime(dt_str, '%Y:%m:%d %H:%M:%S')
    except Exception:
        pass

    # 2. Try PIL Image EXIF (in case of DNG or other supported format)
    try:
        from PIL import Image
        img = Image.open(raw_filepath)
        exif = img._getexif()
        if exif and 36867 in exif:
            dt_str = exif[36867]
            return datetime.datetime.strptime(dt_str, '%Y:%m:%d %H:%M:%S')
    except Exception:
        pass

    # 3. Fall back to file modification time
    try:
        mtime = os.path.getmtime(raw_filepath)
        return datetime.datetime.fromtimestamp(mtime)
    except Exception:
        pass

    # 4. Fall back to file creation time
    try:
        ctime = os.path.getctime(raw_filepath)
        return datetime.datetime.fromtimestamp(ctime)
    except Exception:
        pass

    return None

def calculate_size_total(photo):
    # Main file path
    main_path = os.path.join(photo.album.location, photo.filepath)
    total_bytes = os.path.getsize(main_path) if os.path.exists(main_path) else 0
    
    # Original file (if present)
    if photo.orig_filepath:
        orig_path = os.path.join(photo.album.location, photo.orig_filepath)
        if os.path.exists(orig_path):
            total_bytes += os.path.getsize(orig_path)
            
    # Raw file (if present)
    if photo.raw_filepath:
        raw_path = os.path.join(photo.album.location, photo.raw_filepath)
        if os.path.exists(raw_path):
            total_bytes += os.path.getsize(raw_path)
            
    return int(total_bytes / 1024)

def match_and_move_raw_files():
    albums = Album.objects.all()
    if not albums.exists():
        print("No albums found in the database.")
        return

    total_matches = 0

    for album in albums:
        print(f"\nScanning album: {album.name} (Location: {album.location})")
        raw_dir = os.path.join(album.location, "Raw")
        
        if not os.path.isdir(raw_dir):
            print(f"  -> No 'Raw' directory found at: {raw_dir}")
            continue

        print(f"  -> Found 'Raw' directory. Scanning and processing files...")
        
        # Get all photos in this album to match against
        photos = list(Photo.objects.filter(album=album))
        if not photos:
            print("  -> No photos registered in this album.")
            continue

        # Gather all raw files first
        raw_files = []
        for root, _, filenames in os.walk(raw_dir):
            for filename in filenames:
                if filename.startswith('.'):
                    continue
                raw_filepath = os.path.join(root, filename)
                raw_files.append(raw_filepath)

        raw_files_count = len(raw_files)
        album_matches = 0

        for raw_filepath in raw_files:
            rel_raw_path = os.path.relpath(raw_filepath, raw_dir)
            raw_base_path, _ = os.path.splitext(rel_raw_path)
            raw_base_name, _ = os.path.splitext(os.path.basename(raw_filepath))
            
            # Find all matching photos for this raw file
            matched_photos = []
            for p in photos:
                photo_base_path, _ = os.path.splitext(p.filepath)
                photo_base_name, _ = os.path.splitext(os.path.basename(p.filepath))
                
                raw_match = re.search(r'\d{8}_\d{6,}', raw_base_name)
                photo_match = re.search(r'\d{8}_\d{6,}', photo_base_name)
                
                # Match conditions:
                # 1. Base names match exactly
                # 2. Or photo's relative path ends with raw's relative path
                # 3. Or vice-versa
                # 4. Or both contain the same YYYYMMDD_HHMMSS timestamp pattern
                if (photo_base_name.lower() == raw_base_name.lower() or 
                    photo_base_path.lower().endswith(raw_base_path.lower()) or 
                    raw_base_path.lower().endswith(photo_base_path.lower()) or
                    (raw_match and photo_match and raw_match.group() == photo_match.group())):
                    matched_photos.append(p)
            
            if not matched_photos:
                print(f"  [NO MATCH] Raw: {rel_raw_path}")
                continue
            
            # If multiple matches, tie break with EXIF / file date
            if len(matched_photos) > 1:
                raw_date = get_raw_file_date(raw_filepath)
                if raw_date:
                    naive_raw_date = make_naive(raw_date)
                    def get_diff(photo):
                        p_dt = make_naive(photo.date_taken)
                        if p_dt is None:
                            return datetime.timedelta.max
                        return abs(p_dt - naive_raw_date)
                    
                    matched_photos.sort(key=get_diff)
                    chosen_photo = matched_photos[0]
                    print(f"  [TIE BREAK] Raw: {rel_raw_path} matched {len(matched_photos)} photos. Closest date: Photo {chosen_photo.id} ({chosen_photo.filepath}) with date_taken={chosen_photo.date_taken} (Raw date={raw_date})")
                    matched_photos = [chosen_photo]
                else:
                    print(f"  [AMBIGUOUS] Raw: {rel_raw_path} matched {len(matched_photos)} photos, but no date metadata found. Defaulting to first match.")
                    matched_photos = [matched_photos[0]]
            else:
                print(f"  [MATCH FOUND] Raw: {rel_raw_path} <==> Photo: {matched_photos[0].filepath}")
            
            # Process the matched photo
            p = matched_photos[0]
            dest_dir = os.path.dirname(os.path.join(album.location, p.filepath))
            os.makedirs(dest_dir, exist_ok=True)
            dest_raw_path = os.path.join(dest_dir, os.path.basename(raw_filepath))
            
            try:
                if os.path.exists(raw_filepath):
                    shutil.move(raw_filepath, dest_raw_path)
                    print(f"    -> Moved raw file to: {dest_raw_path}")
                else:
                    print(f"    -> Source file {raw_filepath} not found.")
            except Exception as e:
                print(f"    [ERROR] Failed to move file: {e}")
                continue
            
            # Update database record
            p.raw_filepath = os.path.relpath(dest_raw_path, album.location)
            p.size_total = calculate_size_total(p)
            p.save()
            print(f"    -> Updated database: raw_filepath='{p.raw_filepath}', size_total={p.size_total} KB")
            
            album_matches += 1
            total_matches += 1

        print(f"  -> Finished album '{album.name}': processed {album_matches} matches for {raw_files_count} raw files.")

    print(f"\nScan and update complete. Total matching operations processed: {total_matches}")

if __name__ == "__main__":
    match_and_move_raw_files()
