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
    ├── PhotoLocationCache  (materialized view: heat map and place lists)
    └── PhotoDaily          (materialized view: per-library, per-day counts and sizes)
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

A PostgreSQL materialized view with pre-aggregated GPS points for the heat map and place lists. Django doesn't manage the table (`managed = False`); migrations create it (`0025`, changed in `0027` and `0029`). On SQLite (local testing) it's a plain view.

| Field | Type | Notes |
|-------|------|-------|
| `album_id` | IntegerField | Library album (not enforced at DB level) |
| `lat` | FloatField | Latitude rounded to 5 decimal places |
| `lng` | FloatField | Longitude rounded to 5 decimal places |
| `on_plane` | BooleanField | True if altitude ≥ 2,000 m (`PLANE_ALTITUDE_M`); left out of heat maps and place lists |
| `dt_year` | IntegerField | Year of `date_taken` |
| `cnt` | IntegerField | Number of photos at this point |

**Current definition** (migration `0029`):
```sql
CREATE MATERIALIZED VIEW photos_photo_location_cache AS
SELECT album_id,
       round(latitude::numeric, 5)  AS lat,
       round(longitude::numeric, 5) AS lng,
       altitude >= 2000             AS on_plane,
       EXTRACT(year FROM date_taken) AS dt_year,
       count(*) AS cnt
FROM photos_photo
WHERE NOT hidden
  AND latitude IS NOT NULL AND longitude IS NOT NULL
  AND latitude <> 0 AND longitude <> 0          -- a coordinate of exactly 0 is broken GPS
GROUP BY album_id, lat, lng, on_plane, dt_year
WITH DATA;
CREATE UNIQUE INDEX photos_location_cache_uniq
    ON photos_photo_location_cache (album_id, lat, lng, on_plane, dt_year);
```

Hidden photos and broken GPS (a latitude or longitude of exactly 0) are left out.

---

### `PhotoDaily` (Materialized View)

One row per library album and local day, used for timeline day badges, Stats and Storage. Created by migration `0026`; since `0032` it counts every photo that isn't hidden, including ones flagged `file_not_available` (a stale flag: the files exist).

| Field | Type | Notes |
|-------|------|-------|
| `id` | CharField (PK) | `"<album_id>-<day>"` |
| `album_id` | IntegerField | Library album |
| `day` | DateField | `date_taken` in the server's time zone |
| `photos` / `videos` | IntegerField | Counts |
| `size_kb` / `size_total_kb` | BigIntegerField | Optimized and original sizes |
| `length_s` | BigIntegerField | Total video length |

**Refresh (both views):** `REFRESH MATERIALIZED VIEW CONCURRENTLY`. Edits, hiding and deletes made in the app queue a coalesced refresh through the Celery task `refresh_photo_views` (`photos/cache.py`), so a burst of changes causes one refresh; ingest refreshes both views when it finishes.

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
- Migrations in `photos/migrations/` (32 migrations)
- `Photo.album` uses `on_delete=PROTECT` — an album cannot be deleted while it has photos
- Both materialized views are created by migrations; nothing has to be run by hand
- Indexes: `photo_date_taken_idx (date_taken, id)` for the timeline and keyset paging, `photo_lat_lng_idx (latitude, longitude)` for photos near a place
- The GIN index on `ai_index_info__objects` must exist for AI object filtering to be performant
