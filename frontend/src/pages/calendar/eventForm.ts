// The event form's values and how they map to and from the API: initial values for a new or existing event
// (times as wall-clock strings in the display zone), the repeat presets, and the request body with validation.
import { addDays, dayKey, parseDayKey } from '../../lib/dates'
import { readPref } from '../../lib/storage'
import type { CalEvent, Calendar, EventIn } from '../../lib/types'
import { allDayRange } from './range'
import { fromZoneInput, toZoneInput, zoneDay, zoneDayKey, type Zone } from './zone'

export type EventDraft = { event: CalEvent } | { start: Date; end?: Date; allDay?: boolean }
export type Kind = 'event' | 'all_day' | 'deadline'

export const REPEATS: [string, string][] = [
  ['', 'Does not repeat'],
  ['FREQ=DAILY', 'Every day'],
  ['FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', 'Every weekday'],
  ['FREQ=WEEKLY', 'Every week'],
  ['FREQ=MONTHLY', 'Every month'],
  ['FREQ=YEARLY', 'Every year'],
]
export const REMINDER_PRESETS = [0, 5, 10, 15, 30, 60, 120, 1440, 2880, 10080]
const HOUR_MS = 3600_000

/** The preset an existing RRULE matches (ignoring UNTIL/COUNT/BYDAY order), or 'custom'. */
function repeatPreset(rrule?: string | null): string {
  if (!rrule) return ''
  const norm = rrule
    .replace(/^RRULE:/i, '')
    .split(';')
    .filter((p) => !/^(UNTIL|COUNT|WKST|INTERVAL=1)\b/i.test(p))
    .sort()
    .join(';')
    .toUpperCase()
  const hit = REPEATS.find(([r]) => r && r.split(';').sort().join(';') === norm)
  return hit ? hit[0] : 'custom'
}

/** The rule to send. An unchanged preset sends the event's own rule back, so its end (UNTIL/COUNT, which the form
 *  has no control for) survives an edit; a bare preset would make the series repeat forever. */
function repeatRule(f: { repeat: string; rrule: string }): string {
  if (f.repeat === 'custom') return f.rrule.trim()
  return f.repeat && f.rrule && repeatPreset(f.rrule) === f.repeat ? f.rrule : f.repeat
}

/** The calendar a new event goes in: the last one used, else the first local one, else any editable one. */
export const LAST_CAL = 'app.cal.last'
export function defaultCalendar(cals: Calendar[]): number | undefined {
  const editable = cals.filter((c) => c.can_edit && c.active)
  const last = readPref<number>(LAST_CAL, 0) || null
  return (editable.find((c) => c.id === last) ?? editable.find((c) => !c.synced) ?? editable[0])?.id
}

/** Form values. Times are wall-clock times in the display zone `tz` (the inputs show that clock). */
export function initialForm(draft: EventDraft, tz: Zone) {
  const blank = {
    calendar: undefined as number | undefined,
    category: '' as number | '',
    location: '',
    description: '',
    colour: '',
    icon: '',
    tags: '',
    repeat: '',
    reminders: null as number[] | null,
    rrule: '',
    meeting: '',
    place: '',
    status: 'confirmed' as NonNullable<CalEvent['status']>,
    busy: true,
    visibility: 'default' as NonNullable<CalEvent['visibility']>,
    completed: false,
  }
  if ('event' in draft) {
    const e = draft.event
    const s = new Date(e.start)
    // All-day events keep their calendar dates as sent (start_date/end_date): converting the
    // instants would shift them in a browser outside the calendar's zone.
    const sDay = zoneDay(s.getTime(), tz)
    const days = allDayRange(e) ?? { first: sDay, last: sDay }
    return {
      ...blank,
      kind: e.kind as Kind,
      name: e.name,
      calendar: e.calendar_id as number | undefined,
      category: e.category_id ?? ('' as number | ''),
      location: e.location ?? '',
      description: e.description ?? '',
      colour: e.colour ?? '',
      icon: e.icon ?? '',
      tags: (e.tags ?? []).join(', '),
      repeat: repeatPreset(e.rrule),
      rrule: e.rrule ?? '',
      meeting: e.meeting_url ?? '',
      place: e.place?.id ?? '',
      status: e.status ?? 'confirmed',
      busy: e.transparency !== 'free',
      visibility: e.visibility ?? 'default',
      start: toZoneInput(e.start, tz),
      end: toZoneInput(e.end ?? new Date(s.getTime() + HOUR_MS).toISOString(), tz),
      startDate: dayKey(days.first),
      endDate: dayKey(days.last),
      completed: e.completed,
    }
  }
  const s = draft.start
  const en = draft.end ?? new Date(s.getTime() + HOUR_MS)
  return {
    ...blank,
    kind: (draft.allDay ? 'all_day' : 'event') as Kind,
    name: '',
    // All-day drafts carry dates (local midnights); timed ones carry instants (their date in tz).
    start: toZoneInput(s.toISOString(), tz),
    end: toZoneInput(en.toISOString(), tz),
    startDate: draft.allDay ? dayKey(s) : zoneDayKey(s.getTime(), tz),
    endDate: draft.allDay ? dayKey(draft.end ? addDays(draft.end, -1) : s) : zoneDayKey(s.getTime(), tz),
  }
}
export type EventForm = ReturnType<typeof initialForm>

/** The request body, or the problem that stops it. */
export function formBody(f: EventForm, calendarId: number | undefined, tz: Zone): EventIn | string {
  if (!f.name.trim()) return 'Give the event a title.'
  if (!calendarId) return 'Pick a calendar you can edit.'
  let start: string | null = null
  let end: string | null = null
  let dates: Pick<EventIn, 'start_date' | 'end_date'> | null = null
  if (f.kind === 'all_day') {
    if (!f.startDate) return 'Pick a date.'
    const last = f.endDate && f.endDate >= f.startDate ? f.endDate : f.startDate
    // Dates only (end exclusive): the server places them in the calendar's zone.
    dates = { start_date: f.startDate, end_date: dayKey(addDays(parseDayKey(last), 1)) }
  } else {
    start = fromZoneInput(f.start, tz)
    if (!start) return 'Pick a start time.'
    if (f.kind === 'event') {
      end = fromZoneInput(f.end, tz)
      if (!end || end <= start) return 'The end must be after the start.'
    }
  }
  return {
    calendar_id: calendarId,
    name: f.name.trim(),
    kind: f.kind,
    ...(dates ?? { start, end }),
    all_day: f.kind === 'all_day',
    category_id: f.category === '' ? null : f.category,
    location: f.location.trim() || null,
    description: f.description.trim() || null,
    colour: f.colour || null,
    icon: f.icon || null,
    tags: f.tags
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean),
    rrule: repeatRule(f),
    ...(f.reminders !== null ? { reminders: f.reminders } : {}),
    meeting_url: f.meeting.trim(),
    place_id: f.place || null,
    status: f.status,
    transparency: f.busy ? 'busy' : 'free',
    visibility: f.visibility,
  }
}

/** A new start keeps the event's length (like Google Calendar); at least 15 minutes. */
export function movedEnd(f: EventForm, start: string, tz: Zone): string | null {
  const oldS = fromZoneInput(f.start, tz)
  const oldE = fromZoneInput(f.end, tz)
  const newS = fromZoneInput(start, tz)
  if (!oldS || !oldE || !newS) return null
  const dur = Math.max(new Date(oldE).getTime() - new Date(oldS).getTime(), 15 * 60_000)
  return toZoneInput(new Date(new Date(newS).getTime() + dur).toISOString(), tz)
}
