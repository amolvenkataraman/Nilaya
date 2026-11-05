import { describe, expect, it } from 'vitest'
import { atWallMin, eventsByDay, fetchRange, layoutDay, parseCalState, rangeBody, termRange, viewRange } from './util'
import { fromZoneInput, toZoneInput, zonedTime } from './zone'
import type { CalEvent } from '../../lib/types'

const ev = (id: string, s: Date, e: Date | null, all_day = false): CalEvent => ({
  id, calendar_id: 1, name: id, start: s.toISOString(), end: e ? e.toISOString() : null, all_day,
  kind: all_day ? 'all_day' : e ? 'event' : 'deadline', category: null, location: null, description: null, completed: false, priority: 10,
})
const at = (d: number, h: number, m = 0) => new Date(2026, 10, d, h, m)

describe('calendar layout', () => {
  it('shares width between overlapping events and resets per cluster', () => {
    const day = new Date(2026, 10, 4)
    const placed = layoutDay([ev('a', at(4, 9), at(4, 10)), ev('b', at(4, 9, 30), at(4, 11)), ev('c', at(4, 10), at(4, 10, 30)), ev('d', at(4, 13), at(4, 14))], day)
    const by = Object.fromEntries(placed.map((p) => [p.event.id, p]))
    expect([by.a.col, by.b.col, by.c.col]).toEqual([0, 1, 0])
    expect(by.a.cols).toBe(2)
    expect(by.d).toMatchObject({ col: 0, cols: 1, startMin: 780, endMin: 840 })
  })

  it('spreads all-day events over their days with an exclusive end', () => {
    const map = eventsByDay([ev('trip', new Date(2026, 9, 15), new Date(2026, 9, 18), true), ev('late', at(4, 23), at(5, 0))])
    expect(['2026-10-15', '2026-10-16', '2026-10-17'].every((k) => map.get(k)?.[0].id === 'trip')).toBe(true)
    expect(map.has('2026-10-18')).toBe(false)
    expect(map.has('2026-11-05')).toBe(false)
  })

  it('files all-day events by their dates and places timed ones by wall clock (any zone, DST days)', () => {
    const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env // Node reads TZ live
    const tz = env.TZ
    try {
      env.TZ = 'Asia/Tokyo' // the calendar is in Toronto: its midnight is 13:00 here
      const day: CalEvent = { ...ev('day', new Date('2026-10-15T04:00:00Z'), new Date('2026-10-16T04:00:00Z'), true), start_date: '2026-10-15', end_date: '2026-10-16' }
      expect([...eventsByDay([day]).keys()]).toEqual(['2026-10-15'])
      env.TZ = 'America/Toronto' // spring forward: 2026-03-08 has 23 hours
      const [p] = layoutDay([ev('m', new Date(2026, 2, 8, 10), new Date(2026, 2, 8, 11))], new Date(2026, 2, 8))
      expect([p.startMin, p.endMin]).toEqual([600, 660])
    } finally {
      env.TZ = tz
    }
  })

  it('shows and creates times in a display zone, DST days included', () => {
    const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env
    const tz = env.TZ
    try {
      env.TZ = 'America/Toronto' // home; the calendar is shown in Tokyo
      // 10:00 in Tokyo is 01:00Z; a click at 10:00 means that, whatever the browser's zone.
      expect(atWallMin(new Date(2026, 10, 5), 600, 'Asia/Tokyo').toISOString()).toBe('2026-11-05T01:00:00.000Z')
      expect(fromZoneInput('2026-11-05T10:00', 'Asia/Tokyo')).toBe('2026-11-05T01:00:00.000Z')
      expect(toZoneInput('2026-11-05T01:00:00Z', 'Asia/Tokyo')).toBe('2026-11-05T10:00')
      // 20:00 Toronto on Nov 4 is 10:00 Nov 5 in Tokyo: filed and placed there; all-day stays on its date.
      const timed = ev('t', new Date('2026-11-05T01:00:00Z'), new Date('2026-11-05T02:00:00Z'))
      const day: CalEvent = { ...ev('d', new Date('2026-11-04T04:00:00Z'), new Date('2026-11-05T05:00:00Z'), true), start_date: '2026-11-04', end_date: '2026-11-05' }
      const map = eventsByDay([timed, day], 'Asia/Tokyo')
      expect(map.get('2026-11-05')?.map((e) => e.id)).toEqual(['t'])
      expect(map.get('2026-11-04')?.map((e) => e.id)).toEqual(['d'])
      const [p] = layoutDay([timed], new Date(2026, 10, 5), 'Asia/Tokyo')
      expect([p.startMin, p.endMin]).toEqual([600, 660])
      // Display Toronto from a Tokyo browser: its spring-forward day (23 h) keeps wall-clock positions,
      // and the skipped 02:30 moves forward to 03:30 EDT, as Date does locally.
      env.TZ = 'Asia/Tokyo'
      const [q] = layoutDay([ev('m', new Date('2026-03-08T14:00:00Z'), new Date('2026-03-08T15:00:00Z'))], new Date(2026, 2, 8), 'America/Toronto')
      expect([q.startMin, q.endMin]).toEqual([600, 660])
      expect(new Date(zonedTime(2026, 2, 8, 150, 'America/Toronto')).toISOString()).toBe('2026-03-08T07:30:00.000Z')
      expect(new Date(zonedTime(2026, 10, 1, 90, 'America/Toronto')).toISOString()).toBe('2026-11-01T05:30:00.000Z') // repeated 01:30: the first
      // The fetch covers the zone's midnights and the browser's own (all-day items at the edges).
      expect(fetchRange({ start: new Date(2026, 10, 2), end: new Date(2026, 10, 9) }, 'America/Toronto')).toEqual({ start: '2026-11-01T15:00:00.000Z', end: '2026-11-09T05:00:00.000Z' })
    } finally {
      env.TZ = tz
    }
  })

  it('parses URL state and computes ranges', () => {
    const s = parseCalState(new URLSearchParams('view=week&date=2026-11-04&insights=month'))
    expect(s).toMatchObject({ view: 'week', insights: 'month', isNew: false })
    expect(parseCalState(new URLSearchParams('view=x&date=junk')).view).toBe('month')
    const r = viewRange('week', s.date)
    expect(r.start.getDay()).toBe(1)
    expect(r.days).toHaveLength(7)
    expect(viewRange('week', s.date, 3).start.getDate()).toBe(4)
    const sun = viewRange('week', s.date, 7, 0) // weeks from Sunday: Nov 1 – 7
    expect([sun.start.getDay(), sun.start.getDate(), sun.end.getDate()]).toEqual([0, 1, 8])
    expect(viewRange('month', s.date, 7, 0).start.getDate()).toBe(1) // Nov 2026 starts on a Sunday
  })
})

describe('range sync presets (V1)', () => {
  it('matches V1 "This term" and "Full term" in each term', () => {
    const nov = new Date(2026, 10, 5), feb = new Date(2026, 1, 9), jun = new Date(2026, 5, 1)
    expect(termRange(nov, false)).toEqual({ sm: 10, sy: 2026, em: 0, ey: 2027 })
    expect(termRange(nov, true)).toEqual({ sm: 8, sy: 2026, em: 0, ey: 2027 })
    expect(termRange(feb, false)).toEqual({ sm: 1, sy: 2026, em: 4, ey: 2026 })
    expect(termRange(feb, true)).toEqual({ sm: 0, sy: 2026, em: 4, ey: 2026 })
    expect(termRange(jun, false)).toEqual({ sm: 5, sy: 2026, em: 9, ey: 2026 })
    expect(termRange(jun, true)).toEqual({ sm: 4, sy: 2026, em: 9, ey: 2026 })
    expect(rangeBody({ sm: 8, sy: 2026, em: 0, ey: 2027 })).toEqual({ start: '2026-09-01', end: '2027-01-01' })
  })
})
