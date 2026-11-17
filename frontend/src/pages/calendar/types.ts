// Calendar-only shapes the shared lib/types.ts doesn't carry: a calendar's settings detail, its people and
// invite codes, the PATCH body, birthdays from Contacts, and the overlays every view draws on top of events.
import type { Calendar, CalEvent, Task } from '../../lib/types'

export type Person = { id: string; username: string; first_name?: string; last_name?: string; name?: string }
export const personName = (u: Person) => u.name || [u.first_name, u.last_name].filter(Boolean).join(' ') || u.username

export interface CalendarDetail extends Calendar {
  calendar_colour: string // the calendar's own colour (PATCH calendar_colour)
  my_colour: string | null // my personal colour for it (PATCH my_colour)
  icon: string
  description: string
  notify: boolean
  owner?: Person | null
  subscription?: { colour: string | null; visible: boolean; notify: boolean; display_busy: number } | null
  subscriber_count?: number
  sync?: {
    url: string | null
    auto_sync: boolean
    past_months: number
    future_months: number
    last_synced_at: string | null
    last_error: string
    last_sync_error?: string
  } | null
}

export type CalendarPatchBody = Partial<{
  name: string
  calendar_colour: string
  my_colour: string | null
  icon: string
  description: string
  active: boolean
  public: boolean
  time_zone: string
  tags: string[]
  visible: boolean
  notify: boolean
  display_busy: number
  sync: Partial<{ url: string; auto_sync: boolean; past_months: number; future_months: number }>
  calendar_type: number
  calendar_url: string
  auto_sync: boolean
}>

export interface Subscriber {
  id: number
  user: Person
  role: 'owner' | 'admin' | 'subscriber'
  display_busy: number
}

export interface Invite {
  id: number
  code: string
  role: 'admin' | 'subscriber'
  expires_on: string | null
  max_uses: number | null
  uses: number
  active: boolean
  usable: boolean
}

export interface Birthday {
  id: string
  name: string
  date: string
  age: number | null
}

/** What the month, week and day views draw besides events, by day key; plus how to open a task. */
export interface Layers {
  tasks: Map<string, Task[]>
  birthdays: Map<string, Birthday[]>
  photos?: Record<string, number>
  onTask: (t: Task) => void
}

/** How a view hands an event back: open it (the peek) and its colour on this theme. */
export interface EventHandlers {
  colour: (e: CalEvent) => string
  onEvent: (e: CalEvent) => void
}
