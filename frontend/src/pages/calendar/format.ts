// How calendar things are put into words and glyphs: when an event happens (in the display zone and on the home
// clock), reminder offsets, an event's icon and its category's name. Every view says them the same way.
import { fmtDate, isSameDay } from '../../lib/dates'
import type { CalEvent, CategoryRef } from '../../lib/types'
import { eventDays } from './range'
import { HOME_ZONE, fmtDateIn, fmtTimeIn, gmtLabel, zoneCity, zoneDayKey, type Zone } from './zone'
import { asIcon, type IconName } from '../../components/Icon'

/** The category every user has and events fall back to; it's never shown as a label. */
export const UNCATEGORIZED = 'Uncategorized'
export const isUncategorized = (c?: Pick<CategoryRef, 'name'> | null) => !c || c.name === UNCATEGORIZED

/** The category name worth showing on an event ('' for none or Uncategorized). */
export const categoryName = (e: Pick<CalEvent, 'category'>) => (isUncategorized(e.category) ? '' : e.category!.name)

/** An event's own icon, else its category's (undefined for neither). */
/** The event's own icon, else its category's (names come from the server, so unknown ones fall back to info). */
export const eventIcon = (e: Pick<CalEvent, 'icon' | 'category'>): IconName | undefined => {
  const name = e.icon || e.category?.icon
  return name ? asIcon(name) : undefined
}

/** A reminder offset in minutes: "At the start", "10 min before", "2 days before". */
export function minutesText(m: number): string {
  if (m === 0) return 'At the start'
  if (m % 10080 === 0) return `${m / 10080} week${m === 10080 ? '' : 's'} before`
  if (m % 1440 === 0) return `${m / 1440} day${m === 1440 ? '' : 's'} before`
  if (m % 60 === 0) return `${m / 60} hour${m === 60 ? '' : 's'} before`
  return `${m} min before`
}

/** When an event happens, in the display zone `tz` (all-day events by their own dates). */
export function whenLine(e: CalEvent, tz?: Zone): string {
  const s = new Date(e.start)
  const time = (d: Date) => fmtTimeIn(d, tz)
  const day = fmtDateIn(s, { weekday: 'long', month: 'long', day: 'numeric' }, tz)
  if (e.kind === 'deadline') return `Due ${day} at ${time(s)}`
  if (e.all_day) {
    // By its calendar dates, not the instants (another zone's midnight is another day here).
    const { first, last } = eventDays(e)
    const fday = fmtDate(first, { weekday: 'long', month: 'long', day: 'numeric' })
    return isSameDay(first, last)
      ? fday
      : `${fmtDate(first, { month: 'short', day: 'numeric' })} – ${fmtDate(last, { month: 'short', day: 'numeric' })}`
  }
  const en = e.end ? new Date(e.end) : null
  if (en && zoneDayKey(s.getTime(), tz) !== zoneDayKey(en.getTime(), tz))
    return `${fmtDateIn(s, { month: 'short', day: 'numeric' }, tz)}, ${time(s)} – ${fmtDateIn(en, { month: 'short', day: 'numeric' }, tz)}, ${time(en)}`
  return `${day} · ${time(s)}${en ? ` – ${time(en)}` : ''}`
}

/** The same times on the home clock, shown under the main line while another zone is displayed. */
export function homeWhen(e: CalEvent): string {
  const s = new Date(e.start)
  const en = e.end && e.kind !== 'deadline' ? new Date(e.end) : null
  const day = (d: Date) => fmtDateIn(d, { weekday: 'short', month: 'short', day: 'numeric' }, undefined)
  const span = en
    ? zoneDayKey(s.getTime(), undefined) === zoneDayKey(en.getTime(), undefined)
      ? `${fmtTimeIn(s, undefined)} – ${fmtTimeIn(en, undefined)}`
      : `${fmtTimeIn(s, undefined)} – ${day(en)}, ${fmtTimeIn(en, undefined)}`
    : fmtTimeIn(s, undefined)
  return `${zoneCity(HOME_ZONE)} (${gmtLabel(s.getTime(), HOME_ZONE)}): ${day(s)}, ${span}`
}
