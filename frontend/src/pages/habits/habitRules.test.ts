import { describe, expect, it } from 'vitest'
import type { Habit } from './api'
import { dayMet } from './habitRules'

describe('habit rules', () => {
  const h = (o: Partial<Habit>) => ({ kind: 'measurable', goal: 'at_least', target: 10, period: 'day', ...o }) as Habit

  it('judges one day like the server: a daily amount in full, any amount towards a week or month goal', () => {
    expect([dayMet(h({}), 9.99), dayMet(h({}), 10), dayMet(h({ target: 0.3 }), 0.1 + 0.2)]).toEqual([false, true, true])
    expect([dayMet(h({ period: 'week' }), 0.5), dayMet(h({ period: 'month' }), 0)]).toEqual([true, false])
    expect([dayMet(h({ kind: 'yesno', target: 3, period: 'week' }), 1), dayMet(h({ kind: 'yesno' }), 0)]).toEqual([true, false])
    expect([dayMet(h({ goal: 'at_most', target: 0.3 }), 0.1 + 0.2), dayMet(h({ goal: 'at_most', target: 2 }), 3)]).toEqual([true, false])
  })
})
