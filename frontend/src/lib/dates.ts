// Date helpers in the browser's local time. Weeks start on Monday (same as /calendar/insights).

export const DAY_MS = 86_400_000

export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}
export function addDays(d: Date, n: number): Date {
  const x = new Date(d)
  x.setDate(x.getDate() + n)
  return x
}
export function addMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, 1)
}
export function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}
/** Whole local days from a to b (b later = positive), ignoring the time of day. */
export function dayDiff(a: Date, b: Date): number {
  return Math.round((startOfDay(b).getTime() - startOfDay(a).getTime()) / DAY_MS)
}
const pad = (n: number) => String(n).padStart(2, '0')
/** Local YYYY-MM-DD. */
export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
export function parseDayKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, (m || 1) - 1, d || 1)
}
export function startOfWeek(d: Date): Date {
  const x = startOfDay(d)
  return addDays(x, -((x.getDay() + 6) % 7))
}

/** The 6x7 grid of days shown for the month containing `d`. */
export function monthGrid(d: Date): Date[][] {
  const first = new Date(d.getFullYear(), d.getMonth(), 1)
  let cur = startOfWeek(first)
  const weeks: Date[][] = []
  for (let w = 0; w < 6; w++) {
    const row: Date[] = []
    for (let i = 0; i < 7; i++) {
      row.push(cur)
      cur = addDays(cur, 1)
    }
    weeks.push(row)
  }
  return weeks
}

// ---------- formatting
const timeFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' })
export function fmtTime(d: Date): string {
  return timeFmt.format(d)
}
export function fmtDate(d: Date, opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }): string {
  return new Intl.DateTimeFormat(undefined, opts).format(d)
}
export function fmtLongDate(d: Date): string {
  return fmtDate(d, { weekday: 'long', month: 'long', day: 'numeric' })
}
export function weekdayName(d: Date, style: 'long' | 'short' = 'long'): string {
  return fmtDate(d, { weekday: style })
}

/** Due dates parsed from "tomorrow" etc. land on 23:59 local: show those as date-only. */
export function isEndOfDay(d: Date): boolean {
  return d.getHours() === 23 && d.getMinutes() === 59
}

/** Short, human due label: "Today", "Today 5:00 PM", "Tomorrow", "Fri", "Nov 12", "Yesterday". */
export function dueLabel(iso: string, now: Date = new Date()): string {
  const d = new Date(iso)
  const diff = dayDiff(now, d)
  const time = isEndOfDay(d) ? '' : ' ' + fmtTime(d)
  if (diff === 0) return 'Today' + time
  if (diff === 1) return 'Tomorrow' + time
  if (diff === -1) return 'Yesterday' + time
  if (diff > 1 && diff < 7) return weekdayName(d, 'short') + time
  const sameYear = d.getFullYear() === now.getFullYear()
  return fmtDate(d, sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' }) + time
}

/** "in 25 min", "in 2 h", "5 min ago", "now". */
export function relTime(target: Date, now: Date = new Date()): string {
  const mins = Math.round((target.getTime() - now.getTime()) / 60000)
  const abs = Math.abs(mins)
  if (abs < 1) return 'now'
  let s: string
  if (abs < 60) s = `${abs} min`
  else if (abs < 60 * 24) {
    const h = Math.floor(abs / 60)
    const m = abs % 60
    s = m && h < 4 ? `${h} h ${m} min` : `${h} h`
  } else s = `${Math.round(abs / 1440)} d`
  return mins > 0 ? `in ${s}` : `${s} ago`
}

/** "2:15 PM", "Yesterday", "Mon", "Nov 3" for list timestamps. */
export function shortStamp(iso: string, now: Date = new Date()): string {
  const d = new Date(iso)
  const diff = dayDiff(d, now)
  if (diff === 0) return fmtTime(d)
  if (diff === 1) return 'Yesterday'
  if (diff < 7 && diff > 0) return weekdayName(d, 'short')
  return fmtDate(d, d.getFullYear() === now.getFullYear() ? { month: 'short', day: 'numeric' } : { year: 'numeric', month: 'short', day: 'numeric' })
}

export function greeting(now: Date = new Date()): string {
  const h = now.getHours()
  if (h < 5) return 'Good night'
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  return 'Good evening'
}

// ---------- <input type="datetime-local"> / "date" round-trips
export function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  return `${dayKey(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
export function fromLocalInput(value: string): string | null {
  if (!value) return null
  const d = new Date(value) // "YYYY-MM-DDTHH:mm" is parsed as local time
  return isNaN(d.getTime()) ? null : d.toISOString()
}
export function toDateInput(iso: string | null | undefined): string {
  return iso ? dayKey(new Date(iso)) : ''
}

// ---------- grouping
export type DueGroupKey = 'overdue' | 'today' | 'tomorrow' | 'later' | 'nodate' | `day:${string}`
export interface Group<T> { key: DueGroupKey; label: string; items: T[] }

/**
 * Group items by due date: Overdue, Today, Tomorrow, each of the next 5 days by weekday,
 * Later, No date. Overdue means due before now (a 23:59 "today" task is still Today).
 * Groups keep the input order of their items and empty groups are dropped.
 */
export function groupByDue<T>(items: T[], due: (t: T) => string | null, now: Date = new Date()): Group<T>[] {
  const groups = new Map<DueGroupKey, Group<T>>()
  const order: DueGroupKey[] = ['overdue', 'today', 'tomorrow']
  const labels: Record<string, string> = { overdue: 'Overdue', today: 'Today', tomorrow: 'Tomorrow', later: 'Later', nodate: 'No date' }
  for (let i = 2; i < 7; i++) {
    const d = addDays(startOfDay(now), i)
    const key = `day:${dayKey(d)}` as DueGroupKey
    order.push(key)
    labels[key] = weekdayName(d)
  }
  order.push('later', 'nodate')
  for (const item of items) {
    const iso = due(item)
    let key: DueGroupKey
    if (!iso) key = 'nodate'
    else {
      const d = new Date(iso)
      const diff = dayDiff(now, d)
      if (d.getTime() < now.getTime() && diff <= 0) key = diff < 0 || !isEndOfDay(d) ? 'overdue' : 'today'
      else if (diff === 0) key = 'today'
      else if (diff === 1) key = 'tomorrow'
      else if (diff < 7) key = `day:${dayKey(d)}` as DueGroupKey
      else key = 'later'
    }
    let g = groups.get(key)
    if (!g) groups.set(key, (g = { key, label: labels[key], items: [] }))
    g.items.push(item)
  }
  return order.filter((k) => groups.has(k)).map((k) => groups.get(k)!)
}

/** Group by local calendar day (newest first input stays newest first). */
export function groupByDay<T>(items: T[], date: (t: T) => string | null): { key: string; date: Date | null; items: T[] }[] {
  const out: { key: string; date: Date | null; items: T[] }[] = []
  let cur: { key: string; date: Date | null; items: T[] } | null = null
  for (const item of items) {
    const iso = date(item)
    const d = iso ? new Date(iso) : null
    const key = d ? dayKey(d) : 'undated'
    if (!cur || cur.key !== key) {
      cur = { key, date: d ? startOfDay(d) : null, items: [] }
      out.push(cur)
    }
    cur.items.push(item)
  }
  return out
}
