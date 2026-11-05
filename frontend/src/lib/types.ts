// Hand-written from /api/v2/openapi.json (the API is small; regenerate by reading the schema).

export type UUID = string
export type ISODate = string // "2026-11-04"
export type ISODateTime = string // "2026-11-04T15:00:00Z"

// ---------- me / notifications
export interface GroupBrief { id: number; name: string }
export interface Me {
  id: UUID; username: string; first_name: string; last_name: string; email: string; description: string
  birthday: ISODate | null; timezone: string; profile_picture: string; is_staff: boolean; groups: GroupBrief[]
}
export type MePatch = Partial<Pick<Me, 'first_name' | 'last_name' | 'description' | 'birthday' | 'timezone'>>

export interface Notification {
  id: UUID; title: string; body: string; source: string; priority: number; url: string; read: boolean; created_on: ISODateTime
}
export interface Inbox { items: Notification[]; unread: number }
export interface Count { unread: number }
export interface Channel {
  id: UUID; kind: string; name: string; config: Record<string, string>; enabled: boolean; min_priority: number
  last_sent_at: ISODateTime | null; last_error: string
}
export interface ChannelField { key: string; label: string; required: boolean; secret: boolean }
export interface ChannelType { kind: string; label: string; fields: ChannelField[] }
export interface ReminderSettings {
  event_minutes: number; deadline_minutes: number; todo_minutes: number; daily_agenda: boolean; agenda_time: string; deadlines_to_todos: boolean
}

// ---------- calendar
export interface Calendar {
  id: number; name: string; colour: string; role: 'owner' | 'admin' | 'subscriber'; visible: boolean; active: boolean
  public: boolean; calendar_type: number; synced: boolean; can_edit: boolean
  calendar_colour?: string; icon?: string; description?: string; notify?: boolean; owner_id?: string; time_zone?: string; tags?: string[]
}
export interface CategoryRef { id: number; name: string; colour: string; icon: string }
export interface Attendee { id: number; contact_id: string | null; user_id: string | null; name: string; email: string; rsvp: 'needs_action' | 'accepted' | 'declined' | 'tentative'; is_organizer: boolean }
export interface CalEvent {
  id: string // "<uuid>" or "<series uuid>:<UTC ISO start>" for an occurrence of a repeating event
  calendar_id: number; name: string; start: ISODateTime; end: ISODateTime | null; all_day: boolean
  kind: 'event' | 'all_day' | 'deadline'; location: string | null; description: string | null; completed: boolean; priority: number
  series_id?: string | null; override_id?: string | null; recurring?: boolean; original_start?: string | null
  start_date?: string | null; end_date?: string | null
  category_id?: number | null; category?: CategoryRef | null; legacy_category?: number
  place?: { id: string; name: string; address: string | null; latitude: number; longitude: number } | null
  meeting_url?: string; status?: 'confirmed' | 'tentative' | 'cancelled'; transparency?: 'busy' | 'free'
  /** Client-only: from a disabled calendar shown on request (drawn greyed, read-only). */
  ghost?: boolean
  visibility?: 'default' | 'public' | 'private'; colour?: string | null; icon?: string | null; display_colour?: string
  tags?: string[]; rrule?: string | null; recurrence_text?: string
}
export interface EventDetail extends CalEvent { reminders?: number[]; attendees?: Attendee[]; task_id?: string | null }
export interface EventIn {
  calendar_id: number; name: string; kind?: 'event' | 'all_day' | 'deadline'; start?: ISODateTime | null; end?: ISODateTime | null; all_day?: boolean
  /** All-day events: calendar dates, end exclusive (instead of start/end). */
  start_date?: ISODate | null; end_date?: ISODate | null
  category_id?: number | null; location?: string | null; description?: string | null; priority?: number
  colour?: string | null; icon?: string | null; tags?: string[]; rrule?: string; reminders?: number[] | null; meeting_url?: string
  place_id?: string | null; status?: 'confirmed' | 'tentative' | 'cancelled'; transparency?: 'busy' | 'free'; visibility?: 'default' | 'public' | 'private'
}
export type EventPatch = Partial<EventIn> & { completed?: boolean }
export interface Category { id: number; name: string; label: string; colour: string; icon: string; position: number; legacy_id: number }
export interface AgendaItem {
  kind: 'event' | 'all_day' | 'deadline' | 'todo'; id: string; title: string; start: ISODateTime | null; end: ISODateTime | null
  colour: string; calendar: string; location?: string | null; done?: boolean; priority?: number; has_todo?: boolean
  start_date?: ISODate | null; end_date?: ISODate | null // all-day items: dates, end exclusive
}
export interface Insights {
  period: string; start: ISODate; end: ISODate
  totals: {
    events: number; timed_events: number; hours: number; deadlines: number; all_day: number; avg_minutes: number
    longest_minutes: number; busiest_day: { date: ISODate; hours: number } | null; free_days: number
    typical_start: string | null; typical_end: string | null; evening_hours: number; early_hours: number
    weekend_hours: number; meeting_hours: number; focus_hours: number
  }
  previous: { events: number; hours: number; deadlines: number; meeting_hours: number; focus_hours: number }
  by_category: { id: number; label: string; hours: number; events: number }[]
  by_calendar: { id: number; name: string; colour: string; hours: number; events: number }[]
  by_weekday: number[]
  by_hour: number[]
  heat: number[][]
  per_day: { date: ISODate; hours: number; events: number }[]
  todos: { completed: number; completed_previous: number; created: number; due: number; overdue_now: number }
  top_locations: { name: string; count: number }[]
  photos: number
}

// ---------- tasks
export interface UserBrief { id: UUID; username: string; name: string }
export interface Overview {
  inbox: number; today: number; overdue: number; upcoming: number; no_date: number; favorites: number; assigned: number
  done_this_week: number; inbox_id: UUID
  /** Tasks completed since the start of today (user's time zone). */
  done_today: number
}
export interface Project {
  id: UUID; parent_id: UUID | null; name: string; description: string; colour: string; is_inbox: boolean; archived: boolean
  favorite: boolean; position: number; default_view: string; role: number; shared: boolean; open_count?: number; done_count?: number
}
export interface Member { id: number; user: UserBrief; role: number }
export interface Bucket { id: number; project_id: UUID; name: string; position: number; limit: number; is_done: boolean }
export interface Label { id: number; name: string; colour: string }
export interface SavedView { id: UUID; name: string; filters: Record<string, string>; position: number }
export interface TaskReminder { id: number; at: ISODateTime | null; relative_to: string; offset: number; fire_at: ISODateTime | null; sent: boolean }
export interface Task {
  id: UUID; title: string; description: string; done: boolean; done_at: ISODateTime | null; due: ISODateTime | null
  start: ISODateTime | null; priority: number; priority_label: string; project_id: UUID | null; bucket_id: number | null
  position: number; parent_id: UUID | null; labels: number[]; assignees: UserBrief[]; percent: number; time_spent: number
  repeat_mode: number; repeat_every: number | null; favorite: boolean; colour: string; reminders: TaskReminder[]
  subtasks?: number; subtasks_done?: number; comments?: number; event_id: string | null; owner: UserBrief
  created_on: ISODateTime; updated_on: ISODateTime
}
export interface Relation {
  id: number; kind: string; other_id: UUID; other_name: string; other_done: boolean
  other_visible?: boolean // false: a task you can't open (shown as "Private task")
}
export interface TaskDetail extends Task { relations: Relation[] }
export interface TaskPage { items: Task[]; total?: number | null; next?: string | null }
export interface TaskIn {
  title: string; description?: string; project_id?: UUID | null; bucket_id?: number | null; parent_id?: UUID | null
  due?: ISODateTime | null; start?: ISODateTime | null; priority?: number; labels?: number[]; favorite?: boolean; position?: number | null
}
export type TaskPatch = Partial<{
  title: string; description: string; parent_id: UUID | null; due: ISODateTime | null; start: ISODateTime | null
  priority: number; labels: number[]; assignees: string[]; percent: number; time_spent: number; favorite: boolean; colour: string
  repeat_mode: number; repeat_every: number | null
}>
export interface DoneOut { task: Task; repeated: boolean }
export interface Comment { id: UUID; author: UserBrief; body: string; created_on: ISODateTime; edited_on: ISODateTime | null }

export const PRIORITIES = [
  { value: 5, label: 'Low' },
  { value: 10, label: 'Medium' },
  { value: 15, label: 'High' },
  { value: 20, label: 'Urgent' },
] as const

// ---------- photos
export interface Photo {
  id: UUID; thumb_url: string; url: string; width: number | null; height: number | null; aspect: number
  date_taken: ISODateTime | null; video: boolean; length: number | null; city: string | null; country: string | null
  lat: number | null; lon: number | null; camera: string | null; album_id: number
  size_kb?: number | null; size_total_kb?: number | null; megapixels?: number | null; has_raw?: boolean; has_orig?: boolean; blur?: number | null
}
export interface PhotoPage { items: Photo[]; next_before: ISODateTime | null; next_before_id?: UUID | null }
export interface YearGroup { year: number; items: Photo[] }
export interface PhotoSummary {
  photos: number; videos: number; size_kb: number; first: ISODateTime | null; last: ISODateTime | null
  countries: { name: string; count: number }[]; cities: { name: string; count: number }[]; per_year: { year: number; count: number }[]
}
export interface Library { id: number; name: string; role: string; visible: boolean; count: number }
export interface Album { id: UUID; name: string; description: string | null; public: boolean; mine: boolean; count: number; cover: Photo | null; size_kb?: number }

// ---------- places
export interface PlaceGroup { id: number; name: string; description: string; is_public: boolean; mine: boolean; count: number }
export interface Place {
  id: UUID; group_id: number; name: string; description: string; latitude: number; longitude: number; altitude: number | null
  category: string; address: string | null; rating: number | null; notes: string
  status?: 'saved' | 'want_to_go' | 'visited'; visited_on?: string | null; updated_on?: string
}
export type PlaceIn = Omit<Place, 'id' | 'altitude'> & { altitude?: number | null }
export interface PlaceCategory { key: string; label: string }
