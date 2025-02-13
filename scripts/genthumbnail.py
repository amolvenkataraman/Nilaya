import os
import cv2
import hashlib
from photos.models import *
from PIL import Image, ImageOps, UnidentifiedImageError
from PIL.ExifTags import TAGS, GPSTAGS

p = Photo.objects.order_by('-date_taken')
for i in p:
    if os.path.exists('/www/private/photo_cache/thumbnail/' + str(i.id) + '.jpg'): continue

    try:
        i.filepath = i.filepath.replace(" ", "_")
        i.file_not_available = False
        if i.video == False:
            u = i.album.location + i.filepath
            img = Image.open(u)               
            img = ImageOps.exif_transpose(img)
            img.thumbnail((500, 200))
            img.save('/www/private/photo_cache/thumbnail/' + str(i.id) + '.jpg', "JPEG")
        else:
            f = cv2.VideoCapture(i.album.location + i.filepath)

            ret, fr = f.read()
            if ret:
                fr = cv2.rectangle(fr, (0, 0), (fr.shape[0], 400), (255, 255, 255), -1)
                fr = cv2.cvtColor(fr, cv2.COLOR_BGR2RGB)
                fr = cv2.putText(fr, 'Video', (100, 300), cv2.FONT_HERSHEY_SIMPLEX, 10, (255, 0), 10, cv2.LINE_AA)

                thumb = Image.fromarray(fr)
                thumb.thumbnail((500, 200))

                thumb.save('/www/private/photo_cache/thumbnail/' + str(i.id) + '.jpg', "JPEG")

        i.regen_hashes()

        print(u)

    except (FileNotFoundError, UnidentifiedImageError, OSError):
        if os.path.exists(i.album.location + i.filepath):
            i.file_not_available = False
            i.save()
        else:
            print("Error:", i.id)
            i.file_not_available = True
            i.save()
