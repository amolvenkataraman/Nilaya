// Pure helpers for the Calendar page: view ranges, per-day event placement and overlap layout.
import { addDays, dayKey, parseDayKey, startOfDay, startOfWeek, monthGrid, addMonths, fmtDate } from '../../lib/dates'
import type { CalEvent } from '../../lib/types'

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

/** Visible [start, end) for a view. `days` is the week view's width (7 on desktop, 3 or 1 on phones). */
export function viewRange(view: CalView, date: Date, days = 7): { start: Date; end: Date; days: Date[] } {
  if (view === 'month') {
    const grid = monthGrid(date)
    const start = grid[0][0]
    return { start, end: addDays(grid[5][6], 1), days: grid.flat() }
  }
  if (view === 'day') days = 1
  const start = days === 7 ? startOfWeek(date) : startOfDay(date)
  const list = Array.from({ length: days }, (_, i) => addDays(start, i))
  return { start, end: addDays(start, days), days: list }
}

/** Move the anchor date one step (month / week-or-days) forward (+1) or back (-1). */
export function stepDate(view: CalView, date: Date, dir: number, days = 7): Date {
  if (view === 'month') {
    const d = addMonths(date, dir)
    return d
  }
  return addDays(date, dir * (view === 'day' ? 1 : days))
}

export function rangeTitle(view: CalView, date: Date, days = 7): string {
  if (view === 'month' || view === 'agenda') return fmtDate(view === 'agenda' ? new Date() : date, { month: 'long', year: 'numeric' })
  const { start, end } = viewRange(view, date, days)
  const last = addDays(end, -1)
  if (view === 'day' || days === 1) return fmtDate(start, { weekday: 'short', month: 'long', day: 'numeric', year: 'numeric' })
  if (start.getMonth() === last.getMonth()) return fmtDate(start, { month: 'long', year: 'numeric' })
  if (start.getFullYear() === last.getFullYear())
    return `${fmtDate(start, { month: 'short' })} – ${fmtDate(last, { month: 'short', year: 'numeric' })}`
  return `${fmtDate(start, { month: 'short', year: 'numeric' })} – ${fmtDate(last, { month: 'short', year: 'numeric' })}`
}

/** All-day events and multi-day timed events cover every day they touch; [start, end) with end exclusive. */
export function eventDays(e: CalEvent): { first: Date; last: Date } {
  const s = new Date(e.start)
  const first = startOfDay(s)
  if (!e.end) return { first, last: first }
  const end = new Date(e.end)
  // Exclusive end: an event ending exactly at midnight doesn't touch the next day.
  const lastMoment = new Date(Math.max(s.getTime(), end.getTime() - 1))
  return { first, last: startOfDay(lastMoment) }
}

export const isAllDayLike = (e: CalEvent) => e.all_day

/** Events per local day key, sorted: all-day first, then by start time. */
export function eventsByDay(events: CalEvent[]): Map<string, CalEvent[]> {
  const map = new Map<string, CalEvent[]>()
  for (const e of events) {
    const { first, last } = eventDays(e)
    for (let d = first, n = 0; d <= last && n < 62; d = addDays(d, 1), n++) {
      const k = dayKey(d)
      let list = map.get(k)
      if (!list) map.set(k, (list = []))
      list.push(e)
    }
  }
  for (const list of map.values()) {
    list.sort((a, b) => Number(b.all_day) - Number(a.all_day) || a.start.localeCompare(b.start) || a.name.localeCompare(b.name))
  }
  return map
}

export interface Placed { event: CalEvent; startMin: number; endMin: number; col: number; cols: number }

/**
 * Timed events of one day placed in columns: overlapping events share the width
 * (greedy column assignment within each cluster of mutually overlapping events).
 * Minutes are clipped to the day; deadlines get a nominal 30-minute block for layout.
 */
export function layoutDay(events: CalEvent[], day: Date): Placed[] {
  const dayStart = startOfDay(day).getTime()
  const dayEnd = addDays(startOfDay(day), 1).getTime()
  const items = events
    .filter((e) => !e.all_day)
    .map((e) => {
      const s = new Date(e.start).getTime()
      const en = e.end ? new Date(e.end).getTime() : s
      const startMin = Math.max(0, (s - dayStart) / 60000)
      const endMin = Math.min(1440, (Math.max(en, s) - dayStart) / 60000)
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
