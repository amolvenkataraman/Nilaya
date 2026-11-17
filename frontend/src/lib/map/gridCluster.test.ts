import { describe, expect, it } from 'vitest'
import { gridCluster } from './gridCluster'

describe('gridCluster', () => {
  it('groups by screen cell at the weighted centre and merges neighbours across a cell edge', () => {
    const project = (lat: number, lng: number) => ({ x: lng, y: lat }) // 1 px per degree
    type P = { lat: number; lng: number; n: number }
    const pts: P[] = [
      { lat: 1, lng: 1, n: 3 },
      { lat: 5, lng: 5, n: 1 }, // same 10 px cell as the first
      { lat: 1, lng: 11, n: 1 }, // the next cell, about 10 px away: merged when mergePx > 10
      { lat: 50, lng: 50, n: 2 },
    ]
    const opts = { latLng: (p: P) => [p.lat, p.lng] as const, project, cellPx: 10, weight: (p: P) => p.n }
    const cells = gridCluster(pts, opts)
    expect(cells.map((c) => c.weight).sort()).toEqual([1, 2, 4])
    const first = cells.find((c) => c.weight === 4)
    expect([first?.lat, first?.lng, first?.south, first?.north]).toEqual([2, 2, 1, 5])
    expect(
      gridCluster(pts, { ...opts, mergePx: 12 })
        .map((c) => c.weight)
        .sort(),
    ).toEqual([2, 5])
    expect(gridCluster(pts, { ...opts, cellPx: 0 })).toHaveLength(4)
  })
})
