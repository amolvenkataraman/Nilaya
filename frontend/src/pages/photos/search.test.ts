import { describe, expect, it } from 'vitest'
import { countLabel, dropSpan } from './search'

describe('smart search', () => {
  it('drops a term with its dangling connector', () => {
    expect(dropSpan('videos in india', [2, 3])).toBe('videos')
    expect(dropSpan('videos in india', [0, 1])).toBe('india')
    expect(dropSpan('pixel 7  paris june 2023', [0, 2])).toBe('paris june 2023')
    expect(dropSpan('dog', [0, 1])).toBe('')
  })
  it('labels counts, capped or not', () => {
    expect(countLabel(1284)).toBe('1,284 photos')
    expect(countLabel(10000, true)).toBe('10,000+ photos')
    expect(countLabel(1, false, 'video')).toBe('1 video')
  })
})
