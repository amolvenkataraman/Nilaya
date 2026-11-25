// Date helpers in the browser's local time. Weeks start on Monday (same as /calendar/insights) unless
// a caller passes another first day (the calendar's Sunday/Monday setting).
import { displayPrefs, onDisplayChange } from './display'

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
/** The first day of d's week; `weekStart` 0 = Sunday, 1 = Monday. */
export function startOfWeek(d: Date, weekStart = 1): Date {
  const x = startOfDay(d)
  return addDays(x, -((x.getDay() - weekStart + 7) % 7))
}

/** The 6x7 grid of days shown for the month containing `d`. */
export function monthGrid(d: Date, weekStart = 1): Date[][] {
  const first = new Date(d.getFullYear(), d.getMonth(), 1)
  let cur = startOfWeek(first, weekStart)
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
// Every date and time shown goes through dateFormatter, which follows the account's display preferences
// (lib/display): date_format picks the locale (auto = the browser's, mdy = en-US, dmy = en-GB, ymd = year first, see
// ymdFormatter), so month and weekday names are English unless it's auto; time_format picks the hour cycle (auto =
// the browser's, kept when date_format swaps the locale, so "Dates" never changes the clock).
export interface DateFmt {
  format(d: Date | number): string
}
const DATE_LOCALE = { auto: undefined, mdy: 'en-US', dmy: 'en-GB', ymd: 'en-US' } as const
let browserCycle: Intl.DateTimeFormatOptions['hourCycle']
const browserHourCycle = () => (browserCycle ??= new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).resolvedOptions().hourCycle)
/** Whether times read "3 PM" rather than "15:00". */
const twelveHour = () => {
  const { time_format } = displayPrefs()
  if (time_format !== 'auto') return time_format === '12h'
  const c = browserHourCycle()
  return c === 'h11' || c === 'h12'
}

function buildFormatter(opts: Intl.DateTimeFormatOptions): DateFmt {
  const { time_format, date_format } = displayPrefs()
  const locale = DATE_LOCALE[date_format]
  const timed = opts.hour !== undefined || opts.timeStyle !== undefined
  // Left out for auto with the browser's locale: Intl's own default is exactly the browser's clock.
  const hourCycle = timed && (time_format !== 'auto' || locale) ? (twelveHour() ? 'h12' : 'h23') : undefined
  const o: Intl.DateTimeFormatOptions = hourCycle ? { ...opts, hourCycle } : opts
  return date_format === 'ymd' && opts.month && (opts.year || opts.day) ? ymdFormatter(o) : new Intl.DateTimeFormat(locale, o)
}

/** Year first, as no English locale writes it: "2026-11-24" for numeric dates, "2026 Nov 24" with month names (no
 *  year: "Nov 24"), a weekday ahead ("Tue, 2026 Nov 24") and a time after (", 3:05 PM"), punctuated as en-US does. */
function ymdFormatter({ weekday, year, month, day, ...rest }: Intl.DateTimeFormatOptions): DateFmt {
  const numeric = month === 'numeric' || month === '2-digit'
  const date = new Intl.DateTimeFormat('en-US', {
    timeZone: rest.timeZone,
    weekday,
    year,
    month: numeric ? '2-digit' : month,
    day: day && (numeric ? '2-digit' : day),
  })
  const clock = rest.hour !== undefined ? new Intl.DateTimeFormat('en-US', rest) : null
  return {
    format(d) {
      const p: Partial<Record<Intl.DateTimeFormatPartTypes, string>> = {}
      for (const { type, value } of date.formatToParts(d)) p[type] = value
      const ymd = [p.year, p.month, p.day].filter(Boolean).join(numeric ? '-' : ' ')
      const text = p.weekday ? `${p.weekday}, ${ymd}` : ymd
      return clock ? `${text}, ${clock.format(d)}` : text
    },
  }
}

// Building an Intl.DateTimeFormat costs ~70 µs; formatting with a cached one ~1.5 µs. A preference change empties
// the cache, so hold on to the result only for one render, never in a module constant.
const fmtCache = new Map<string, DateFmt>()
onDisplayChange(() => fmtCache.clear())
/** A shared formatter for these options, in the account's date and time formats. */
export function dateFormatter(opts: Intl.DateTimeFormatOptions): DateFmt {
  const key = JSON.stringify(opts)
  let f = fmtCache.get(key)
  if (!f) {
    f = buildFormatter(opts)
    fmtCache.set(key, f)
  }
  return f
}
export function fmtDate(d: Date | number, opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }): string {
  return dateFormatter(opts).format(d)
}
/** "3:05 PM" or "15:05", in `timeZone` (default: the browser's). */
export function fmtTime(d: Date | number, timeZone?: string): string {
  return dateFormatter({ hour: 'numeric', minute: '2-digit', timeZone }).format(d)
}
/** An hour on its own (time-grid gutters, charts): "3 PM", or "15:00" on a 24-hour clock, where a bare "15" reads
 *  as a count. */
export function fmtHour(d: Date | number, timeZone?: string): string {
  return dateFormatter(twelveHour() ? { hour: 'numeric', timeZone } : { hour: '2-digit', minute: '2-digit', timeZone }).format(d)
}
/** Date#toLocaleString() / toLocaleDateString()-style text in the account's formats, from cached formatters. */
const FULL: Intl.DateTimeFormatOptions = {
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  second: '2-digit',
}
const NUMERIC_DAY: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'numeric', day: 'numeric' }
export const fmtStamp = (d: Date | string) => dateFormatter(FULL).format(typeof d === 'string' ? new Date(d) : d)
export const fmtNumericDay = (d: Date | string) => dateFormatter(NUMERIC_DAY).format(typeof d === 'string' ? new Date(d) : d)
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
  return fmtDate(
    d,
    d.getFullYear() === now.getFullYear() ? { month: 'short', day: 'numeric' } : { year: 'numeric', month: 'short', day: 'numeric' },
  )
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
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}
export function toDateInput(iso: string | null | undefined): string {
  return iso ? dayKey(new Date(iso)) : ''
}

// ---------- grouping
export type DueGroupKey = 'overdue' | 'today' | 'tomorrow' | 'later' | 'nodate' | `day:${string}`
export interface Group<T> {
  key: DueGroupKey
  label: string
  items: T[]
}

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
    if (!g) {
      g = { key, label: labels[key], items: [] }
      groups.set(key, g)
    }
    g.items.push(item)
  }
  return order.filter((k) => groups.has(k)).map((k) => groups.get(k)!)
}

/** Where an item sits on the local calendar: an all-day item at local midnight of its own date
 *  (start_date, a local ISO string without a zone), never its instant converted to this browser's zone. */
export function placedStart(i: { kind?: string; all_day?: boolean; start: string | null; start_date?: string | null }): string | null {
  return (i.kind === 'all_day' || i.all_day) && i.start_date ? `${i.start_date}T00:00:00` : i.start
}

/** Whether an all-day item ([start_date, end_date), end exclusive) covers this local day. */
export function coversDay(i: { start_date?: string | null; end_date?: string | null }, d: Date): boolean {
  if (!i.start_date) return false
  const k = dayKey(d)
  return i.start_date <= k && (i.end_date ? k < i.end_date : k === i.start_date)
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
