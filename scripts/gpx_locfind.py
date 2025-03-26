import pytz
import gpxpy
import gpxpy.gpx
from datetime import timedelta
from django.utils.timezone import is_naive, make_aware
from django.db.models import Q
from photos.models import *

# Define Eastern Time zone
eastern_tz = pytz.timezone("America/Toronto")

# Load GPX file
def parse_gpx(file_path):
    with open(file_path, 'r') as gpx_file:
        gpx = gpxpy.parse(gpx_file)

    points = []
    for track in gpx.tracks:
        for segment in track.segments:
            for point in segment.points:
                timestamp = point.time
                if is_naive(timestamp): timestamp = make_aware(timestamp)
                timestamp = timestamp.astimezone(eastern_tz)

                points.append({
                    "time": timestamp,
                    "lat": point.latitude,
                    "lon": point.longitude,
                    "alt": point.elevation if point.elevation is not None else 0,
                })
    return points

# Find closest points before and after a timestamp
def find_nearest_points(points, target_time, max_diff=timedelta(seconds=30)):
    before = None
    after = None
    for point in points:
        if point["time"] <= target_time:
            before = point
        elif point["time"] > target_time:
            after = point
            break
    
    if before and after:
        time_diff_before = abs(target_time - before["time"])
        time_diff_after = abs(target_time - after["time"])
        
        if time_diff_before <= max_diff and time_diff_after <= max_diff:
            return before, after

    return None, None

# Process photos and update their geotags
def geotag_photos(gpx_file):
    gpx_points = parse_gpx(gpx_file)

    if not gpx_points:
        print("No GPX data found.")
        return

    start_time, end_time = gpx_points[0]["time"], gpx_points[-1]["time"]
    print("Start and end times:", start_time, end_time)

    photos = Photo.objects.filter(Q(album__id__in=[3], date_taken__gte=start_time, date_taken__lte=end_time))
    # photos = Photo.objects.filter(Q(album__id__in=[2, 4], date_taken__gte=start_time, date_taken__lte=end_time) & Q(Q(latitude=None, longitude=None) | Q(latitude=0, longitude=0)))

    print("Found", photos.count(), "photos")

    N = photos.count()
    i = 1
    for photo in photos:
        before, after = find_nearest_points(gpx_points, photo.date_taken)
        if before and after:
            # Average latitude, longitude, and altitude
            avg_lat = (before["lat"] + after["lat"]) / 2
            avg_lon = (before["lon"] + after["lon"]) / 2
            avg_alt = (before["alt"] + after["alt"]) / 2

            # Update photo
            photo.latitude = avg_lat
            photo.longitude = avg_lon
            photo.altitude = avg_alt
            photo.file_not_available = True
            photo.save()
            print(f"Updated photo {photo.id} with lat: {avg_lat}, lon: {avg_lon}, alt: {avg_alt}")
            print(f"[{i}/{N}]")
            i += 1

# Example usage
# geotag_photos("/home/user/walk 12.58.gpx")

import glob
for f in glob.glob("/home/user/GPS/Trip/*.gpx"):
    print(f"Finding locations from file: {f}")
    try:
        geotag_photos(f)
    except gpxpy.gpx.GPXXMLSyntaxException: pass

    print("\n\n\n")
