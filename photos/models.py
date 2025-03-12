import os
import uuid
import hashlib
from django.db import models
from users.models import *
from Comptech.settings import SALT

# Create your models here.
def parse_album_path(instance, filename):
    return f"photos/album/{instance.id}/{filename}"

class Album(models.Model):
    name = models.CharField(max_length=64)
    owner = models.ForeignKey(ComptechUser, on_delete=models.CASCADE, related_name='album_owner')
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

    camera_make = models.CharField(max_length=32, null=True, blank=True)
    camera_model = models.CharField(max_length=32, null=True, blank=True)
    exposure = models.CharField(max_length=32, null=True, blank=True)
    fnumber = models.CharField(max_length=32, null=True, blank=True)
    isospeed = models.CharField(max_length=32, null=True, blank=True)
    shutterspeed = models.CharField(max_length=32, null=True, blank=True)
    aperture = models.CharField(max_length=32, null=True, blank=True)
    flash = models.CharField(max_length=32, null=True, blank=True)
    focallength = models.CharField(max_length=32, null=True, blank=True)

    metadata = models.JSONField(default={}, null=True, blank=True)
    ai_index_info = models.JSONField(default={}, null=True, blank=True)
    file_not_available = models.BooleanField(default=False)

    def __str__(self):
        return f"{self.id}, taken on {str(self.date_taken)}"

    def get_path(self):
        return str(self.album.location.replace("/mnt/data/Photos/", "") + self.filepath)

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

            "video": self.video,
            "length": self.length,            
        }

    def getinfo_zip(self):
        return {
            "id": str(self.id),
            "path": self.get_path(),
            "filepath": str(self.filepath),
            "date_taken": str(self.date_taken),
            "video": self.video,
            "length": self.length,
            "thumbnail_width": self.thumbnail_width,
            "thumbnail_height": self.thumbnail_height,
            "main_color": self.main_color,
            "thumbnail_hash": self.thumbnail_hash,
            "photo_hash": self.photo_hash,
        }

    def regen_hashes(self):
        fp = (self.album.location + self.filepath + SALT).replace("/mnt/data/Photos/", "")
        fp1 = f"photo_cache/thumbnail/{self.id}.jpg{SALT}"
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
                    img.thumbnail((500, 200))
                    img.save('/www/private/photo_cache/thumbnail/' + str(self.id) + '.jpg', "JPEG")

                else:
                    self.width, self.height, self.length = generate_video_thumbnail(self.album.location + self.filepath, '/www/private/photo_cache/thumbnail/', self.id)

            # Open the saved thumbnail and get dimensions
            thumb = Image.open('/www/private/photo_cache/thumbnail/' + str(self.id) + '.jpg')
            self.thumbnail_width = thumb.size[0]
            self.thumbnail_height = thumb.size[1]
            
            # Get dominant color
            thumb = thumb.resize((1, 1))  # Resize to 1x1 to get average color
            dominant_color = thumb.getpixel((0, 0))
            self.main_color = '#{:02x}{:02x}{:02x}'.format(*dominant_color)
            
            self.save()

        except (FileNotFoundError, UnidentifiedImageError, OSError):
            print("Error generating thumbnail for: " + str(self.id))
            pass

def generate_video_thumbnail(video_path, output_path, video_id):
    import cv2
    import numpy as np
    from PIL import Image, ImageDraw, ImageFont

    # Open video file
    cap = cv2.VideoCapture(video_path)
    
    if not cap.isOpened(): raise FileNotFoundError

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
    minutes, seconds = divmod(duration, 60)

    cap.release()

    # Convert to RGB (PIL format)
    frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)

    if rotation == 90:
        frame = cv2.rotate(frame, cv2.ROTATE_90_CLOCKWISE)
    elif rotation == 180:
        frame = cv2.rotate(frame, cv2.ROTATE_180)
    elif rotation == 270:
        frame = cv2.rotate(frame, cv2.ROTATE_90_COUNTERCLOCKWISE)

    width, height, _ = frame.shape

    img = Image.fromarray(frame)

    # Resize for thumbnail
    img.thumbnail((500, 200), Image.Resampling.LANCZOS)

    # Create drawing context
    draw = ImageDraw.Draw(img)

    # Draw play button (white triangle)
    w, h = img.size
    triangle_size = min(w, h) // 8
    triangle = [
        (w // 2 - triangle_size, h // 2 - triangle_size),
        (w // 2 - triangle_size, h // 2 + triangle_size),
        (w // 2 + triangle_size, h // 2)
    ]
    draw.polygon(triangle, fill="white")

    # Draw video duration (MM:SS) in top-right
    font_size = max(20, w // 16)  # Scales with image size
    try:
        font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf", font_size)
    except:
        font = ImageFont.load_default()

    time_text = f"{minutes:02}:{seconds:02}"
    text_bbox = draw.textbbox((0, 0), time_text, font=font)  # Get text bounding box
    text_width = text_bbox[2] - text_bbox[0]
    text_height = text_bbox[3] - text_bbox[1]
    
    text_position = (w - text_width - 10, 10)  # Top-right corner
    draw.text(text_position, time_text, fill="white", font=font)

    # Save thumbnail
    img.save(f"{output_path}/{video_id}.jpg", "JPEG")

    return width, height, duration

def delete_photo(p):
    try:
        os.remove('/www/private/photo_cache/thumbnail/' + str(p.id) + '.jpg')
    except FileNotFoundError: pass

    try:
        os.remove(p.album.location + p.filepath)
    except FileNotFoundError: pass

    try:
        if p.orig_filepath != None and os.path.exists(p.album.location + p.orig_filepath):
            os.remove(p.album.location + p.orig_filepath)
        if p.raw_filepath != None and os.path.exists(p.album.location + p.raw_filepath):
            os.remove(p.album.location + p.raw_filepath)
    except FileNotFoundError: pass

    p.delete()
