import { describe, expect, it } from 'vitest'
import type { AgendaItem } from '../../lib/types'
import { splitAgenda } from './todayAgenda'

const item = (p: Partial<AgendaItem>): AgendaItem => ({
  kind: 'event',
  id: p.title ?? 'x',
  title: 'x',
  start: null,
  end: null,
  colour: '#000',
  calendar: 'C',
  done: false,
  has_todo: false,
  icon: null,
  location: null,
  priority: 0,
  series_id: null,
  start_date: null,
  end_date: null,
  status: null,
  ...p,
})

describe('splitAgenda', () => {
  it('keeps what covers today (ongoing multi-day, all-day, timed), drops tasks, and splits off later days', () => {
    const now = new Date(2026, 10, 16, 12, 0)
    const at = (d: number, h: number) => new Date(2026, 10, d, h, 0).toISOString()
    const s = splitAgenda(
      [
        item({ title: 'trip', start: at(14, 9), end: at(18, 9) }),
        item({ title: 'holiday', kind: 'all_day', start: at(16, 0), start_date: '2026-11-16', end_date: '2026-11-17' }),
        item({ title: 'done', start: at(16, 8), end: at(16, 9) }),
        item({ title: 'soon', start: at(16, 13), end: at(16, 14) }),
        item({ title: 'task', kind: 'todo', start: at(16, 15) }),
        item({ title: 'tomorrow', start: at(17, 10), end: at(17, 11) }),
      ],
      now,
    )
    expect(s.today.map((i) => i.title)).toEqual(['trip', 'holiday', 'done', 'soon'])
    expect(s.left).toBe(2) // trip (still on) and soon
    expect(s.soon?.title).toBe('soon')
    expect(s.later.map((i) => i.title)).toEqual(['tomorrow'])
  })
})
