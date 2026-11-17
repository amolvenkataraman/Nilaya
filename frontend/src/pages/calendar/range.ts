// What the calendar shows: the URL state (view, date, insights), each view's visible days and the instants to
// fetch for them, stepping and titles, and which days an event covers. Pure, so it's unit-tested.
import { addDays, addMonths, dayKey, fmtDate, monthGrid, parseDayKey, startOfDay, startOfWeek } from '../../lib/dates'
import type { CalEvent } from '../../lib/types'
import { dayStartIn, zoneDay, zoneDayKey, type WeekStart, type Zone } from './zone'

export type CalView = 'month' | 'week' | 'day' | 'agenda'
export type InsightsPeriod = 'week' | 'month'

export interface CalState {
  view: CalView
  date: Date
  insights: InsightsPeriod | null
  isNew: boolean
}

export function parseCalState(search: URLSearchParams, today = new Date()): CalState {
  const v = search.get('view')
  const view: CalView = v === 'week' || v === 'day' || v === 'agenda' ? v : 'month'
  const d = search.get('date')
  const date = d && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(parseDayKey(d).getTime()) ? parseDayKey(d) : startOfDay(today)
  const i = search.get('insights')
  return { view, date, insights: i === 'week' || i === 'month' ? i : null, isNew: search.get('new') === '1' }
}

/** Visible [start, end) for a view. `days` is the week view's width (7 on desktop, 3 or 1 on phones);
 *  `weekStart` the first day of a week (0 Sunday, 1 Monday). */
export function viewRange(view: CalView, date: Date, days = 7, weekStart: WeekStart = 1): { start: Date; end: Date; days: Date[] } {
  if (view === 'month') {
    const grid = monthGrid(date, weekStart)
    const start = grid[0][0]
    return { start, end: addDays(grid[5][6], 1), days: grid.flat() }
  }
  const n = view === 'day' ? 1 : days
  const start = n === 7 ? startOfWeek(date, weekStart) : startOfDay(date)
  const list = Array.from({ length: n }, (_, i) => addDays(start, i))
  return { start, end: addDays(start, n), days: list }
}

/** The instants to fetch for visible days [start, end): their midnights in the display zone, widened
 *  to the browser's own midnights so all-day items (filed by date) at the edges still come. */
export function fetchRange(range: { start: Date; end: Date }, tz: Zone): { start: string; end: string } {
  const s = Math.min(range.start.getTime(), dayStartIn(range.start, tz))
  const e = Math.max(range.end.getTime(), dayStartIn(range.end, tz))
  return { start: new Date(s).toISOString(), end: new Date(e).toISOString() }
}

/** Move the anchor date one step (month / week-or-days) forward (+1) or back (-1). */
export function stepDate(view: CalView, date: Date, dir: number, days = 7): Date {
  if (view === 'month') return addMonths(date, dir)
  return addDays(date, dir * (view === 'day' ? 1 : days))
}

export function rangeTitle(view: CalView, date: Date, days = 7, weekStart: WeekStart = 1, today = new Date()): string {
  if (view === 'month' || view === 'agenda') return fmtDate(view === 'agenda' ? today : date, { month: 'long', year: 'numeric' })
  const { start, end } = viewRange(view, date, days, weekStart)
  const last = addDays(end, -1)
  if (view === 'day' || days === 1) return fmtDate(start, { weekday: 'short', month: 'long', day: 'numeric', year: 'numeric' })
  if (start.getMonth() === last.getMonth()) return fmtDate(start, { month: 'long', year: 'numeric' })
  if (start.getFullYear() === last.getFullYear())
    return `${fmtDate(start, { month: 'short' })} – ${fmtDate(last, { month: 'short', year: 'numeric' })}`
  return `${fmtDate(start, { month: 'short', year: 'numeric' })} – ${fmtDate(last, { month: 'short', year: 'numeric' })}`
}

/** An all-day event's local days from its date-only fields ([start_date, end_date), end exclusive).
 *  These are calendar dates, never converted from instants: in a browser outside the calendar's
 *  zone the instants fall on other days. Null when the event isn't all-day or has no dates. */
export function allDayRange(e: Pick<CalEvent, 'all_day' | 'start_date' | 'end_date'>): { first: Date; last: Date } | null {
  if (!e.all_day || !e.start_date) return null
  const first = parseDayKey(e.start_date)
  return { first, last: e.end_date && e.end_date > e.start_date ? addDays(parseDayKey(e.end_date), -1) : first }
}

/** The day key an event is filed under (its first day; timed events by the display zone's date). */
export const eventDayKey = (e: CalEvent, tz?: Zone) =>
  e.all_day && e.start_date ? e.start_date : zoneDayKey(new Date(e.start).getTime(), tz)

/** All-day events and multi-day timed events cover every day they touch; [start, end) with end exclusive.
 *  Timed events by their dates in the display zone; all-day events by their own dates, in any zone. */
export function eventDays(e: CalEvent, tz?: Zone): { first: Date; last: Date } {
  const dates = allDayRange(e)
  if (dates) return dates
  const s = new Date(e.start).getTime()
  const first = zoneDay(s, tz)
  if (!e.end) return { first, last: first }
  // Exclusive end: an event ending exactly at midnight doesn't touch the next day.
  return { first, last: zoneDay(Math.max(s, new Date(e.end).getTime() - 1), tz) }
}

/** Events per day key (in the display zone), sorted: all-day first, then by start time. */
export function eventsByDay(events: CalEvent[], tz?: Zone): Map<string, CalEvent[]> {
  const map = new Map<string, CalEvent[]>()
  for (const e of events) {
    const { first, last } = eventDays(e, tz)
    for (let d = first, n = 0; d <= last && n < 62; d = addDays(d, 1), n++) {
      const k = dayKey(d)
      const list = map.get(k)
      if (list) list.push(e)
      else map.set(k, [e])
    }
  }
  for (const list of map.values()) {
    list.sort(
      (a, b) =>
        Number(b.all_day) - Number(a.all_day) ||
        (a.all_day ? (a.start_date ?? '').localeCompare(b.start_date ?? '') : 0) ||
        a.start.localeCompare(b.start) ||
        a.name.localeCompare(b.name),
    )
  }
  return map
}
