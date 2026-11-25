import { describe, expect, it } from 'vitest'
import type { Pin } from './api'
import { countPlaces } from './usePlaceFilters'

describe('countPlaces', () => {
  it('counts statuses, ratings at least 3/4/5 and categories in one pass', () => {
    const pin = (status: Pin['status'], rating: number | null, category: string) => ({ status, rating, category }) as Pin
    const c = countPlaces([pin('saved', 5, 'park'), pin('visited', 3, 'park'), pin('want_to_go', null, 'shop')])
    expect(c.status).toEqual({ saved: 1, want_to_go: 1, visited: 1 })
    expect(c.rating).toEqual({ 3: 2, 4: 1, 5: 1 })
    expect([...c.category]).toEqual([
      ['park', 2],
      ['shop', 1],
    ])
  })
})
