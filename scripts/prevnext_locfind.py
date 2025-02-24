import pytz
from datetime import timedelta
from django.utils.timezone import is_naive, make_aware
from django.db.models import Q
from photos.models import *

#, 4
photos = Photo.objects.filter(Q(album__id__in=[2], date_taken__year=2021) & Q(Q(latitude=None, longitude=None) | Q(latitude=0, longitude=0)))

N = photos.count()
i = 1
for ph in photos:
    pb = Photo.objects.filter(album__id=2, date_taken__lt=ph.date_taken).exclude(Q(latitude=None, longitude=None) | Q(latitude=0, longitude=0)).order_by('-date_taken')[0]
    pa = Photo.objects.filter(album__id=2, date_taken__gt=ph.date_taken).exclude(Q(latitude=None, longitude=None) | Q(latitude=0, longitude=0)).order_by('date_taken')[0]

    tb = (ph.date_taken - pb.date_taken).seconds
    ta = (pa.date_taken - ph.date_taken).seconds
    updated = True

    if (tb < 60 and ta < 60) and (tb / ta < 0.5):
        ph.latitude = pb.latitude
        ph.longitude = pb.longitude
        ph.altitude = pb.altitude

    elif (tb < 60 and ta < 60) and (ta / tb < 0.5):
        ph.latitude = pa.latitude
        ph.longitude = pa.longitude
        ph.altitude = pa.altitude

    elif tb < 60 and ta < 60:
        ph.latitude = (pb.latitude + pa.latitude) / 2
        ph.longitude = (pb.longitude + pa.longitude) / 2
        ph.altitude = (pb.altitude + pa.altitude) / 2

    elif tb < 30:
        ph.latitude = pb.latitude
        ph.longitude = pb.longitude
        ph.altitude = pb.altitude

    elif ta < 30:
        ph.latitude = pa.latitude
        ph.longitude = pa.longitude
        ph.altitude = pa.altitude

    else:
        updated = False

    if updated:
        ph.file_not_available = True
        ph.save()
        print(ph.id, f"[{i}/{N}]")
        i += 1
