// Photo locations for heat maps (Photos › Map, Places, Geoguessr): one query shape, so the same area and
// filters share one cached request across pages. No Leaflet here, so it costs nothing to import.
import { keepPreviousData, queryOptions } from '@tanstack/react-query'
import { get } from '../../lib/api'

export type HeatPoint = { lat: number; lng: number; count: number }
export interface Box {
  south: number
  west: number
  north: number
  east: number
}
export const WORLD: Box = { south: -90, west: -180, north: 90, east: 180 }

/** A coordinate of exactly 0 is broken GPS (e.g. EXIF longitude 0.0), not a place: never draw it. */
export const realPoints = (pts: HeatPoint[]) => pts.filter((p) => p.lat !== 0 && p.lng !== 0)

/** The visible area clamped to the world and snapped outwards to 0.01°, so small pans reuse the cached box. */
export function snapBox(b: Box): Box {
  const down = (v: number) => Math.floor(v * 100) / 100
  const up = (v: number) => Math.ceil(v * 100) / 100
  return {
    south: down(Math.max(-90, b.south)),
    west: down(Math.max(-180, b.west)),
    north: up(Math.min(90, b.north)),
    east: up(Math.min(180, b.east)),
  }
}

/** Filters as query params (unset ones are left out, so no filter at all is `{}`). */
export type PointFilters = Record<string, string | number | boolean | undefined>

export const photoPointsQuery = (box: Box | null, filters: PointFilters = {}) =>
  queryOptions({
    queryKey: ['photos', 'points', box, filters],
    queryFn: ({ signal }) => get<HeatPoint[]>('photos/points', { ...box!, ...filters }, signal),
    select: realPoints,
    enabled: !!box,
    staleTime: 30 * 60_000,
    placeholderData: keepPreviousData,
  })
