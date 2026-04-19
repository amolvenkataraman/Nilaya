# Calendar App — ETL Pipelines

The Calendar app synchronizes events from three external sources: ICalendar feeds, Google Calendar, and the University of Waterloo WCMS API. All sync logic lives in `scheduler/sync.py`. Periodic execution is handled by Celery Beat via `scheduler/tasks.py`.

---

## Overview

```
External Sources                  sync.py                    Database
─────────────────                 ───────                    ────────
ICalendar URL       ──► sync_ical()        ──►  Event.objects (upsert via sync_id)
Google Calendar API ──► sync_google()      ──►  Event.objects (upsert via sync_id)
UWaterloo WCMS API  ──► sync_uwaterloo()   ──►  Event.objects (upsert via sync_id)

Celery Beat (periodic) ──► autosync_calendars() ──► dispatches to above functions
```

All three pipelines share the same **upsert pattern**: look up an existing `Event` by `sync_id`; if found, update it; if not, create it. Cancelled/deleted events from the source are removed from the database.

---

## 1. ICalendar Sync — `sync_ical()`

**Source:** Any `.ics` URL (e.g. iCloud, Outlook, Fastmail)  
**File:** `scheduler/sync.py`  
**Library:** `ics`, `dateutil`, `pytz`

### Pipeline Steps

```
1. HTTP GET  calendar.calendar_url  (requests)
2. Parse ICS text with ics.Calendar()
3. For each event in the feed:
   a. Extract begin/end datetimes (with timezone info)
   b. Detect all-day events:
      - ics flag:  i.all_day == True
      - Heuristic: same calendar date, time == 00:00 UTC
   c. Apply America/Toronto timezone for all-day events
   d. Extend single-day all-day events by +1 day (exclusive end)
   e. Filter to requested [start, end] window
   f. If status == "CANCELLED":
        → Delete matching Event (by sync_id)
      Else:
        → Upsert Event (sync_id = i.uid)
          Fields set: name, calendar, description, allday, sync_id, startdate, enddate
4. Return True on success
```

### Key Fields Mapped

| ICS Field | Event Field |
|-----------|-------------|
| `i.uid` | `sync_id` |
| `i.name` | `name` |
| `i.description` | `description` |
| `i.begin` | `startdate` |
| `i.end` | `enddate` |
| `i.all_day` | `allday` |

### Notes
- Timezone handling is hardcoded to `America/Toronto` for all-day events
- Events outside the requested date window are silently skipped
- Exceptions per-event are caught and logged; one bad event does not abort the sync

---

## 2. Google Calendar Sync — `sync_google()`

**Source:** Google Calendar API v3 (public calendars or OAuth-authorized)  
**File:** `scheduler/sync.py`  
**API:** `https://www.googleapis.com/calendar/v3/`

### Pipeline Steps

```
1. Build API request:
   GET /calendars/{calendar_url}/events
   Params: key, timeMin, timeMax, singleEvents=true, orderBy=startTime, showDeleted=true
   Headers: Authorization: Bearer {token}  (if token provided)
2. Parse JSON response → res["items"]
3. For each event item:
   a. If status == "confirmed":
        → Upsert Event (sync_id = i['id'])
          Fields set: calendar, name, description, sync_id, startdate, enddate, allday
        → All-day detection: use i['start']['date'] key (no 'dateTime')
      If status != "confirmed" (cancelled/tentative):
        → Delete matching Event queryset
4. Return True on success
```

### Key Fields Mapped

| Google API Field | Event Field |
|-----------------|-------------|
| `i['id']` | `sync_id` |
| `i['summary']` | `name` |
| `i['description']` | `description` |
| `i['start']['dateTime']` or `i['start']['date']` | `startdate` |
| `i['end']['dateTime']` or `i['end']['date']` | `enddate` |
| presence of `'date'` key (no `'dateTime'`) | `allday = True` |

### Authentication
- Public calendars: API key only (`GOOGLE_API_KEY` from `Comptech/api.py`)
- Private calendars: OAuth Bearer token passed as `token` parameter

---

## 3. UWaterloo WCMS Sync — `sync_uwaterloo()`

**Source:** University of Waterloo Web Content Management System (WCMS) public events API  
**File:** `scheduler/sync.py`  
**API:** `https://openapi.data.uwaterloo.ca/v3/Wcms/{calendar_url}/events`

### Pipeline Steps

```
1. HTTP GET  openapi.data.uwaterloo.ca/v3/Wcms/{url}/events
   Headers: x-api-key: {UWATERLOO_API_KEY}
2. Parse JSON array response
3. For each event item:
   a. Parse eventStartDate and eventEndDate with dateutil.parser
   b. Apply America/Toronto timezone
   c. Filter to requested [start, end] window
   d. Upsert Event (sync_id = i['uniqueKey'])
      Fields set: name, calendar, description, sync_id, startdate, enddate
4. Return True on success
```

### Key Fields Mapped

| WCMS API Field | Event Field |
|---------------|-------------|
| `i['uniqueKey']` | `sync_id` |
| `i['title']` | `name` |
| `i['content']` | `description` |
| `i['eventStartDate']` | `startdate` |
| `i['eventEndDate']` | `enddate` |

### Notes
- No deletion logic: removed WCMS events are not cleaned up automatically
- Timezone is hardcoded to `America/Toronto`

---

## 4. Periodic Sync — `autosync_calendars()` Celery Task

**File:** `scheduler/tasks.py`  
**Decorator:** `@shared_task`  
**Scheduler:** Django Celery Beat (database-backed)

### Logic

```
1. Check ONLINE_MODE setting — skip entirely if offline
2. Query: Calendar.objects.filter(calendar_type__gt=0, auto_sync=True, active=True)
3. For each eligible calendar:
   a. Determine time zone offset (system local timezone)
   b. Build start_time:
        - If auto_sync_sy == -1 and auto_sync_sm == -1 → use current month
        - Else → use configured auto_sync_sy / auto_sync_sm
   c. Build end_time from auto_sync_ey / auto_sync_em
   d. Dispatch to appropriate sync function:
        - type 1  → sync_ical(cal, start_time, end_time)
        - type 2  → sync_google(cal, start_time, end_time, token=None)
        - type 50 → sync_uwaterloo(cal, start_time, end_time)
4. Exceptions per-calendar are caught; one failure does not abort other calendars
```

### Auto-Sync Configuration (Calendar fields)

| Field | Value | Meaning |
|-------|-------|---------|
| `auto_sync` | True | Include this calendar in periodic sync |
| `auto_sync_sy` / `auto_sync_sm` | -1 / -1 | Always sync from current month |
| `auto_sync_sy` / `auto_sync_sm` | year / month | Sync from fixed start date |
| `auto_sync_ey` / `auto_sync_em` | year / month | Sync up to this end date |

---

## 5. UWaterloo Course Injection — `inject.py`

This is a one-time or on-demand pipeline that injects university course schedules as calendar events, reading from a local SQLite database.

**File:** `scheduler/inject.py`  
**Source:** `UW_Courses.db` (SQLite, local file)

### Term Code Calculation

```python
term_code = ((year - 1900) * 10) + month_code
# month_code: 1=Winter, 5=Spring, 9=Fall
```

### Pipeline Steps

```
1. Open UW_Courses.db SQLite connection
2. Query courses for the given term code
3. For each course section:
   a. Parse meeting pattern (days of week, time slots)
   b. Generate recurring Event objects for the full term
   c. Assign color based on course number (deterministic hash)
   d. Save Events to the target Calendar
```

---

## Manual Sync API

Users can also trigger sync on demand via the API:

```
POST /api/sync/
Body: { "calendar_id": <id>, "start": "<ISO8601>", "end": "<ISO8601>" }
```

This calls the same `sync_ical` / `sync_google` / `sync_uwaterloo` functions directly.

---

## Error Handling Summary

| Layer | Strategy |
|-------|----------|
| Per-event errors (sync_ical) | `try/except Exception`, log and continue |
| Per-event errors (sync_google) | `try/except Exception`, return early with print |
| Per-calendar errors (autosync_calendars) | `try/except`, log and continue to next calendar |
| Network failures | Not retried; rely on Celery Beat's next scheduled run |
