# Comptech — Technical Documentation

This directory contains technical documentation for the Comptech platform.

## Contents

### Calendar App (`scheduler`)

| Document | Description |
|----------|-------------|
| [calendar/DATA_MODEL.md](calendar/DATA_MODEL.md) | All models (`Calendar`, `Subscriber`, `Event`, `Todo`, `Invite`), field-by-field reference, relationships diagram |
| [calendar/ETL_PIPELINES.md](calendar/ETL_PIPELINES.md) | ICalendar sync, Google Calendar sync, UWaterloo WCMS sync, Celery periodic task, course injection pipeline |

### Photos App (`photos`)

| Document | Description |
|----------|-------------|
| [photos/DATA_MODEL.md](photos/DATA_MODEL.md) | All models (`Album`, `Photo`, `ShareAlbum`, `PhotoLocationCache` materialized view), field-by-field reference, relationships diagram |
| [photos/ETL_PIPELINES.md](photos/ETL_PIPELINES.md) | Photo ingest pipeline (date extraction, EXIF parsing, GPS geocoding, thumbnail generation, hash computation), AI object detection, Celery task, utility scripts |

---

## System Architecture (Brief)

```
Browser / Client
      │
      ▼
Django (Daphne + Channels for WebSocket)
      │
      ├── scheduler/    ← Calendar, Events, Todos
      ├── photos/       ← Albums, Photos, Share Albums
      ├── map/          ← Location Groups & Points
      ├── users/        ← ComptechUser (custom AbstractUser)
      ├── notifications/
      │
      ▼
PostgreSQL (Comptech database)
      │
Redis  ←→  Celery workers (background tasks)
             ├── autosync_calendars  (periodic)
             └── ingest_all_photos   (on-demand / periodic)
```

## Key Technology

| Component | Technology |
|-----------|-----------|
| Web framework | Django 4.0.5 |
| Database | PostgreSQL |
| Task queue | Celery + Redis + Django Celery Beat |
| Real-time | Django Channels + Daphne |
| Image processing | Pillow, OpenCV |
| EXIF reading | PIL, exifread, PyExifTool, GPSPhoto |
| GPS geocoding | reverse_geocode (offline) |
| AI object detection | YOLOv11 (ultralytics) |
| Calendar parsing | ics, python-dateutil |
