// The API's shared types, by the names the app uses. Most are aliases of the schemas generated from the server
// (api-schema.d.ts, see AGENTS.md › API types), so a server change shows up as a type error here or at a call
// site. Hand-written types are for responses the server leaves untyped (a plain dict) and for client-only fields.
import type { components } from './api-schema'

/** Every schema, for the apps' own aliases (`Schemas['PinOut']`). */
export type Schemas = components['schemas']
type S = Schemas

export type UUID = string
export type ISODate = string // "2026-11-04"
export type ISODateTime = string // "2026-11-04T15:00:00Z"

// ---------- me / notifications
export type GroupBrief = S['UsersGroupOut']
export type Me = S['MeOut']
export type MePatch = S['MePatch']

export type Notification = S['NotificationOut']
export type Inbox = S['InboxOut']
export type Count = S['CountOut']
/** A channel's settings are strings (the form's fields; the server stores a plain dict). */
export type Channel = Omit<S['ChannelOut'], 'config'> & { config: Record<string, string> }
// GET /notifications/channel-types: untyped on the server.
export interface ChannelField {
  key: string
  label: string
  required: boolean
  secret: boolean
}
export interface ChannelType {
  kind: string
  label: string
  fields: ChannelField[]
}
export type ReminderSettings = S['ReminderSettingsOut']

// ---------- calendar
export type Calendar = S['CalendarOut']
/** EventOut.category: the server types it as a plain dict. */
export interface CategoryRef {
  id: number
  name: string
  colour: string
  icon: string
}
export type Attendee = S['AttendeeOut']
type WithCategory<T> = Omit<T, 'category'> & {
  category: CategoryRef | null
  /** Client-only: from a disabled calendar shown on request (drawn greyed, read-only). */
  ghost?: boolean
}
/** id: "<uuid>", or "<series uuid>:<UTC ISO start>" for an occurrence of a repeating event. */
export type CalEvent = WithCategory<S['EventOut']>
export type EventDetail = WithCategory<S['EventDetailOut']>
/** An event with as much detail as has loaded: a list's copy until GET /calendar/events/{id} answers. */
export type EventOrDetail = CalEvent & Partial<EventDetail>
export type EventIn = S['EventIn']
export type EventPatch = S['EventPatch']
export type Category = S['CategoryOut']
export type AgendaItem = S['AgendaItem']
// GET /calendar/insights: the server types its sections as plain dicts.
export interface Insights {
  period: string
  start: ISODate
  end: ISODate
  totals: {
    events: number
    timed_events: number
    hours: number
    deadlines: number
    all_day: number
    avg_minutes: number
    longest_minutes: number
    busiest_day: { date: ISODate; hours: number } | null
    free_days: number
    typical_start: string | null
    typical_end: string | null
    evening_hours: number
    early_hours: number
    weekend_hours: number
    meeting_hours: number
    focus_hours: number
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
export type UserBrief = S['TasksUserBrief']
export type Overview = S['TasksOverviewOut']
export type Project = S['ProjectOut']
export type Member = S['MemberOut']
export type Bucket = S['BucketOut']
export type Label = S['LabelOut']
/** filters: URL query values (the server stores a plain dict). */
export type SavedView = Omit<S['ViewOut'], 'filters'> & { filters: Record<string, string> }
export type TaskReminder = S['ReminderOut']
export type Task = S['TaskOut']
export type Relation = S['RelationOut']
export type TaskDetail = S['TaskDetailOut']
export type TaskPage = S['TaskPage']
export type TaskIn = S['TaskIn']
export type TaskPatch = S['TaskPatch']
export type DoneOut = S['DoneOut']
export type Comment = S['CommentOut']

export const PRIORITIES = [
  { value: 5, label: 'Low' },
  { value: 10, label: 'Medium' },
  { value: 15, label: 'High' },
  { value: 20, label: 'Urgent' },
] as const

// ---------- photos
/** city: the city, or the national park (with the city it's in); state: state or province. */
export type Photo = S['PhotoOut']
export type PhotoPage = S['PageOut']
export type YearGroup = S['YearGroup']
// GET /photos/summary: the server types its lists as plain dicts.
export interface PhotoSummary {
  photos: number
  videos: number
  size_kb: number
  first: ISODateTime | null
  last: ISODateTime | null
  countries: { name: string; count: number }[]
  cities: { name: string; count: number }[]
  per_year: { year: number; count: number }[]
}
export type Library = S['LibraryOut']
export type Album = S['ShareAlbumOut']
