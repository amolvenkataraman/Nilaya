import os
import cv2
import hashlib
from photos.models import *
from PIL import Image, ImageOps, UnidentifiedImageError
from PIL.ExifTags import TAGS, GPSTAGS

p = Photo.objects.order_by('-date_taken')
for i in p:
    if os.path.exists('/www/private/photo_cache/thumbnail/' + str(i.id) + '.webp'): continue

    try:
        i.filepath = i.filepath.replace(" ", "_")
        i.file_not_available = False
        i.gen_thumbnail()
        print(i.album.location + i.filepath)

    except (FileNotFoundError, UnidentifiedImageError, OSError):
        if os.path.exists(i.album.location + i.filepath):
            i.file_not_available = False
            i.save()
        else:
            print("Error:", i.id)
            i.file_not_available = True
            i.save()
