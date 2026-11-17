// Where timed events sit in a day column: wall-clock minutes in the display zone (right on DST change days)
// and side-by-side columns for overlapping events. Pure, so it's unit-tested.
import { addDays } from '../../lib/dates'
import type { CalEvent } from '../../lib/types'
import { atZoneMin, dayStartIn, zoneMinutes, type Zone } from './zone'

export const DAY_MIN = 1440

/** Minutes past midnight on the display zone's wall clock (0 before the day, 1440 after it). On a DST
 *  change day the day is 23 or 25 hours long, so elapsed time since midnight would put events an hour off. */
export function wallMin(t: number, dayStart: number, dayEnd: number, tz?: Zone): number {
  if (t <= dayStart) return 0
  if (t >= dayEnd) return DAY_MIN
  return zoneMinutes(t, tz)
}

/** The instant `min` wall-clock minutes into `day` in the display zone (the inverse of wallMin; 1440 = next midnight). */
export const atWallMin = (day: Date, min: number, tz?: Zone) => atZoneMin(day, min, tz)

/** `m` minutes kept inside a day, [0, 1440]. */
export const clampDay = (m: number) => Math.max(0, Math.min(DAY_MIN, m))

/** A share of the day as a CSS percentage, for top/height in a 24-hour column. */
export const pct = (min: number) => `${(min / DAY_MIN) * 100}%`

export interface Placed {
  event: CalEvent
  startMin: number
  endMin: number
  col: number
  cols: number
}

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
    cluster.push({ event: it.event, startMin: it.startMin, endMin: Math.min(it.endMin, DAY_MIN), col, cols: 1 })
    clusterEnd = Math.max(clusterEnd, it.endMin)
  }
  if (cluster.length) flush()
  return out
}

/** Round minutes to the nearest `step`, keeping a whole step inside the day. */
export const snap = (min: number, step = 30) => Math.max(0, Math.min(DAY_MIN - step, Math.round(min / step) * step))
