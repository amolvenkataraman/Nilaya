import os
import shutil
import random
from collections import defaultdict
from photos.models import Photo, Album, refresh_photo_matviews
from django.db.models import Q
from django.db import transaction

def move_photo_to_album(photos, target_album: Album):
    """
    Moves a Photo (or list of Photos) from its current Album to a new target Album.
    Handles moving the main file, raw file, and original file on the disk,
    and updates the database paths and hashes.
    """
    if not isinstance(photos, (list, tuple, set)):
        if hasattr(photos, '__iter__') and not isinstance(photos, str):
            photos = list(photos)
        else:
            photos = [photos]

    print(f"Attempting to move {len(photos)} photos to Album ID {target_album.id} ({target_album.name})...")

    success_count = 0
    for photo in photos:
        print(f"Processing Photo ID {photo.id} (Current album: {photo.album.name})")
        if photo.album == target_album:
            print(f"  Photo ID {photo.id} is already in the target album. Skipping.")
            continue
            
        try:
            with transaction.atomic():
                old_album = photo.album
                
                dt = photo.date_taken
                if not dt:
                    destdir1 = ""
                else:
                    if target_album.split:
                        destdir1 = f"{dt.year}/{dt.month}/"
                    else:
                        destdir1 = ""
                        
                destdir_abs = os.path.join(target_album.location, destdir1)
                os.makedirs(destdir_abs, exist_ok=True)
                
                # Prevent moving directories if filepath is empty or "Ingest"
                basename = os.path.basename(photo.filepath)
                if not basename:
                    print(f"  Skipping Photo ID {photo.id}: empty filepath.")
                    continue
                    
                old_main_abs = os.path.join(old_album.location, photo.filepath)
                new_main_abs = os.path.join(destdir_abs, basename)
                
                if os.path.isfile(old_main_abs):
                    shutil.move(old_main_abs, new_main_abs)
                    print(f"  Moved main file to {new_main_abs}")
                
                new_filepath = os.path.join(destdir1, basename)
                
                # Cleanup Ingest copy in source album to prevent re-ingest churn
                old_ingest_copy = os.path.join(old_album.location, "Ingest", basename)
                if os.path.isfile(old_ingest_copy):
                    os.remove(old_ingest_copy)
                    print(f"  Removed stale Ingest copy from {old_ingest_copy}")
                
                # Move original
                new_orig_filepath = None
                if photo.orig_filepath:
                    orig_basename = os.path.basename(photo.orig_filepath)
                    if orig_basename:
                        old_orig_abs = os.path.join(old_album.location, photo.orig_filepath)
                        new_orig_abs = os.path.join(destdir_abs, orig_basename)
                        if os.path.isfile(old_orig_abs):
                            shutil.move(old_orig_abs, new_orig_abs)
                            print(f"  Moved orig file to {new_orig_abs}")
                        new_orig_filepath = os.path.join(destdir1, orig_basename)

                # Move RAW
                new_raw_filepath = None
                if photo.raw_filepath:
                    raw_basename = os.path.basename(photo.raw_filepath)
                    if raw_basename:
                        old_raw_abs = os.path.join(old_album.location, photo.raw_filepath)
                        new_raw_abs = os.path.join(destdir_abs, raw_basename)
                        if os.path.isfile(old_raw_abs):
                            shutil.move(old_raw_abs, new_raw_abs)
                            print(f"  Moved RAW file to {new_raw_abs}")
                        new_raw_filepath = os.path.join(destdir1, raw_basename)

                # Update standalone orig/raw Photo rows in DB
                standalone_paths = []
                if photo.orig_filepath: standalone_paths.append(photo.orig_filepath)
                if photo.raw_filepath: standalone_paths.append(photo.raw_filepath)
                
                if standalone_paths:
                    standalone_rows = Photo.objects.filter(album=old_album, filepath__in=standalone_paths)
                    for row in standalone_rows:
                        row.album = target_album
                        if row.filepath == photo.orig_filepath:
                            row.filepath = new_orig_filepath
                        elif row.filepath == photo.raw_filepath:
                            row.filepath = new_raw_filepath
                        row.save()
                        row.regen_hashes()  # Ensure standalone row hash is updated
                        print(f"  Updated standalone Photo ID {row.id} for orig/raw file.")

                # Update main photo DB
                photo.album = target_album
                photo.filepath = new_filepath
                if photo.orig_filepath and new_orig_filepath:
                    photo.orig_filepath = new_orig_filepath
                if photo.raw_filepath and new_raw_filepath:
                    photo.raw_filepath = new_raw_filepath

                # Save and regenerate the path-dependent hash
                photo.save()
                photo.regen_hashes()
                print(f"  Finished updating Photo ID {photo.id} to new album.")
                success_count += 1
                
        except Exception as e:
            print(f"  Failed moving Photo ID {photo.id}: {e}")

    print(f"Successfully moved {success_count} photos.")
    if success_count:
        refresh_photo_matviews()  # both views are per library
    return True

def remove_duplicates(year=None, month=None, mode='all', dry_run=False):
    """
    Finds and deletes duplicate photos in the database.
    
    :param year: Filter photos by specific year.
    :param month: Filter photos by specific month.
    :param mode: 'md5', 'filepath', 'basename', or 'all'.
    :param dry_run: If True, prints what would be deleted without actually deleting.
    """
    import re
    from collections import defaultdict
    import random

    print(f"Starting duplicate removal process (Mode: {mode}, Year: {year}, Month: {month}, Dry Run: {dry_run})...")

    base_query = Photo.objects.all()
    if year:
        base_query = base_query.filter(date_taken__year=year)
    if month:
        base_query = base_query.filter(date_taken__month=month)

    def process_duplicates(group, identifier=""):
        if len(group) <= 1:
            return
            
        def score(p):
            s = 0
            album_name_lower = p.album.name.lower()
            if 'amol' in album_name_lower:
                s += 100
            if 'shared' in album_name_lower:
                s += 50
            elif 'sharebum' in album_name_lower:
                s += 10
                
            if p.raw_filepath:
                s += 5
            if p.orig_filepath:
                s += 5
            return s + random.random()
            
        group.sort(key=score, reverse=True)
        keep = group[0]
        print(f"Found {len(group)} duplicates for {identifier}. Keeping ID {keep.id} (Score: {score(keep):.2f})")
        for p in group[1:]:
            if dry_run:
                print(f"  -> [DRY RUN] Would delete duplicate Photo ID {p.id}")
            else:
                try:
                    p.delete()
                    print(f"  -> Deleted duplicate Photo ID {p.id}")
                except Exception as e:
                    print(f"  -> Failed to delete duplicate Photo ID {p.id}: {e}")

    # 1. MD5 Mode
    if mode in ['md5', 'all']:
        photos_by_md5 = defaultdict(list)
        for p in base_query.exclude(md5_hash__isnull=True).exclude(md5_hash=""):
            photos_by_md5[p.md5_hash].append(p)
        print(f"Grouped photos into {len(photos_by_md5)} unique MD5 hashes.")
        
        print("\nProcessing MD5 duplicates...")
        for md5, group in photos_by_md5.items():
            valid_group = [p for p in group if Photo.objects.filter(id=p.id).exists()]
            process_duplicates(valid_group, f"MD5 {md5[:8]}...")

    # 2. Filepath Mode
    if mode in ['filepath', 'all']:
        photos_by_path = defaultdict(list)
        for p in base_query.all():
            full_path = os.path.join(p.album.location, p.filepath)
            photos_by_path[full_path].append(p)
        print(f"Grouped photos into {len(photos_by_path)} unique filepaths.")
        
        print("\nProcessing Filepath duplicates...")
        for path, group in photos_by_path.items():
            valid_group = [p for p in group if Photo.objects.filter(id=p.id).exists()]
            process_duplicates(valid_group, f"Path {path[-30:]}")

    # 3. Basename + Date Mode
    if mode in ['basename', 'all']:
        photos_by_base = defaultdict(list)
        for p in base_query.exclude(date_taken__isnull=True):
            base = os.path.splitext(os.path.basename(p.filepath))[0]
            base = re.sub(r'[\s\-\_]*\(\d+\)$', '', base)
            base = re.sub(r'[\s\-\_]+[1-9]$', '', base)
            base = base.lower().strip()
            
            dt = p.date_taken
            if dt.tzinfo is not None:
                dt = dt.replace(tzinfo=None)
                
            is_video = getattr(p, 'video', False)
            key = f"{base}_{'vid' if is_video else 'img'}_{dt.strftime('%Y%m%d_%H%M%S')}"
            photos_by_base[key].append(p)

        print(f"Grouped photos into {len(photos_by_base)} unique basename+date combinations.")
        print("\nProcessing Basename+Date duplicates...")
        for key, group in photos_by_base.items():
            valid_group = [p for p in group if Photo.objects.filter(id=p.id).exists()]
            process_duplicates(valid_group, f"Basename+Date {key}")

    if not dry_run:
        refresh_photo_matviews()  # deleted duplicates leave the per-day counts and the heat map
    print("\nDuplicate removal complete.")


def add_to_sharealbum(photos, sharealbum):
    """
    Adds a Photo or list of Photos to a ShareAlbum.
    Skips any photo already in the ShareAlbum (no duplicates).

    :param photos: A single Photo instance, or a list/queryset of Photos.
    :param sharealbum: The ShareAlbum instance to add to.
    """
    from photos.models import ShareAlbum_Photo

    if not isinstance(photos, (list, tuple, set)) and not hasattr(photos, '__iter__'):
        photos = [photos]
    else:
        photos = list(photos)

    # Fetch existing photo IDs in this sharealbum in one query
    existing_ids = set(
        ShareAlbum_Photo.objects.filter(sharealbum=sharealbum)
        .values_list('photo_id', flat=True)
    )

    added = 0
    skipped = 0
    for photo in photos:
        if photo.id in existing_ids:
            skipped += 1
            continue
        ShareAlbum_Photo.objects.create(sharealbum=sharealbum, photo=photo)
        existing_ids.add(photo.id)
        added += 1

    print(f"add_to_sharealbum: added {added}, skipped {skipped} already-present.")
    return added


def make_range(start_id: str, end_id: str, album=None):
    """
    Returns a queryset of Photos whose date_taken falls between the two anchor photos.

    :param start_id: UUID string of the first (earlier) photo.
    :param end_id:   UUID string of the last (later) photo.
    :param album:    Optional Album to restrict the search to. If None, searches all photos.
    :returns:        QuerySet of Photos ordered by date_taken ascending.
    :raises:         Photo.DoesNotExist if either ID is not found.
                     ValueError if start photo is after end photo.
    """
    start_photo = Photo.objects.get(id=start_id)
    end_photo   = Photo.objects.get(id=end_id)

    start_dt = start_photo.date_taken
    end_dt   = end_photo.date_taken

    if start_dt is None or end_dt is None:
        raise ValueError(f"Both anchor photos must have a date_taken set.")

    if start_dt > end_dt:
        # Swap silently so callers don't have to care about order
        start_dt, end_dt = end_dt, start_dt

    qs = Photo.objects.filter(date_taken__gte=start_dt, date_taken__lte=end_dt)
    if album is not None:
        qs = qs.filter(album=album)

    return qs.order_by('date_taken')
