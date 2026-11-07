# Photos App — ETL Pipelines

The Photos app ingests photos and videos from a staging directory, extracts metadata, generates thumbnails, and optionally runs AI object detection. All ingestion logic lives in `photos/indeximg.py`. AI indexing is in `photos/AI/objects.py`. Periodic execution is handled by Celery via `photos/tasks.py`.

---

## Overview

```
Filesystem (Ingest/)
        │
        ▼
photo_ingest_for_album()          [photos/indeximg.py]
        │
        ├── Date extraction (EXIF → filename → file mtime)
        ├── File organization (year/month dirs if split=True)
        ├── Photo record creation (Photo model)
        ├── EXIF metadata extraction (PIL + GPSPhoto)
        ├── Video metadata extraction (ExifTool + OpenCV)
        ├── GPS reverse geocoding (reverse_geocode)
        ├── Thumbnail generation (PIL / OpenCV)
        ├── Hash computation (MD5)
        └── Materialized view refresh (PhotoLocationCache)

(Separate step)
AI object detection                [photos/AI/objects.py]
        └── YOLOv11 → ai_index_info.objects JSON
```

---

## 1. Photo Ingest Pipeline — `photo_ingest_for_album()`

**File:** `photos/indeximg.py`  
**Signature:** `photo_ingest_for_album(album, user, refresh_matviews=True)`

### Trigger Points

- **Manual:** `POST /photos/ingest/` API endpoint
- **Automated:** Celery task `ingest_all_photos` (see section 3)

### Source Directory Convention

```
{album.location}/Ingest/**/*.*
```

Files matching these extensions are processed:
`jpg`, `jpeg`, `png`, `mp4`, `mpg`, `m4v`, `mov`, `mod`, `avi`, `3gp`, `mkv`, `gif`, `heic`

---

### Step-by-Step Pipeline

#### Step 1 — Date Extraction (from source file)

Priority order:

| Priority | Method | Detail |
|----------|--------|--------|
| 1 | EXIF `DateTimeOriginal` | EXIF tag 36867 via `PIL._getexif()` |
| 2 | Filename pattern | `VID_YYYYMMDD_HHMMSS` — strip `VID_`, parse first 15 chars |
| 3 | File modification time | `os.path.getmtime()` |
| 4 | File creation time | `os.path.getctime()` |

#### Step 2 — File Organization

```
If album.split == True:
    destination = {album.location}/{year}/{month}/{filename}
    filepath stored = "{year}/{month}/{filename}"
Else:
    destination = {album.location}/{filename}
    filepath stored = "{filename}"
```

Subdirectories are created with `os.makedirs()` if they don't exist.

#### Step 3 — Duplicate Detection

If the destination file already exists:
- **Skip** — do not overwrite
- **Auto-clean source:** if the file is older than 30 days, delete from Ingest/
- Continue to next file

#### Step 4 — File Copy & Record Creation

```python
shutil.copy2(source, destination)   # preserves metadata timestamps

p = Photo()
p.owner = user
p.album = album
p.filepath = relative_path
p.save()                            # gets UUID assigned
```

#### Step 5 — File Size

```python
p.size = os.path.getsize(filepath) / 1024           # KB
p.size_total = sum of main + orig + raw file sizes   # KB
```

#### Step 6a — Image Metadata Extraction (photos)

For non-video files, PIL is used to extract EXIF:

| Source | Field(s) Set |
|--------|-------------|
| `img.size` | `width`, `height` |
| `GPSPhoto.getGPSData()` | `latitude`, `longitude`, `altitude` |
| EXIF `Make` | `camera_make` |
| EXIF `Model` | `camera_model` |
| EXIF `ExposureTime` | `exposure` |
| EXIF `FNumber` | `fnumber` |
| EXIF `ISOSpeedRatings` | `isospeed` |
| EXIF `ShutterSpeedValue` | `shutterspeed` |
| EXIF `ApertureValue` | `aperture` |
| EXIF `Flash` | `flash` |
| EXIF `FocalLength` | `focallength` |
| EXIF `Orientation` | `orientation` |

Null bytes (`\x00`) in camera make/model strings are stripped.

#### Step 6b — Video Metadata Extraction

For video files (`mp4`, `mov`, `avi`, etc.):

```
p.video = True
p.update_info_exiftool()
```

`update_info_exiftool()` uses PyExifTool to read:

| ExifTool Tag | Field Set |
|-------------|-----------|
| `QuickTime:AndroidManufacturer` | `camera_make` |
| `QuickTime:AndroidModel` | `camera_model` |
| `File:MIMEType` | `mimetype` |
| `Composite:GPSLatitude` | `latitude` |
| `Composite:GPSLongitude` | `longitude` |
| `Composite:GPSAltitude` | `altitude` |
| `Composite:AvgBitrate` | `bitrate` |
| `Composite:Megapixels` | `megapixels` |

#### Step 7 — Date Re-Extraction (from destination file)

The date extraction logic runs a second time against the copied destination file to handle cases where the EXIF was only readable after the copy (or filename needed re-parsing from the final path).

```python
p.date_taken = dt
```

#### Step 8 — Reverse Geocoding

If `latitude` and `longitude` are set (and non-zero):

```python
results = rg.get((p.latitude, p.longitude))
p.location_city = results['city']
p.location_country = results['country']
```

Uses the `reverse_geocode` library (offline, no API calls required).

#### Step 9 — Thumbnail Generation

`p.gen_thumbnail()` dispatches based on file type:

**Images:**
```python
img = Image.open(filepath)
img = ImageOps.exif_transpose(img)   # correct orientation
img.thumbnail((500, 200))
img.save('/www/private/photo_cache/thumbnail/{id}.jpg')
```

**Videos** (`generate_video_thumbnail()`):
```python
cap = cv2.VideoCapture(filepath)
frame = first frame
# Apply rotation correction (90/180/270 degrees)
# Resize to 500×200
# Draw white play-button triangle overlay
# Draw duration label (MM:SS) in top-right corner
img.save(thumbnail_path)
```

After thumbnail is saved, dimensions and dominant color are extracted:
```python
thumb.resize((1, 1)).getpixel((0, 0))  # → dominant RGB
p.main_color = '#{r:02x}{g:02x}{b:02x}'
p.thumbnail_width, p.thumbnail_height = thumb.size
```

#### Step 10 — Hash Generation

```python
# photo_hash: stable token for photo file serving
hash_input = filepath_relative + SALT
p.photo_hash = md5(hash_input)

# thumbnail_hash: stable token for thumbnail serving
thumb_input = f"photo_cache/thumbnail/{id}.jpg{SALT}"
p.thumbnail_hash = md5(thumb_input)
```

The salt is loaded from `/Comptech/salt.txt` at startup.

#### Step 11 — Materialized View Refresh

After all files in the album are processed:
```python
if refresh_matviews:
    refresh_photo_location_cache()
    # → REFRESH MATERIALIZED VIEW photos_photo_location_cache;
```

---

## 2. AI Object Detection — `photos/AI/objects.py`

**Model:** YOLOv11 (`yolo11n_object365.pt`) — 365 object classes  
**Confidence threshold:** 0.5

### Pipeline

```
1. Load Photo by ID
2. Open image file
3. Run YOLO inference
4. Filter detections by confidence ≥ 0.5
5. Build detection list:
   [{"name": "dog", "id": 42, "confidence": 0.87}, ...]
6. Store in photo.ai_index_info["objects"]
7. photo.save()
```

### Querying AI-Indexed Photos

The GIN index on `ai_index_info__objects` enables PostgreSQL containment queries:

```python
Photo.objects.filter(ai_index_info__objects__contains=[{"name": "dog"}])
```

Or in SQL:
```sql
SELECT * FROM photos_photo
WHERE ai_index_info->'objects' @> '[{"name": "dog"}]';
```

---

## 3. Celery Task — `ingest_all_photos()`

**File:** `photos/tasks.py`  
**Decorator:** `@shared_task`

```python
@shared_task
def ingest_all_photos(user_id=None):
    if user_id:
        albums = Album.objects.filter(owner_id=user_id)
    else:
        albums = Album.objects.all()

    for album in albums:
        photo_ingest_for_album(album, album.owner, refresh_matviews=False)

    refresh_photo_location_cache()   # single refresh after all albums
```

- Passing `user_id` scopes ingestion to one user's albums
- Materialized view is refreshed once at the end rather than per-album

---

## 4. One-off maintenance

The old one-off scripts in `scripts/` (bulk EXIF dates, thumbnails, GPX geotagging, reverse geocoding,
clock offsets) were removed. Use the management commands instead: `index_photos` (AI indexing),
`fix_orientation` (thumbnails), and the Locate tool in Photos for missing locations.

---

## File Lifecycle

```
{album.location}/Ingest/subdir/photo.jpg   ← source (user drops files here)
        │
        │  [ingest pipeline]
        ▼
{album.location}/{year}/{month}/photo.jpg  ← permanent storage (if split=True)

/www/private/photo_cache/thumbnail/{uuid}.jpg  ← generated thumbnail

[source file deleted from Ingest/ after 30+ days if already processed]
```

### File Deletion

`delete_photo(p)` in `photos/models.py`:
1. Remove `/www/private/photo_cache/thumbnail/{id}.jpg`
2. Remove `{album.location}/{filepath}`
3. Remove `orig_filepath` and `raw_filepath` if they exist
4. `p.delete()` — removes the database record

---

## Error Handling

| Layer | Strategy |
|-------|----------|
| Date extraction | Cascading fallbacks (EXIF → filename → mtime → ctime) |
| EXIF field extraction | Individual `try/except KeyError` for each field; missing fields silently skipped |
| GPS extraction | `try/except`; photo saved without location data |
| Thumbnail generation | `try/except (FileNotFoundError, UnidentifiedImageError, OSError)`; error printed, photo saved without thumbnail |
| ExifTool errors | `ExifToolExecuteError` caught; returns early without updating |
| Reverse geocoding | Bare `except`; photo saved without city/country |
| Video capture | `FileNotFoundError` raised if OpenCV cannot open file |
