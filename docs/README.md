# Nilaya (V1): technical documentation

Technical documentation for Nilaya (V1, code name Comptech), a self-hosted life management and logging platform. The project overview is in the [main README](../README.md).

## Contents

### Calendar App (`scheduler`)

| Document | Description |
|----------|-------------|
| [calendar/DATA_MODEL.md](calendar/DATA_MODEL.md) | All models (`Calendar`, `Subscriber`, `Event`, `Todo`, `Invite`), field-by-field reference, relationships diagram |
| [calendar/ETL_PIPELINES.md](calendar/ETL_PIPELINES.md) | ICalendar sync, Google Calendar sync, UWaterloo WCMS sync, Celery periodic task |

### Photos App (`photos`)

| Document | Description |
|----------|-------------|
| [photos/DATA_MODEL.md](photos/DATA_MODEL.md) | All models (`Album`, `Photo`, `ShareAlbum`, `PhotoLocationCache` materialized view), field-by-field reference, relationships diagram |
| [photos/ETL_PIPELINES.md](photos/ETL_PIPELINES.md) | Photo ingest pipeline (date extraction, EXIF parsing, GPS geocoding, thumbnail generation, hash computation), AI object detection, Celery task |

---

## System Architecture (Brief)

```
Browser: the React app (frontend/, served at /)
      │  JSON API /api/v2/ (Django Ninja), ICS feeds /feeds/
      ▼
Django under Daphne (ASGI, HTTP only)
      │
      ├── scheduler/      ← Calendar: calendars, subscribers, events, invites; Todo (the Tasks app's table)
      ├── tasks/          ← Tasks API: projects, buckets, labels, saved views, comments, relations
      ├── habits/         ← Habits and check-ins
      ├── contacts/       ← People, groups, interactions, imports
      ├── photos/         ← Albums (libraries), Photos, Share Albums, materialized views
      ├── map/            ← Places: location groups and locations
      ├── notifications/  ← Inbox, channels, automatic reminders
      ├── feeds/          ← Private ICS feeds
      ├── apikeys/        ← Per-app API keys
      ├── analytics/      ← Daily usage counts
      ├── users/          ← ComptechUser (custom AbstractUser)
      └── mainsite/       ← Home and site-wide pieces
      │
      ▼
PostgreSQL (Comptech database, psycopg 3 pool)
      │
Redis  ←→  Celery worker + beat
             ├── autosync_calendars    (every 30 minutes)
             ├── ingest_all_photos     (on demand)
             ├── refresh_photo_views   (coalesced matview refresh)
             └── reminders and clean-ups
```

## Key Technology

| Component | Technology |
|-----------|-----------|
| Web framework | Django 5.1, Django Ninja (V2 API) |
| Frontend | React 19, TypeScript, Vite, TanStack Query |
| Database | PostgreSQL (materialized views, connection pool) |
| Task queue | Celery + Redis + django-celery-beat |
| ASGI server | Daphne |
| Image processing | Pillow, OpenCV |
| EXIF reading | Pillow, exifread, PyExifTool |
| GPS geocoding | reverse_geocode (offline) |
| AI object detection | YOLO (ultralytics), optional |
| Calendar parsing | icalendar, python-dateutil |
