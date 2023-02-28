from photos.models import *
from PIL import Image, ExifTags, ImageOps
from PIL.ExifTags import TAGS, GPSTAGS

p = Photo.objects.all()
for i in p:
    try:
        if i.video == False:
            u = i.album.location + i.filepath 
            img = Image.open(u)               
            img = ImageOps.exif_transpose(img)
            img.thumbnail((500, 200), Image.ANTIALIAS)
            img.save('/opt/Comptech/photo_cache/thumbnail/' + str(i.id) + '.jpg', "JPEG")
            print(u)
    except: pass
