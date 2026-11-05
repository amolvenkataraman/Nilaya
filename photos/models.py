import os
import uuid
import hashlib
from pathlib import Path
from django.db import models, connection
from django.contrib.postgres.indexes import GinIndex
from users.models import *
from django.conf import settings
from django.conf import settings as _settings
SALT = _settings.SALT
from GPSPhoto import gpsphoto
import reverse_geocode as rg
import exiftool



def _reverse_geocode_city(lat, lon):
    """Return (city, country) using a population/distance score.

    All GeoNames entries within ~50 km (0.5° Euclidean) are scored as
    population / (dist_km + 1). This means a city (high population, slightly
    farther) naturally beats a neighbourhood (low population, very close), while
    two same-sized adjacent cities are decided by proximity rather than raw
    population. Falls back to the nearest point when nothing is found in range.
    """
    import math
    from reverse_geocode import GeocodeData

    def _haversine_km(lat1, lon1, lat2, lon2):
        R = 6371
        dlat = math.radians(lat2 - lat1)
        dlon = math.radians(lon2 - lon1)
        a = math.sin(dlat / 2) ** 2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2) ** 2
        return R * 2 * math.asin(math.sqrt(a))

    data = GeocodeData()
    nearby = data._tree.query_ball_point([(lat, lon)], r=0.5)[0]

    best = None
    best_score = -1
    for idx in nearby:
        loc = data._locations[idx]
        dist_km = _haversine_km(lat, lon, loc['latitude'], loc['longitude'])
        score = math.log10(max(loc.get('population', 0), 1)) - (dist_km / 5)
        if score > best_score:
            best_score = score
            best = loc

    if best is None:
        _, indices = data._tree.query([(lat, lon)], k=1)
        best = data._locations[indices[0]]

    country = data._countries.get(best['country_code'], '')
    return best['city'], country


# Create your models here.
def parse_album_path(instance, filename):
    return f"photos/album/{instance.id}/{filename}"

class Album(models.Model):
    name = models.CharField(max_length=64)
    owner = models.ForeignKey(ComptechUser, on_delete=models.CASCADE, related_name='album_owner')
    parent_album = models.ForeignKey('self', on_delete=models.SET_NULL, null=True, blank=True, related_name='child_albums')
    oldestdate = models.DateTimeField(null=True, blank=True)
    newestdate = models.DateTimeField(null=True, blank=True)
    picture = models.ImageField(upload_to=parse_album_path, null=True, blank=True)
    location = models.CharField(max_length=128)
    split = models.BooleanField(default=True) # Whether photos are split in different folders by year and month

    def __str__(self):
        return f"{self.name} [{self.owner.username}]"

class Album_Subscriber(models.Model):
    album = models.ForeignKey(Album, on_delete=models.CASCADE, related_name='users_subscribed')
    user = models.ForeignKey(ComptechUser, on_delete=models.CASCADE, related_name='album_subscribed')
    subscribe_type = models.PositiveSmallIntegerField(choices=(
        (0, 'Owner'),
        (1, 'Editor'),
        (2, 'Viewer'),
    ), default=2)
    visible = models.BooleanField(default=True)

    class Meta:
        ordering = ['album_id']

    def __str__(self):
        return f"{self.user.username} subscribed to {self.album.name}"

    def getinfo(self):
        ans = {
            "id": self.album.id,
            "subscribe_id": self.id,
            "name": self.album.name,
            "owner": self.album.owner.id,
            "user": self.user.id,
            "subscribe_type": self.subscribe_type,
            "visible": str(self.visible),
        }

        return ans

    def getinfo_zip(self):
        ans = {
            "id": self.id,
            "user": self.user.getinfo_zip(),
            "subscribe_type": self.subscribe_type,
        }

        return ans

class Photo(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False, verbose_name='ID')
    owner = models.ForeignKey(ComptechUser, on_delete=models.CASCADE, related_name='photo_owner')
    album = models.ForeignKey(Album, on_delete=models.PROTECT, related_name='photo_album')
    filepath = models.CharField(max_length=128)
    raw_filepath = models.CharField(max_length=128, null=True, blank=True)
    orig_filepath = models.CharField(max_length=128, null=True, blank=True)
    thumbnail_hash = models.CharField(max_length=32, null=True, blank=True)
    photo_hash = models.CharField(max_length=32, null=True, blank=True)

    width = models.IntegerField(null=True, blank=True)
    height = models.IntegerField(null=True, blank=True)
    thumbnail_width = models.IntegerField(null=True, blank=True)
    thumbnail_height = models.IntegerField(null=True, blank=True)
    main_color = models.CharField(null=True, blank=True, max_length=7)

    latitude = models.FloatField(null=True, blank=True)
    longitude = models.FloatField(null=True, blank=True)
    altitude = models.FloatField(null=True, blank=True)
    location_city = models.CharField(max_length=128, null=True, blank=True)
    location_country = models.CharField(max_length=32, null=True, blank=True)
    
    orientation = models.CharField(max_length=32)
    date_taken = models.DateTimeField(auto_now=False, null=True, blank=True)

    video = models.BooleanField(default=False)
    length = models.IntegerField(null=True, blank=True)
    framerate = models.IntegerField(null=True, blank=True)
    mimetype = models.CharField(max_length=32, null=True, blank=True)
    megapixels = models.FloatField(null=True, blank=True)
    bitrate = models.IntegerField(null=True, blank=True)
    size = models.IntegerField(null=True, blank=True)
    size_total = models.IntegerField(null=True, blank=True)

    camera_make = models.CharField(max_length=32, null=True, blank=True)
    camera_model = models.CharField(max_length=32, null=True, blank=True)
    exposure = models.CharField(max_length=32, null=True, blank=True)
    fnumber = models.CharField(max_length=32, null=True, blank=True)
    isospeed = models.CharField(max_length=32, null=True, blank=True)
    shutterspeed = models.CharField(max_length=32, null=True, blank=True)
    aperture = models.CharField(max_length=32, null=True, blank=True)
    flash = models.CharField(max_length=32, null=True, blank=True)
    focallength = models.CharField(max_length=32, null=True, blank=True)

    # last_ai_processed = models.DateTimeField(auto_now=False, null=True, blank=True)
    metadata = models.JSONField(default=dict, null=True, blank=True)
    ai_index_info = models.JSONField(default=dict, null=True, blank=True)
    file_not_available = models.BooleanField(default=False)
    hidden = models.BooleanField(default=False, db_index=True, help_text="Hidden from everyone; the owner sees it only in show-hidden mode")

    # Duplicate detection — stored as flat columns for fast DB-level lookups
    md5_hash = models.CharField(max_length=32, null=True, blank=True, help_text="MD5 of the file bytes — exact duplicate detection")
    # blur_score is stored in ai_index_info["blur_score"] (AI-derived, no column needed)


    class Meta:
        indexes = [
            # Specifically indexes the 'objects' key inside the JSON
            GinIndex(fields=['ai_index_info'], name='idx_objects_gin'),
            # Timeline/album pages: newest first, keyset on (date_taken, id); also date-range counts
            models.Index(fields=['date_taken', 'id'], name='photo_date_taken_idx'),
            # Photos near a place: bounding-box query (latitude range, longitude checked in the index)
            models.Index(fields=['latitude', 'longitude'], name='photo_lat_lng_idx'),
        ]

    def __str__(self):
        return f"{self.id}, taken on {str(self.date_taken)}"

    @property
    def has_raw(self):
        if self.raw_filepath and self.album and self.album.location:
            try:
                return os.path.exists(os.path.join(self.album.location, self.raw_filepath))
            except Exception:
                pass
        return False

    @property
    def has_orig(self):
        if self.orig_filepath and self.album and self.album.location:
            try:
                return os.path.exists(os.path.join(self.album.location, self.orig_filepath))
            except Exception:
                pass
        return False

    def get_path(self):
        return str(self.album.location.replace(settings.PHOTOS_ROOT, "") + self.filepath)

    def get_filepath(self):
        return str(self.album.location + self.filepath)

    def get_dimensions(self):
        return {
            "width": self.width,
            "height": self.height
        }

    def get_gps_data(self):
        return {
            "lat": self.latitude,
            "lon": self.longitude
        }

    def getinfo(self):
        raw_blur = None
        normalized_blur = None
        if self.ai_index_info and "blur_score" in self.ai_index_info:
            raw_blur = self.ai_index_info["blur_score"]
            if raw_blur is not None:
                mpx = self.megapixels if self.megapixels is not None else self.calculate_megapixels()
                if mpx and mpx > 0:
                    normalized_blur = raw_blur * (12.0 / mpx)
                else:
                    normalized_blur = raw_blur

        duration_text = ""
        if self.video and self.length:
            minutes, seconds = divmod(self.length, 60)
            duration_text = f"{minutes:02}:{seconds:02}"

        w = self.thumbnail_width or 200
        h = self.thumbnail_height or 200
        aspect_ratio = round(w / h, 4)

        return {
            "id": str(self.id),
            "path": self.get_path(),
            "filepath": str(self.filepath),
            "width": self.width,
            "height": self.height,
            "lat": self.latitude,
            "lon": self.longitude,
            "location_city": self.location_city,
            "location_country": self.location_country,
            "date_taken": str(self.date_taken),
            "thumbnail_hash": self.thumbnail_hash,
            "photo_hash": self.photo_hash,

            "camera_make": self.camera_make,
            "camera_model": self.camera_model,
            "exposure": self.exposure,
            "fnumber": self.fnumber,
            "isospeed": self.isospeed,
            "shutterspeed": self.shutterspeed,
            "aperture": self.aperture,
            "flash": self.flash,
            "focallength": self.focallength,

            "framerate": self.framerate,
            "mimetype": self.mimetype,
            "megapixels": self.megapixels if self.megapixels is not None else self.calculate_megapixels(),
            "bitrate": self.bitrate,
            "size": self.size,
            "size_total": self.size_total,

            "video": self.video,
            "length": self.length,
            "duration_text": duration_text,
            "has_raw": self.has_raw,
            "has_orig": self.has_orig,
            "aspect_ratio": aspect_ratio,
            "raw_blur": round(raw_blur, 1) if raw_blur is not None else None,
            "normalized_blur": round(normalized_blur, 1) if normalized_blur is not None else None,
        }

    def getinfo_zip(self):
        raw_blur = None
        normalized_blur = None
        if self.ai_index_info and "blur_score" in self.ai_index_info:
            raw_blur = self.ai_index_info["blur_score"]
            if raw_blur is not None:
                mpx = self.megapixels if self.megapixels is not None else self.calculate_megapixels()
                if mpx and mpx > 0:
                    normalized_blur = raw_blur * (12.0 / mpx)
                else:
                    normalized_blur = raw_blur

        duration_text = ""
        if self.video and self.length:
            minutes, seconds = divmod(self.length, 60)
            duration_text = f"{minutes:02}:{seconds:02}"

        w = self.thumbnail_width or 200
        h = self.thumbnail_height or 200
        aspect_ratio = round(w / h, 4)

        return {
            "id": str(self.id),
            "path": self.get_path(),
            "filepath": str(self.filepath),
            "date_taken": str(self.date_taken),
            "video": self.video,
            "length": self.length,
            "duration_text": duration_text,
            "thumbnail_width": self.thumbnail_width,
            "thumbnail_height": self.thumbnail_height,
            "main_color": self.main_color,
            "thumbnail_hash": self.thumbnail_hash,
            "photo_hash": self.photo_hash,
            "has_raw": self.has_raw,
            "has_orig": self.has_orig,
            "aspect_ratio": aspect_ratio,
            "location_city": self.location_city,
            "camera_model": self.camera_model,
            "megapixels": self.megapixels if self.megapixels is not None else self.calculate_megapixels(),
            "size": self.size,
            "raw_blur": round(raw_blur, 1) if raw_blur is not None else None,
            "normalized_blur": round(normalized_blur, 1) if normalized_blur is not None else None,
        }

    def calculate_megapixels(self):
        if not self.video and self.width and self.height:
            self.megapixels = round((self.width * self.height) / 1000000.0, 2)
        return self.megapixels

    def refresh_city_data(self, print_=False):
        try:
            if self.latitude != 0 and self.longitude != 0 and self.latitude != None and self.longitude != None:
                self.location_city, self.location_country = _reverse_geocode_city(self.latitude, self.longitude)
                if print_:
                    print(self.location_city, self.location_country)

                self.save()
        except: pass

    def refresh_gps_data(self):
        try:
            gpsdata = gpsphoto.getGPSData(self.album.location + self.filepath)
            try:
                self.latitude = gpsdata['Latitude']
                self.longitude = gpsdata['Longitude']
                try:
                    self.altitude = gpsdata['Altitude']
                except: pass

                self.refresh_city_data()
            except: pass

            self.save()
        except: pass

    def update_info_exiftool(self, orig=False, update_location=True):
        try:
            fp = self.album.location + (self.orig_filepath if orig else self.filepath)
            with exiftool.ExifToolHelper() as et:
                try:
                    metadata = et.get_metadata(fp)
                except exiftool.exceptions.ExifToolExecuteError: return
                updategps = False

                try:
                    self.camera_make = metadata[0]["QuickTime:AndroidManufacturer"]
                except KeyError: pass
                try:
                    self.camera_model = metadata[0]["QuickTime:AndroidModel"]
                except KeyError: pass
                try:
                    self.mimetype = metadata[0]["File:MIMEType"]
                except KeyError: pass

                if update_location:
                    try:
                        self.latitude = metadata[0]["Composite:GPSLatitude"]
                        self.longitude = metadata[0]["Composite:GPSLongitude"]
                        updategps = True
                        try:
                            self.altitude = metadata[0]["Composite:GPSAltitude"]
                        except KeyError: pass
                    except KeyError: pass

                try:
                    self.bitrate = metadata[0]["Composite:AvgBitrate"]
                except KeyError:
                    try:
                        self.bitrate = metadata[0]["MPEG:VideoBitrate"] + metadata[0]["MPEG:AudioBitrate"]
                    except KeyError: pass
                
                try:
                    self.megapixels = metadata[0]["Composite:Megapixels"]
                except KeyError: pass

                if updategps: self.refresh_city_data()

            self.save()

            if self.orig_filepath and not orig:
                self.update_info_exiftool(True, update_location)
        except FileNotFoundError: pass

    def update_info_video(self, orig=False, update_location=True):
        """Extract metadata for video files using ExifTool."""
        self.update_info_exiftool(orig=orig, update_location=update_location)

    def update_file_sizes(self):
        """Calculate and store size (main file KB) and size_total (main + orig + raw KB)."""
        f = self.get_filepath()
        try:
            sz = os.path.getsize(f)
            self.size = int(sz / 1024)
            if self.orig_filepath:
                try:
                    orig_p = os.path.join(self.album.location, self.orig_filepath)
                    if os.path.exists(orig_p):
                        sz += os.path.getsize(orig_p)
                except Exception: pass
            if self.raw_filepath:
                try:
                    raw_p = os.path.join(self.album.location, self.raw_filepath)
                    if os.path.exists(raw_p):
                        sz += os.path.getsize(raw_p)
                except Exception: pass
            self.size_total = int(sz / 1024)
        except (FileNotFoundError, OSError): pass

    def update_info_photo(self):
        """Extract dimensions, megapixels, GPS data, and EXIF tags for photo files using PIL and GPSPhoto."""
        from PIL import Image, ImageOps, UnidentifiedImageError
        from PIL.ExifTags import TAGS

        f = self.get_filepath()
        try:
            img = Image.open(f)
            self.width, self.height = img.size
            # EXIF orientations 5-8 mean the camera stored the image rotated 90 degrees:
            # record the size as displayed (the thumbnail is already exif_transpose'd).
            if (img.getexif() or {}).get(0x0112, 1) in (5, 6, 7, 8):
                self.width, self.height = self.height, self.width
            self.calculate_megapixels()

            try:
                gpsdata = gpsphoto.getGPSData(f)
                try:
                    self.latitude = gpsdata['Latitude']
                    self.longitude = gpsdata['Longitude']
                    try:
                        self.altitude = gpsdata['Altitude']
                    except Exception: pass
                except Exception: pass
            except Exception: pass

            self.orientation = 1

            try:
                exif = img._getexif()
                if exif is not None:
                    exif1 = {TAGS.get(key, key): value for key, value in exif.items()}
                    exif = exif1

                    def _clean_str(val):
                        if isinstance(val, str):
                            return val.replace('\x00', '').replace('\00', '').replace('\0', '')
                        return str(val) if val is not None else None

                    if 'Make' in exif:
                        self.camera_make = _clean_str(exif['Make'])
                    if 'Model' in exif:
                        self.camera_model = _clean_str(exif['Model'])
                    if 'ExposureTime' in exif:
                        self.exposure = _clean_str(exif['ExposureTime'])
                    if 'FNumber' in exif:
                        self.fnumber = _clean_str(exif['FNumber'])
                    if 'ISOSpeedRatings' in exif:
                        self.isospeed = _clean_str(exif['ISOSpeedRatings'])
                    if 'ShutterSpeedValue' in exif:
                        self.shutterspeed = _clean_str(exif['ShutterSpeedValue'])
                    if 'ApertureValue' in exif:
                        self.aperture = _clean_str(exif['ApertureValue'])
                    if 'Flash' in exif:
                        self.flash = _clean_str(exif['Flash'])
                    if 'FocalLength' in exif:
                        self.focallength = _clean_str(exif['FocalLength'])
                    if 'Orientation' in exif:
                        self.orientation = _clean_str(exif['Orientation'])
            except (AttributeError, TypeError, KeyError): pass
        except (UnidentifiedImageError, OSError): pass

    def update_all_metadata(self, orig=False, update_location=True):
        """Extract and save file size, EXIF/video metadata, GPS, city location info, and MD5 hash."""
        self.update_file_sizes()
        if self.video:
            self.update_info_video(orig=orig, update_location=update_location)
        else:
            self.update_info_photo()

        if self.latitude and self.longitude and self.latitude != 0 and self.longitude != 0:
            self.refresh_city_data()

        try:
            from photos.AI.duplicates import md5_hash
            self.md5_hash = md5_hash(self.get_filepath())
        except Exception: pass

        self.save()

    def regen_hashes(self):
        fp = (self.album.location + self.filepath + SALT).replace(settings.PHOTOS_ROOT, "")
        fp1 = f"photo_cache/thumbnail/{self.id}.webp{SALT}"
        hash_ = hashlib.md5(fp.encode('utf-8')).hexdigest()
        hash1_ = hashlib.md5(fp1.encode('utf-8')).hexdigest()

        self.photo_hash = hash_
        self.thumbnail_hash = hash1_
        self.save()

    def gen_thumbnail(self, only_get_dims=False):
        from PIL import Image, ImageOps, UnidentifiedImageError

        try:
            if not only_get_dims:
                if self.video == False:
                    u = self.album.location + self.filepath
                    img = Image.open(u)               
                    img = ImageOps.exif_transpose(img)
                    img.thumbnail((500, 200), Image.Resampling.LANCZOS)
                    img.save(settings.THUMBNAIL_DIR + str(self.id) + '.webp', "WEBP", quality=85)

                else:
                    self.width, self.height, self.length, self.framerate = generate_video_thumbnail(self.album.location + self.filepath, settings.THUMBNAIL_DIR, self.id)

            # Open the saved thumbnail and get dimensions
            thumb = Image.open(settings.THUMBNAIL_DIR + str(self.id) + '.webp')
            self.thumbnail_width = thumb.size[0]
            self.thumbnail_height = thumb.size[1]
            
            # Get dominant color
            thumb = thumb.resize((1, 1))  # Resize to 1x1 to get average color
            dominant_color = thumb.getpixel((0, 0))
            self.main_color = '#{:02x}{:02x}{:02x}'.format(*dominant_color)
            
            self.save()
            self.regen_hashes()

        except (FileNotFoundError, UnidentifiedImageError, OSError):
            print("Error generating thumbnail for: " + str(self.id))
            pass

class ShareAlbum(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False, verbose_name='ID')
    owner = models.ForeignKey(ComptechUser, on_delete=models.CASCADE, related_name='sharealbum_owner')
    name = models.CharField(max_length=64)
    description = models.TextField(null=True, blank=True)
    public = models.BooleanField(default=False)
    cover_photo = models.ForeignKey(Photo, on_delete=models.SET_NULL, null=True, blank=True, related_name='cover_for_albums')

    def __str__(self):
        return f"ShareAlbum {self.name} [{self.owner.username}]"

    @property
    def cover_photo_id_resolved(self):
        if self.cover_photo_id:
            return str(self.cover_photo_id)
        # Fallback to the newest photo by date_taken
        photos_qs = Photo.objects.filter(photo_in_sharealbum__sharealbum=self)
        cover_photo = photos_qs.order_by('-date_taken').first()
        return str(cover_photo.id) if cover_photo else ""

    def getinfo(self):
        photos_qs = Photo.objects.filter(photo_in_sharealbum__sharealbum=self)
        total_photos = photos_qs.filter(video=False).count()
        total_videos = photos_qs.filter(video=True).count()
        total_kb = photos_qs.aggregate(total=models.Sum('size_total'))['total'] or 0
        
        if self.cover_photo:
            cover_photo = self.cover_photo
        else:
            cover_photo = photos_qs.order_by('-date_taken').first()
        cover_photo_id = str(cover_photo.id) if cover_photo else None
        cover_photo_hash = cover_photo.thumbnail_hash if cover_photo else None

        oldest_date = photos_qs.aggregate(oldest=models.Min('date_taken'))['oldest']
        newest_date = photos_qs.aggregate(newest=models.Max('date_taken'))['newest']

        def format_size(kb):
            mb = kb / 1024.0
            if mb >= 1024.0 * 1024.0:
                return f"{mb / (1024.0 * 1024.0):.2f} TB"
            elif mb >= 1024.0:
                return f"{mb / 1024.0:.2f} GB"
            else:
                return f"{mb:.1f} MB"
                
        space_used = format_size(total_kb)

        return {
            "id": str(self.id),
            "owner": self.owner.id,
            "name": self.name,
            "description": self.description,
            "public": self.public,
            "photo_count": total_photos,
            "video_count": total_videos,
            "space_used": space_used,
            "space_used_kb": total_kb,
            "cover_photo_id": cover_photo_id,
            "cover_photo_hash": cover_photo_hash,
            "oldest_date": oldest_date.isoformat() if oldest_date else "",
            "newest_date": newest_date.isoformat() if newest_date else "",
        }

class ShareAlbum_Photo(models.Model):
    sharealbum = models.ForeignKey(ShareAlbum, on_delete=models.CASCADE, related_name='sharealbum_photos')
    photo = models.ForeignKey(Photo, on_delete=models.CASCADE, related_name='photo_in_sharealbum')

    def __str__(self):
        return f"Photo {self.photo.id} in ShareAlbum {self.sharealbum.name}"

class ShareAlbum_Subscriber(models.Model):
    album = models.ForeignKey(ShareAlbum, on_delete=models.CASCADE, related_name='sharealbum_users_subscribed')
    user = models.ForeignKey(ComptechUser, on_delete=models.CASCADE, related_name='sharealbum_subscribed')
    subscribe_type = models.PositiveSmallIntegerField(choices=(
        (0, 'Owner'),
        (1, 'Editor'),
        (2, 'Viewer'),
    ), default=2)
    visible = models.BooleanField(default=True)

    def __str__(self):
        return f"{self.user.username} subscribed to {self.album.name}"


def generate_video_thumbnail(video_path, output_path, video_id):
    import cv2
    import numpy as np
    from PIL import Image

    # Open video file
    cap = cv2.VideoCapture(video_path)

    if not cap.isOpened(): raise FileNotFoundError
    # Newer OpenCV builds rotate frames automatically; turn that off so the explicit
    # rotation below is applied exactly once on every version (else: sideways thumbnails).
    cap.set(cv2.CAP_PROP_ORIENTATION_AUTO, 0)

    # Read the first frame
    ret, frame = cap.read()
    if not ret: raise FileNotFoundError

    # Get video duration
    fps = cap.get(cv2.CAP_PROP_FPS)
    frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    rotation = int(cap.get(cv2.CAP_PROP_ORIENTATION_META))
    duration = int(frame_count / fps) if fps > 0 else 0

    cap.release()

    # Convert to RGB (PIL format)
    frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)

    if rotation == 90:
        frame = cv2.rotate(frame, cv2.ROTATE_90_CLOCKWISE)
    elif rotation == 180:
        frame = cv2.rotate(frame, cv2.ROTATE_180)
    elif rotation == 270:
        frame = cv2.rotate(frame, cv2.ROTATE_90_COUNTERCLOCKWISE)

    height, width = frame.shape[:2]  # numpy shape is (rows, cols, channels)

    img = Image.fromarray(frame)

    # Resize for thumbnail
    img.thumbnail((500, 200), Image.Resampling.LANCZOS)

    # Save thumbnail
    img.save(f"{output_path}/{video_id}.webp", "WEBP", quality=85)

    return width, height, duration, fps

def delete_photo(p):
    try:
        os.remove(settings.THUMBNAIL_DIR + str(p.id) + '.webp')
    except FileNotFoundError: pass

    try:
        os.remove(p.album.location + p.filepath)
    except FileNotFoundError: pass

    try:
        if p.orig_filepath != None:
            if os.path.exists(p.album.location + p.orig_filepath):
                os.remove(p.album.location + p.orig_filepath)
            Photo.objects.filter(album=p.album, filepath=p.orig_filepath).delete()
        if p.raw_filepath != None:
            if os.path.exists(p.album.location + p.raw_filepath):
                os.remove(p.album.location + p.raw_filepath)
            Photo.objects.filter(album=p.album, filepath=p.raw_filepath).delete()
    except FileNotFoundError: pass

    try:
        basename = os.path.basename(p.filepath)
        ingest_dir = Path(p.album.location) / "Ingest"
        if ingest_dir.exists():
            for match in ingest_dir.rglob(basename):
                if match.is_file():
                    try:
                        os.remove(match)
                    except OSError:
                        pass
    except Exception:
        pass

    p.delete()


class PhotoLocationCache(models.Model):
    album_id = models.IntegerField()
    lat = models.FloatField()
    lng = models.FloatField()
    on_plane = models.BooleanField()
    dt_year = models.IntegerField()
    cnt = models.IntegerField()

    class Meta:
        managed = False  # 🔴 VERY IMPORTANT
        db_table = 'photos_photo_location_cache'
        unique_together = ['album_id', 'lat', 'lng', 'on_plane', 'dt_year', 'cnt']

class PhotoDaily(models.Model):
    """Per library album and local day: counts, sizes, video length (hidden photos left out).
    A materialized view on Postgres (migration 0026), a plain view on SQLite."""
    id = models.CharField(max_length=40, primary_key=True)
    album_id = models.IntegerField()
    day = models.DateField()
    photos = models.IntegerField()
    videos = models.IntegerField()
    size_kb = models.BigIntegerField()
    size_total_kb = models.BigIntegerField()
    length_s = models.BigIntegerField()

    class Meta:
        managed = False
        db_table = 'photos_photo_daily'


# Photos taken at or above this altitude (metres) count as "on a plane": left out of heatmaps and place lists.
PLANE_ALTITUDE_M = 2000

# A coordinate of exactly 0 is broken GPS (some phones write the right latitude with longitude 0.0,
# which lands in southern France), not a photo on the equator or meridian: treated as no location.
BROKEN_GPS = models.Q(latitude=0) | models.Q(longitude=0)

MATVIEWS = ('photos_photo_location_cache', 'photos_photo_daily')


def refresh_photo_matviews(views=MATVIEWS):
    """Refresh the photo materialized views (migrations 0025, 0026) after ingest or hiding.
    CONCURRENTLY keeps them readable while refreshing. SQLite uses plain views: nothing to do.
    Each refresh re-reads the whole photo table, so pass only the views a change can affect.
    For changes made in a request, use photos.cache.schedule_matview_refresh (coalesced, in Celery)."""
    from .cache import bump
    bump()  # cached photo stats are stale too
    if connection.vendor != 'postgresql':
        return
    with connection.cursor() as cursor:
        for view in views:
            try:
                cursor.execute(f'REFRESH MATERIALIZED VIEW CONCURRENTLY {view};')
            except Exception:  # first refresh after creation, or no unique index yet
                cursor.execute(f'REFRESH MATERIALIZED VIEW {view};')


refresh_photo_location_cache = refresh_photo_matviews  # old name, still used by ingest code
