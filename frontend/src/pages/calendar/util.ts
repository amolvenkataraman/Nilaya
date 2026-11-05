// Pure helpers for the Calendar page: view ranges, per-day event placement and overlap layout.
import { addDays, dayKey, parseDayKey, startOfDay, startOfWeek, monthGrid, addMonths, fmtDate } from '../../lib/dates'
import type { CalEvent } from '../../lib/types'
import { atZoneMin, dayStartIn, zoneDay, zoneDayKey, zoneMinutes, type WeekStart, type Zone } from './zone'

export type CalView = 'month' | 'week' | 'day' | 'agenda'

export interface CalState { view: CalView; date: Date; insights: 'week' | 'month' | null; isNew: boolean }

export function parseCalState(search: URLSearchParams, today = new Date()): CalState {
  const v = search.get('view')
  const view: CalView = v === 'week' || v === 'day' || v === 'agenda' ? v : 'month'
  const d = search.get('date')
  const date = d && /^\d{4}-\d{2}-\d{2}$/.test(d) && !isNaN(parseDayKey(d).getTime()) ? parseDayKey(d) : startOfDay(today)
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
  if (view === 'day') days = 1
  const start = days === 7 ? startOfWeek(date, weekStart) : startOfDay(date)
  const list = Array.from({ length: days }, (_, i) => addDays(start, i))
  return { start, end: addDays(start, days), days: list }
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
  if (view === 'month') {
    const d = addMonths(date, dir)
    return d
  }
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
export const eventDayKey = (e: CalEvent, tz?: Zone) => (e.all_day && e.start_date ? e.start_date : zoneDayKey(new Date(e.start).getTime(), tz))

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

export const isAllDayLike = (e: CalEvent) => e.all_day

/** Events per day key (in the display zone), sorted: all-day first, then by start time. */
export function eventsByDay(events: CalEvent[], tz?: Zone): Map<string, CalEvent[]> {
  const map = new Map<string, CalEvent[]>()
  for (const e of events) {
    const { first, last } = eventDays(e, tz)
    for (let d = first, n = 0; d <= last && n < 62; d = addDays(d, 1), n++) {
      const k = dayKey(d)
      let list = map.get(k)
      if (!list) map.set(k, (list = []))
      list.push(e)
    }
  }
  for (const list of map.values()) {
    list.sort((a, b) => Number(b.all_day) - Number(a.all_day) || (a.all_day ? (a.start_date ?? '').localeCompare(b.start_date ?? '') : 0) || a.start.localeCompare(b.start) || a.name.localeCompare(b.name))
  }
  return map
}

/** Minutes past midnight on the display zone's wall clock (0 before the day, 1440 after it). On a DST
 *  change day the day is 23 or 25 hours long, so elapsed time since midnight would put events an hour off. */
export function wallMin(t: number, dayStart: number, dayEnd: number, tz?: Zone): number {
  if (t <= dayStart) return 0
  if (t >= dayEnd) return 1440
  return zoneMinutes(t, tz)
}

/** The instant `min` wall-clock minutes into `day` in the display zone (the inverse of wallMin; 1440 = next midnight). */
export const atWallMin = (day: Date, min: number, tz?: Zone) => atZoneMin(day, min, tz)

export interface Placed { event: CalEvent; startMin: number; endMin: number; col: number; cols: number }

/**
 * Timed events of one day placed in columns: overlapping events share the width
 * (greedy column assignment within each cluster of mutually overlapping events).
 * Minutes are clipped to the day; deadlines get a nominal 30-minute block for layout.
 */
export function layoutDay(events: CalEvent[], day: Date, tz?: Zone): Placed[] {
  const dayStart = dayStartIn(day, tz)
  const dayEnd = dayStartIn(addDays(day, 1), tz)
  const items = events
    .filter((e) => !e.all_day)
    .map((e) => {
      const s = new Date(e.start).getTime()
      const en = e.end ? new Date(e.end).getTime() : s
      const startMin = wallMin(s, dayStart, dayEnd, tz)
      const endMin = wallMin(Math.max(en, s), dayStart, dayEnd, tz)
      return { event: e, startMin, endMin: Math.max(endMin, startMin + (e.end ? 20 : 30)), raw: [s, en] as const }
    })
    .filter((x) => x.raw[0] < dayEnd && (x.raw[1] > dayStart || x.raw[0] >= dayStart))
    .sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin)

  const out: Placed[] = []
  let cluster: Placed[] = []
  let colEnds: number[] = []
  let clusterEnd = -1
  const flush = () => {
    for (const p of cluster) p.cols = colEnds.length
    out.push(...cluster)
    cluster = []
    colEnds = []
  }
  for (const it of items) {
    if (it.startMin >= clusterEnd && cluster.length) flush()
    let col = colEnds.findIndex((end) => end <= it.startMin)
    if (col < 0) {
      col = colEnds.length
      colEnds.push(it.endMin)
    } else colEnds[col] = it.endMin
    cluster.push({ event: it.event, startMin: it.startMin, endMin: Math.min(it.endMin, 1440), col, cols: 1 })
    clusterEnd = Math.max(clusterEnd, it.endMin)
  }
  if (cluster.length) flush()
  return out
}

/** Round minutes to the nearest `step`. */
export const snap = (min: number, step = 30) => Math.max(0, Math.min(1440 - step, Math.round(min / step) * step))

/** Signed delta label: "+9.8 h", "−2 h", "±0". */
export function delta(cur: number, prev: number, unit = ''): { text: string; dir: 1 | -1 | 0 } {
  const d = Math.round((cur - prev) * 10) / 10
  if (d === 0) return { text: 'same as before', dir: 0 }
  return { text: `${d > 0 ? '+' : '−'}${Math.abs(d)}${unit}`, dir: d > 0 ? 1 : -1 }
}

export function hours(h: number): string {
  if (h === 0) return '0 h'
  if (h < 1) return `${Math.round(h * 60)} min`
  return `${Math.round(h * 10) / 10} h`
}

// ---------------------------------------------------------------- manual range sync (V1's "Sync events")
/** A month range for syncing: 0-based months, end exclusive (the first of the end month), as in V1. */
export interface MonthRange { sm: number; sy: number; em: number; ey: number }

/** V1's term presets. "This term" (T) starts this month; "Full term" (TF) starts at the term's first month.
 *  Terms: Sep–Dec (ends Jan 1 next year), Jan–Apr (ends May 1), May–Aug (ends Oct 1). */
export function termRange(today: Date, full: boolean): MonthRange {
  const m = today.getMonth()
  const y = today.getFullYear()
  if (m >= 8) return { sm: full ? 8 : m, sy: y, em: 0, ey: y + 1 }
  if (m <= 3) return { sm: full ? 0 : m, sy: y, em: 4, ey: y }
  return { sm: full ? 4 : m, sy: y, em: 9, ey: y }
}

/** POST /calendar/calendars/{id}/sync body: the first day of each month, [start, end). */
export function rangeBody(r: MonthRange): { start: string; end: string } {
  const d = (y: number, m: number) => `${y}-${String(m + 1).padStart(2, '0')}-01`
  return { start: d(r.sy, r.sm), end: d(r.ey, r.em) }
}
