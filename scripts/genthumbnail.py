import hashlib
import cv2
from photos.models import *
from PIL import Image, ExifTags, ImageOps, UnidentifiedImageError
from PIL.ExifTags import TAGS, GPSTAGS

p = Photo.objects.all().order_by('-date_taken')
for i in p:
    try:
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

        fp = (i.album.location + i.filepath + "__PASSWORD_GOES_HERE__").replace("/mnt/data/Photos/", "")
        fp1 = f"photo_cache/thumbnail/{i.id}.jpg__PASSWORD_GOES_HERE__"
        hash_ = hashlib.md5(fp.encode('utf-8')).hexdigest()
        hash1_ = hashlib.md5(fp1.encode('utf-8')).hexdigest()

        i.photo_hash = hash_
        i.thumbnail_hash = hash1_
        i.save()

        print(u)

    except (FileNotFoundError, UnidentifiedImageError, OSError):
        print("Error:", i.id)
        i.file_not_available = True
        i.save()
