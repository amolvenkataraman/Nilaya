import { describe, expect, it } from 'vitest'
import { filterCount, isPlainTimeline, parseTimelineState } from './timelineState'

const endOf26th = new Date(2026, 6, 27, 5).toISOString() // days begin at 5 am

describe('parseTimelineState', () => {
  it.each([
    ['', { place: '', filter: undefined, plain: true, count: 0, start: undefined }],
    // A date jump starts at the end of that day and still counts as the plain timeline.
    ['date=2026-07-26', { place: '', filter: undefined, plain: true, count: 1, start: endOf26th }],
    ['kind=videos&date=26-7-2026', { place: '', filter: { video: true }, plain: false, count: 2, start: undefined }],
    [
      'city=Waterloo&camera=Pixel%207&north=1&south=0&east=1&west=0',
      {
        place: 'Waterloo · Camera: Pixel 7 · In this map area',
        filter: { city: 'Waterloo', camera: 'Pixel 7', north: 1, south: 0, east: 1, west: 0 },
        plain: false,
        count: 3,
        start: undefined,
      },
    ],
    // Oldest first pages forward from the start, whatever the date.
    [
      'min_blur=150&order=oldest&date=2026-07-26',
      { place: 'Sharpness over 150', filter: { min_blur: 150, order: 'oldest' }, plain: false, count: 3, start: undefined },
    ],
  ])('%s', (qs, want) => {
    const p = new URLSearchParams(qs)
    const s = parseTimelineState(p, 300)
    expect([s.place, s.filter, s.startBefore]).toEqual([want.place, want.filter, want.start])
    expect([isPlainTimeline(p), filterCount(p)]).toEqual([want.plain, want.count])
  })
})
