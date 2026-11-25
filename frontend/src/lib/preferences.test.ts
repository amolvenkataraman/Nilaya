import { describe, expect, it } from 'vitest'
import { userDayKey } from './preferences'

describe('userDayKey', () => {
  it('puts the hours before the day start on the day before', () => {
    const lateNight = new Date(2026, 10, 21, 1, 30)
    expect(userDayKey(lateNight, 300)).toBe('2026-11-20')
    expect(userDayKey(new Date(2026, 10, 21, 5), 300)).toBe('2026-11-21')
    expect(userDayKey(lateNight, 0)).toBe('2026-11-21') // midnight days
  })
})
