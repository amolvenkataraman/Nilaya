import { describe, expect, it } from 'vitest'
import { distanceM, fmtDistance, score } from './game'

describe('geoguessr scoring', () => {
  it('scores by distance and formats it', () => {
    const toronto = { lat: 43.6532, lng: -79.3832 }
    const waterloo = { lat: 43.4643, lng: -80.5204 }
    const d = distanceM(toronto, waterloo)
    expect(d / 1000).toBeCloseTo(94, 0)
    expect(score(0)).toBe(5000)
    expect(score(2_000_000)).toBe(1839)
    expect(fmtDistance(350.4)).toBe('350 m')
    expect(fmtDistance(12_345)).toBe('12.35 km · 7.67 mi')
  })
})
