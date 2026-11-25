// Working hours on the time grids (Settings › Preferences): which minutes of a day to shade as outside them, and
// where the week/day view opens. Spans are wall-clock minutes in a column, [0, 1440]. Pure, so it's unit-tested.
import { clockMinutes, type Preferences } from '../../lib/preferences'
import { DAY_MIN } from './layout'

export type MinSpan = readonly [from: number, to: number]
type WorkPrefs = Pick<Preferences, 'work_days' | 'work_start' | 'work_end'>

/** The working span of `day` (a calendar date, so getDay() is its weekday; 0 = Sunday as stored), or none on a day off. */
export function workSpans(day: Date, p: WorkPrefs): MinSpan[] {
  if (!p.work_days.includes(day.getDay() as WorkPrefs['work_days'][number])) return []
  return [[clockMinutes(p.work_start), clockMinutes(p.work_end)]]
}

/** The rest of the day: the gaps between `open` spans (any order, may overlap or spill past the day). */
export function offSpans(open: readonly MinSpan[]): MinSpan[] {
  const off: MinSpan[] = []
  let at = 0
  for (const [a, z] of [...open].sort((x, y) => x[0] - y[0])) {
    if (a > at) off.push([at, Math.min(a, DAY_MIN)])
    at = Math.max(at, z)
    if (at >= DAY_MIN) return off
  }
  if (at < DAY_MIN) off.push([at, DAY_MIN])
  return off
}

/** Where the week/day view opens, in minutes: a little before now while the clock is within working hours (what's
 *  next matters), otherwise just before they start (the working day, not the night). `nowMin` is null when today
 *  isn't in view. */
export function openingMinute(nowMin: number | null, p: WorkPrefs): number {
  const start = clockMinutes(p.work_start)
  if (nowMin != null && nowMin >= start && nowMin < clockMinutes(p.work_end)) return Math.max(0, Math.floor(nowMin / 60) * 60 - 90)
  return Math.max(0, start - 30)
}
