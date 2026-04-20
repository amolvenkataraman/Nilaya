# Photos App — Data Model

The Photos app (Django app: `photos`) is a self-hosted photo and video library. It organizes media into albums, extracts rich metadata from files, and supports sharing and AI-powered object indexing.

---

## Entity Overview

```
ComptechUser
    │
    ├── Album (owner) ◄──────────── Album_Subscriber (user, album)
    │       │
    │       └── Photo (UUID PK)
    │               │
    │               └── ShareAlbum_Photo ──► ShareAlbum (UUID PK)
    │                                              │
    │                                    ShareAlbum_Subscriber (user)
    │
    └── PhotoLocationCache  (read-only materialized view, not managed by Django)
```

---

## Models

### `Album`

Represents a named collection of photos stored at a filesystem path.

| Field | Type | Notes |
|-------|------|-------|
| `id` | Auto PK | |
| `name` | CharField(64) | Display name |
| `owner` | FK → ComptechUser | CASCADE delete; `related_name='album_owner'` |
| `oldestdate` | DateTimeField | Nullable; updated during ingest |
| `newestdate` | DateTimeField | Nullable; updated during ingest |
| `picture` | ImageField | Cover photo stored at `photos/album/{id}/` |
| `location` | CharField(128) | Absolute filesystem path to the album root (e.g. `/mnt/data/Photos/MyAlbum/`) |
| `split` | BooleanField | If true, photos are organized in `{year}/{month}/` subdirectories |

---

### `Album_Subscriber`

Connects a user to an album with an access role.

| Field | Type | Notes |
|-------|------|-------|
| `id` | Auto PK | |
| `album` | FK → Album | CASCADE delete; `related_name='users_subscribed'` |
| `user` | FK → ComptechUser | CASCADE delete; `related_name='album_subscribed'` |
| `subscribe_type` | PositiveSmallIntegerField | 0=Owner, 1=Editor, 2=Viewer |
| `visible` | BooleanField | Whether this album appears in the user's view |

---

### `Photo`

The central model. Represents a single photo or video file with full EXIF and GPS metadata.

#### Identity & File

| Field | Type | Notes |
|-------|------|-------|
| `id` | UUIDField (PK) | Auto-generated, non-editable |
| `owner` | FK → ComptechUser | CASCADE delete; `related_name='photo_owner'` |
| `album` | FK → Album | PROTECT (cannot delete album while photos exist); `related_name='photo_album'` |
| `filepath` | CharField(128) | Path relative to `album.location` |
| `raw_filepath` | CharField(128) | Path to RAW file if present (nullable) |
| `orig_filepath` | CharField(128) | Path to original before any processing (nullable) |
| `photo_hash` | CharField(32) | MD5 of `filepath + SALT` — used as a stable cache-busting token |
| `thumbnail_hash` | CharField(32) | MD5 of thumbnail path + SALT |

#### Image Dimensions & Appearance

| Field | Type | Notes |
|-------|------|-------|
| `width` | IntegerField | Original image width in pixels |
| `height` | IntegerField | Original image height in pixels |
| `thumbnail_width` | IntegerField | Thumbnail width after resizing |
| `thumbnail_height` | IntegerField | Thumbnail height after resizing |
| `main_color` | CharField(7) | Dominant color as hex (e.g. `#a3c4f5`), computed from 1×1 pixel resize |
| `orientation` | CharField(32) | EXIF orientation value |

#### GPS & Location

| Field | Type | Notes |
|-------|------|-------|
| `latitude` | FloatField | Decimal degrees, nullable |
| `longitude` | FloatField | Decimal degrees, nullable |
| `altitude` | FloatField | Meters above sea level, nullable |
| `location_city` | CharField(128) | Reverse-geocoded city name |
| `location_country` | CharField(32) | Reverse-geocoded country code/name |

#### Timestamp

| Field | Type | Notes |
|-------|------|-------|
| `date_taken` | DateTimeField | From EXIF DateTimeOriginal; falls back to filename pattern or file mtime |

#### Video-Specific

| Field | Type | Notes |
|-------|------|-------|
| `video` | BooleanField | True if the file is a video |
| `length` | IntegerField | Duration in seconds |
| `framerate` | IntegerField | Frames per second |
| `mimetype` | CharField(32) | MIME type (e.g. `video/mp4`) |
| `bitrate` | IntegerField | Average bitrate in kbps |

#### Camera & Exposure (EXIF)

| Field | Type | Notes |
|-------|------|-------|
| `camera_make` | CharField(32) | Camera manufacturer |
| `camera_model` | CharField(32) | Camera model |
| `exposure` | CharField(32) | Exposure time (e.g. `1/500`) |
| `fnumber` | CharField(32) | F-number (e.g. `f/2.8`) |
| `isospeed` | CharField(32) | ISO speed rating |
| `shutterspeed` | CharField(32) | Shutter speed value |
| `aperture` | CharField(32) | Aperture value |
| `flash` | CharField(32) | Flash fired/not fired |
| `focallength` | CharField(32) | Focal length in mm |

#### File Size

| Field | Type | Notes |
|-------|------|-------|
| `megapixels` | FloatField | Computed from width × height |
| `size` | IntegerField | Size of the main file in KB |
| `size_total` | IntegerField | Total size including RAW and original files in KB |

#### Metadata & AI

| Field | Type | Notes |
|-------|------|-------|
| `metadata` | JSONField | Raw EXIF metadata dump (nullable) |
| `ai_index_info` | JSONField | AI analysis results; `ai_index_info.objects` holds YOLO detections |
| `file_not_available` | BooleanField | Set when the file is missing from disk |

#### Database Index

```python
GinIndex(fields=['ai_index_info__objects'], name='idx_objects_gin')
```

The GIN index on the `objects` key inside `ai_index_info` enables fast filtering like:
```sql
WHERE ai_index_info->'objects' @> '[{"name": "dog"}]'
```

---

### `ShareAlbum`

A curated collection of photos shared with specific users or publicly.

| Field | Type | Notes |
|-------|------|-------|
| `id` | UUIDField (PK) | |
| `owner` | FK → ComptechUser | CASCADE; `related_name='sharealbum_owner'` |
| `name` | CharField(64) | |
| `description` | TextField | Nullable |
| `public` | BooleanField | If true, accessible without login |

---

### `ShareAlbum_Photo`

Junction table linking individual photos into a share album.

| Field | Type | Notes |
|-------|------|-------|
| `sharealbum` | FK → ShareAlbum | CASCADE; `related_name='sharealbum_photos'` |
| `photo` | FK → Photo | CASCADE; `related_name='photo_in_sharealbum'` |

---

### `ShareAlbum_Subscriber`

Connects a user to a share album with an access role.

| Field | Type | Notes |
|-------|------|-------|
| `album` | FK → ShareAlbum | CASCADE; `related_name='sharealbum_users_subscribed'` |
| `user` | FK → ComptechUser | CASCADE; `related_name='sharealbum_subscribed'` |
| `subscribe_type` | PositiveSmallIntegerField | 0=Owner, 1=Editor, 2=Viewer |
| `visible` | BooleanField | |

---

### `PhotoLocationCache` (Materialized View)

A PostgreSQL materialized view providing pre-aggregated GPS data for heatmap rendering. **Django does not manage this table** (`managed = False`).

| Field | Type | Notes |
|-------|------|-------|
| `album_id` | IntegerField | FK to Album (not enforced at DB level) |
| `lat` | FloatField | Latitude rounded to 5 decimal places |
| `lng` | FloatField | Longitude rounded to 5 decimal places |
| `on_plane` | BooleanField | True if altitude > 1000m |
| `dt_year` | IntegerField | Year extracted from `date_taken` |
| `cnt` | IntegerField | Number of photos at this location cluster |

**SQL definition** (`photos/sql/photo_location_cache.sql`):
```sql
CREATE MATERIALIZED VIEW photos_photo_location_cache AS
SELECT
    album_id,
    ROUND(latitude, 5)  AS lat,
    ROUND(longitude, 5) AS lng,
    (altitude > 1000)   AS on_plane,
    EXTRACT(year FROM date_taken) AS dt_year,
    COUNT(*) AS cnt
FROM photos_photo
WHERE latitude IS NOT NULL AND longitude IS NOT NULL
GROUP BY
    album_id,
    ROUND(latitude, 5),
    ROUND(longitude, 5),
    EXTRACT(year FROM date_taken),
    (altitude > 1000)
HAVING ROUND(latitude, 5) <> 0 OR ROUND(longitude, 5) <> 0;
```

**Refresh:** Called automatically after each ingest via `refresh_photo_location_cache()`.

---

## Relationships Diagram

```
┌────────────────┐        ┌──────────────────────┐
│ ComptechUser   │        │       Album          │
│                │◄───────│  owner (FK)          │
└────────────────┘        │  location (fs path)  │
        │                 │  split (bool)        │
        │                 └──────────┬───────────┘
        │                            │
        │  ┌─────────────────────────┤
        │  │                         │
        │  ▼                         ▼
        │ ┌──────────────┐     ┌────────────────────────────────────┐
        │ │Album_Subscriber│   │              Photo                 │
        │ │ subscribe_type│   │  UUID PK                           │
        │ └──────────────┘    │  filepath, raw_filepath            │
        │                     │  latitude, longitude, altitude     │
        │                     │  date_taken (EXIF / filename / fs) │
        │                     │  ai_index_info (JSON + GIN index)  │
        │                     └───────────────┬────────────────────┘
        │                                     │
        │                             ┌───────┘
        │                             ▼
        │                    ┌─────────────────┐
        │                    │ ShareAlbum_Photo │
        │                    └────────┬────────┘
        │                             │
        │                             ▼
        │                    ┌──────────────────────┐
        │                    │      ShareAlbum      │
        │                    │  UUID PK             │
        │                    │  public (bool)       │
        └────────────────────┤  owner (FK)          │
                             └──────────────────────┘
                                      │
                                      ▼
                             ┌──────────────────────┐
                             │ ShareAlbum_Subscriber│
                             └──────────────────────┘
```

---

## Thumbnail Storage

Thumbnails are stored outside the Django media root:

- **Path:** `/www/private/photo_cache/thumbnail/{photo_id}.jpg`
- **Dimensions:** Max 500×200 px (aspect ratio preserved)
- **Videos:** First frame is extracted, play-button overlay and duration label are added
- **Access:** Served through the `/photos/photo/{photo_id}/thumbnail/` view (auth required)

---

## Database Notes

- Database: PostgreSQL (`Comptech`)
- Migrations in `photos/migrations/` (17 migrations)
- `Photo.album` uses `on_delete=PROTECT` — an album cannot be deleted while it has photos
- `PhotoLocationCache` must be created manually with the SQL in `photos/sql/photo_location_cache.sql` before the heatmap feature works
- The GIN index on `ai_index_info__objects` must exist for AI object filtering to be performant
