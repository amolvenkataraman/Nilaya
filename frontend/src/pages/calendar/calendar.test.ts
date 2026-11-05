import { describe, expect, it } from 'vitest'
import { eventsByDay, layoutDay, parseCalState, viewRange } from './util'
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

  it('parses URL state and computes ranges', () => {
    const s = parseCalState(new URLSearchParams('view=week&date=2026-11-04&insights=month'))
    expect(s).toMatchObject({ view: 'week', insights: 'month', isNew: false })
    expect(parseCalState(new URLSearchParams('view=x&date=junk')).view).toBe('month')
    const r = viewRange('week', s.date)
    expect(r.start.getDay()).toBe(1)
    expect(r.days).toHaveLength(7)
    expect(viewRange('week', s.date, 3).start.getDate()).toBe(4)
  })
})
