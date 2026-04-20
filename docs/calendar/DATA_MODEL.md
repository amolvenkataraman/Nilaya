# Calendar App — Data Model

The Calendar app (Django app: `scheduler`) manages events, to-do items, and multi-source calendar synchronization.

---

## Entity Overview

```
ComptechUser
    │
    ├── Calendar (owner) ◄──────── Subscriber (user, calendar)
    │       │
    │       ├── Event
    │       └── Invite
    │
    └── Todo (self-referential parent/child)
```

---

## Models

### `Calendar`

Represents a calendar owned by a user. Supports local, ICalendar, Google Calendar, and UWaterloo WCMS sources.

| Field | Type | Notes |
|-------|------|-------|
| `id` | Auto PK | |
| `name` | CharField(64) | Not unique; multiple calendars can share a name |
| `owner` | FK → ComptechUser | CASCADE delete |
| `colour` | CharField(16) | Hex color, e.g. `#3498db` |
| `public` | BooleanField | Whether the calendar is publicly visible |
| `active` | BooleanField | Soft-disable a calendar without deleting it |
| `calendar_type` | PositiveSmallIntegerField | See type codes below |
| `calendar_url` | CharField(256) | URL or calendar ID for external sync sources |
| `auto_sync` | BooleanField | Enable periodic background sync |
| `auto_sync_sm` / `auto_sync_sy` | IntegerField | Sync start month/year (`-1` = current month) |
| `auto_sync_em` / `auto_sync_ey` | IntegerField | Sync end month/year |

**Calendar type codes:**

| Code | Label |
|------|-------|
| 0 | Local Calendar |
| 1 | ICalendar (`.ics` URL) |
| 2 | Google Calendar (public API) |
| 50 | UWaterloo WCMS |

---

### `Subscriber`

Junction model linking a `ComptechUser` to a `Calendar` with a role and display preferences.

| Field | Type | Notes |
|-------|------|-------|
| `id` | Auto PK | |
| `calendar` | FK → Calendar | CASCADE delete; `related_name='users_subscribed'` |
| `user` | FK → ComptechUser | CASCADE delete; `related_name='calendar_subscribed'` |
| `subscribe_type` | PositiveSmallIntegerField | 0=Owner, 1=Admin, 2=Subscriber |
| `display_busy` | PositiveSmallIntegerField | 0=None, 1=Event Type Only, 2=All |
| `colour` | CharField(16) | Per-subscriber color override (nullable) |
| `visible` | BooleanField | Whether this calendar is shown in the user's view |

---

### `Invite`

Shareable invite codes for joining a calendar.

| Field | Type | Notes |
|-------|------|-------|
| `id` | Auto PK | |
| `calendar` | FK → Calendar | CASCADE delete |
| `code` | CharField(8) | Unique 8-character random code |
| `uses` | IntegerField | Number of times the code has been used |
| `active` | BooleanField | Whether the code can still be used |

---

### `Event`

A calendar event. Uses UUID primary keys to support cross-system sync.

| Field | Type | Notes |
|-------|------|-------|
| `id` | UUIDField (PK) | Auto-generated, non-editable |
| `calendar` | FK → Calendar | CASCADE delete |
| `name` | CharField(256) | Event title |
| `startdate` | DateTimeField | |
| `enddate` | DateTimeField | Nullable for single-point events |
| `allday` | BooleanField | If true, times are ignored in display |
| `category` | PositiveSmallIntegerField | See category codes below |
| `location` | CharField(256) | Nullable free-text location |
| `description` | TextField | Nullable |
| `completed` | BooleanField | For task-like events |
| `public` | BooleanField | Whether the event is visible to other users |
| `priority` | SmallIntegerField | Default 10; lower = higher priority |
| `repeat_every` | IntegerField | Repeat interval in days (nullable) |
| `repeat_end` | DateField | Date after which recurrence stops (nullable) |
| `sync_id` | CharField(256) | External UID from source system (ICS uid, Google event id, UW uniqueKey) |
| `custom_info` | JSONField | Extensible metadata bag |

**Event category codes:**

| Code | Label |
|------|-------|
| 0 | Uncategorized |
| 1 | Meeting |
| 2 | Focus Time |
| 3 | Break Time |
| 4 | Study |
| 5 | Work |
| 6 | Personal |
| 7 | Tech Break |
| 8 | Test / Exam |
| 9 | Lecture |
| 100 | Other |

---

### `Todo`

A hierarchical to-do item owned by a user. Supports parent/child nesting (one level of subtasks).

| Field | Type | Notes |
|-------|------|-------|
| `id` | UUIDField (PK) | Auto-generated |
| `parent` | FK → self | Nullable; CASCADE delete from parent |
| `user` | FK → ComptechUser | CASCADE delete |
| `name` | CharField(256) | |
| `status` | PositiveSmallIntegerField | See status codes below |
| `description` | TextField | Nullable |
| `priority` | SmallIntegerField | Default 10 |
| `completed` | BooleanField | Quick-complete flag |
| `complete_by` | DateTimeField | Deadline (nullable) |
| `completed_on` | DateTimeField | Actual completion timestamp (nullable) |
| `percent_complete` | PositiveSmallIntegerField | 0–100 (nullable) |
| `time_spent` | PositiveSmallIntegerField | Minutes logged (nullable) |
| `custom_info` | JSONField | Extensible metadata bag |

**Todo status codes:**

| Code | Label |
|------|-------|
| 0 | Uncategorized |
| 1 | Backlog |
| 2 | Waiting |
| 3 | To-do |
| 11 | Design |
| 12 | In-Progress |
| 13 | Testing |
| 100 | Completed |

---

## Relationships Diagram

```
┌──────────────────┐         ┌───────────────────┐
│  ComptechUser    │         │     Calendar      │
│  (users app)     │◄────────│  owner (FK)       │
└──────────────────┘         │  calendar_type    │
        │                    │  auto_sync        │
        │                    └───────┬───────────┘
        │                            │
        │   ┌────────────────────────┤
        │   │                        │
        │   ▼                        ▼
        │  ┌───────────────┐   ┌──────────┐   ┌──────────────┐
        │  │  Subscriber   │   │  Event   │   │   Invite     │
        │  │  user (FK)    │   │  UUID PK │   │  code unique │
        │  │  calendar(FK) │   │  sync_id │   └──────────────┘
        │  └───────────────┘   └──────────┘
        │
        ▼
   ┌──────────────────────────┐
   │          Todo            │
   │  UUID PK                 │
   │  parent → self (nullable)│
   └──────────────────────────┘
```

---

## Database Notes

- Database: PostgreSQL (`Comptech`)
- All migrations are in `scheduler/migrations/` (30 migrations as of this writing)
- `Event` and `Todo` use UUID PKs to support safe external system integration
- `sync_id` on `Event` is the deduplication key for all external sync sources
- `custom_info` JSON fields allow schema-free metadata without new migrations
