// The calendar's display time zone and first day of the week.
//
// Days in the calendar are plain local Date objects at local midnight: they carry a calendar date
// (year, month, day), never an instant. Instants (event starts, "now") become wall-clock parts in the
// display zone here, and wall-clock parts in that zone become instants here; nothing else in the
// calendar converts between the two. `tz` undefined means the browser's own zone (the default, and
// the fast path through Date's local methods).
import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { dateFormatter } from '../../lib/dates'
import { userKey } from '../../lib/owner'

export type Zone = string | undefined
export type WeekStart = 0 | 1

/** The browser's zone: what the calendar shows unless a temporary zone is picked. */
export const HOME_ZONE: string = (() => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
})()

export interface CalPrefs { tz: Zone; weekStart: WeekStart }
export const CalPrefsContext = createContext<CalPrefs>({ tz: undefined, weekStart: 1 })
export const useCalPrefs = () => useContext(CalPrefsContext)

// ---------------------------------------------------------------- conversions
const partsCache = new Map<string, Intl.DateTimeFormat>()
function partsFmt(tz: string): Intl.DateTimeFormat {
  let f = partsCache.get(tz)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' })
    partsCache.set(tz, f)
  }
  return f
}

export interface Wall { y: number; mo: number; d: number; h: number; mi: number; s: number }

/** Wall-clock parts of instant `t` in `tz` (month 0-based). */
export function wallParts(t: number, tz: Zone): Wall {
  if (!tz) {
    const x = new Date(t)
    return { y: x.getFullYear(), mo: x.getMonth(), d: x.getDate(), h: x.getHours(), mi: x.getMinutes(), s: x.getSeconds() }
  }
  const w: Wall = { y: 0, mo: 0, d: 0, h: 0, mi: 0, s: 0 }
  for (const p of partsFmt(tz).formatToParts(t)) {
    if (p.type === 'year') w.y = +p.value
    else if (p.type === 'month') w.mo = +p.value - 1
    else if (p.type === 'day') w.d = +p.value
    else if (p.type === 'hour') w.h = +p.value % 24
    else if (p.type === 'minute') w.mi = +p.value
    else if (p.type === 'second') w.s = +p.value
  }
  return w
}

/** `tz`'s offset from UTC at instant `t`, in ms (Tokyo +32400000). */
export function offsetMs(t: number, tz: Zone): number {
  if (!tz) return -new Date(t).getTimezoneOffset() * 60_000
  const w = wallParts(t, tz)
  return Date.UTC(w.y, w.mo, w.d, w.h, w.mi, w.s) - Math.floor(t / 1000) * 1000
}

/** The instant at wall clock (y, mo, d) + `min` minutes in `tz`. Overflowing days/minutes roll over.
 *  A time skipped by a DST change moves forward by the gap and a repeated one takes its first
 *  occurrence, as `new Date(y, mo, d, 0, min)` does for the browser's zone. */
export function zonedTime(y: number, mo: number, d: number, min: number, tz: Zone): number {
  if (!tz) return new Date(y, mo, d, 0, min).getTime()
  const guess = Date.UTC(y, mo, d, 0, min)
  // Offsets a day either side: DST changes are months apart, so these are the two candidates.
  const before = offsetMs(guess - 86_400_000, tz)
  const after = offsetMs(guess + 86_400_000, tz)
  const t1 = guess - before
  const t2 = guess - after
  const ok1 = offsetMs(t1, tz) === before
  const ok2 = offsetMs(t2, tz) === after
  if (ok1 && ok2) return Math.min(t1, t2)
  if (ok1) return t1
  if (ok2) return t2
  return t1 // in the gap: the old offset puts it after the change
}

/** The calendar date of instant `t` in `tz`, as a local-midnight Date. */
export function zoneDay(t: number, tz: Zone): Date {
  const w = wallParts(t, tz)
  return new Date(w.y, w.mo, w.d)
}

const pad = (n: number) => String(n).padStart(2, '0')
/** YYYY-MM-DD of instant `t` in `tz`. */
export function zoneDayKey(t: number, tz: Zone): string {
  const w = wallParts(t, tz)
  return `${w.y}-${pad(w.mo + 1)}-${pad(w.d)}`
}

/** Wall-clock minutes past midnight of instant `t` in `tz`. */
export function zoneMinutes(t: number, tz: Zone): number {
  const w = wallParts(t, tz)
  return w.h * 60 + w.mi + w.s / 60
}

/** Midnight in `tz` that starts calendar day `day` (a local-midnight Date), as an instant. */
export const dayStartIn = (day: Date, tz: Zone) => zonedTime(day.getFullYear(), day.getMonth(), day.getDate(), 0, tz)

/** The instant `min` wall-clock minutes into `day` in `tz` (1440 = the next midnight). */
export const atZoneMin = (day: Date, min: number, tz: Zone) => new Date(zonedTime(day.getFullYear(), day.getMonth(), day.getDate(), min, tz))

/** Move an instant by whole days and minutes on `tz`'s wall clock (a drag in the week grid). */
export function shiftWall(t: number, days: number, mins: number, tz: Zone): Date {
  const w = wallParts(t, tz)
  return new Date(zonedTime(w.y, w.mo, w.d + days, w.h * 60 + w.mi + mins, tz) + w.s * 1000)
}

// ---------------------------------------------------------------- formatting
/** "3:30 PM" in `tz`. */
export const fmtTimeIn = (d: Date | number, tz: Zone) => dateFormatter({ hour: 'numeric', minute: '2-digit', timeZone: tz }).format(d)
/** Date#toLocaleDateString-like text in `tz` (cached formatters). */
export const fmtDateIn = (d: Date | number, opts: Intl.DateTimeFormatOptions, tz: Zone) => dateFormatter({ ...opts, timeZone: tz }).format(d)
/** Short chip time: "3pm", "3:30pm". */
export const chipTime = (d: Date | number, tz: Zone) => fmtTimeIn(d, tz).replace(/:00(?=\s|$)/, '').replace(/\s/g, '').toLowerCase()

/** "GMT-5", "GMT+5:30", "GMT" for an offset in ms. */
export function gmtText(off: number): string {
  if (!off) return 'GMT'
  const m = Math.round(Math.abs(off) / 60_000)
  return `GMT${off < 0 ? '-' : '+'}${Math.floor(m / 60)}${m % 60 ? ':' + pad(m % 60) : ''}`
}
/** `tz`'s GMT offset label at instant `t`. */
export const gmtLabel = (t: number, tz: Zone) => gmtText(offsetMs(t, tz))

/** "Tokyo", "Buenos Aires", "UTC" from an IANA name. */
export const zoneCity = (tz: string) => (tz.split('/').pop() || tz).replace(/_/g, ' ')

// ---------------------------------------------------------------- <input type="datetime-local">
/** "YYYY-MM-DDTHH:mm" on `tz`'s wall clock. */
export function toZoneInput(iso: string | null | undefined, tz: Zone): string {
  if (!iso) return ''
  const w = wallParts(new Date(iso).getTime(), tz)
  return `${w.y}-${pad(w.mo + 1)}-${pad(w.d)}T${pad(w.h)}:${pad(w.mi)}`
}
/** A datetime-local value meant as wall-clock time in `tz`, as a UTC ISO string. */
export function fromZoneInput(value: string, tz: Zone): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value)
  if (!m) return null
  const t = zonedTime(+m[1], +m[2] - 1, +m[3], +m[4] * 60 + +m[5], tz)
  return isNaN(t) ? null : new Date(t).toISOString()
}

// ---------------------------------------------------------------- zone list
const FALLBACK_ZONES = [
  'Pacific/Honolulu', 'America/Anchorage', 'America/Los_Angeles', 'America/Vancouver', 'America/Denver', 'America/Phoenix', 'America/Chicago',
  'America/Mexico_City', 'America/Toronto', 'America/New_York', 'America/Halifax', 'America/St_Johns', 'America/Bogota', 'America/Lima',
  'America/Santiago', 'America/Sao_Paulo', 'America/Argentina/Buenos_Aires', 'Atlantic/Azores', 'Atlantic/Reykjavik', 'Europe/London',
  'Europe/Dublin', 'Europe/Lisbon', 'Europe/Paris', 'Europe/Berlin', 'Europe/Madrid', 'Europe/Rome', 'Europe/Amsterdam', 'Europe/Stockholm',
  'Europe/Warsaw', 'Europe/Athens', 'Europe/Helsinki', 'Europe/Istanbul', 'Europe/Moscow', 'Africa/Lagos', 'Africa/Cairo', 'Africa/Johannesburg',
  'Africa/Nairobi', 'Asia/Jerusalem', 'Asia/Riyadh', 'Asia/Tehran', 'Asia/Dubai', 'Asia/Karachi', 'Asia/Kolkata', 'Asia/Kathmandu', 'Asia/Dhaka',
  'Asia/Bangkok', 'Asia/Jakarta', 'Asia/Singapore', 'Asia/Shanghai', 'Asia/Hong_Kong', 'Asia/Taipei', 'Asia/Manila', 'Asia/Seoul', 'Asia/Tokyo',
  'Australia/Perth', 'Australia/Adelaide', 'Australia/Brisbane', 'Australia/Sydney', 'Pacific/Auckland', 'Pacific/Fiji', 'UTC',
]

/** Every IANA zone this browser knows (a short list where Intl can't enumerate them). */
export function allZones(): string[] {
  let zones: string[] = []
  try {
    zones = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone') ?? []
  } catch { /* old browser */ }
  if (!zones.length) zones = FALLBACK_ZONES
  const set = new Set(zones)
  for (const z of [HOME_ZONE, 'UTC']) set.add(z)
  return [...set]
}

/** Whether this browser can display `tz`. */
export function validZone(tz: string | null | undefined): tz is string {
  if (!tz) return false
  try {
    partsFmt(tz)
    return true
  } catch {
    return false
  }
}

// ---------------------------------------------------------------- persisted choices
const TZ_KEY = 'app.calendar.tz' // sessionStorage: this window only
const WEEK_KEY = 'app.calendar.weekStart' // localStorage, per user

/** The temporary display zone (undefined = home), kept for this browser window only. */
export function useDisplayZone(): [Zone, (tz: Zone) => void] {
  const [tz, setTz] = useState<Zone>(() => {
    try {
      const v = sessionStorage.getItem(TZ_KEY)
      return validZone(v) && v !== HOME_ZONE ? v : undefined
    } catch {
      return undefined
    }
  })
  const set = (next: Zone) => {
    const v = next && next !== HOME_ZONE && validZone(next) ? next : undefined
    setTz(v)
    try {
      if (v) sessionStorage.setItem(TZ_KEY, v)
      else sessionStorage.removeItem(TZ_KEY)
    } catch { /* this page only */ }
  }
  return [tz, set]
}

/** First day of the week for this user (Monday unless they chose Sunday), saved in localStorage. */
export function useWeekStart(userId: string | undefined): [WeekStart, (v: WeekStart) => void] {
  const key = useMemo(() => userKey(WEEK_KEY, userId), [userId])
  const read = (): WeekStart => {
    try {
      return key && localStorage.getItem(key) === '0' ? 0 : 1
    } catch {
      return 1
    }
  }
  const [v, setV] = useState<WeekStart>(read)
  useEffect(() => setV(read()), [key]) // eslint-disable-line react-hooks/exhaustive-deps
  const set = (next: WeekStart) => {
    setV(next)
    try {
      if (key) localStorage.setItem(key, String(next))
    } catch { /* this page only */ }
  }
  return [v, set]
}
