import reverse_geocode as rg
from photos.models import *
from django.db.models import Q

for p in Photo.objects.filter(location_city=None, location_country=None, latitude__isnull=False, longitude__isnull=False):
    if p.latitude == 0 or p.longitude == 0: continue

    print(p.id)
    results = rg.get((p.latitude, p.longitude))
    print(results)
    p.location_city = results['city']
    p.location_country = results['country']
    p.save()
