import datetime
from photos.models import *

calibration_photo = Photo.objects.filter(id="5a52ae29-e90e-4e66-8128-a32942cfadfc")[0]
original_photo = Photo.objects.filter(id="ea674f78-e6aa-4d16-8f5b-0c2c77e8e091")[0]

photo_list = Photo.objects.filter(date_taken__year=2025, camera_make="Canon")

td = original_photo.date_taken - calibration_photo.date_taken

print(td)

size = photo_list.count()
i = 1
for p in photo_list:
    p.date_taken = p.date_taken - td
    p.save()
    print(f"{p.id}: [{i}/{size}]")
    i += 1
