// Small pieces of Places text and links: a visit date ("Jul 26, 2026") and the timeline of photos taken near a
// spot (the same 150 m the server uses for "Photos here").
import { fmtDate, parseDayKey } from '../../lib/dates'
import { boxAround } from '../../lib/map/geo'
import { photosInArea } from '../photos/util'

export const PHOTO_RADIUS_M = 150

export const fmtDay = (iso: string | null | undefined) =>
  iso ? fmtDate(parseDayKey(iso.slice(0, 10)), { month: 'short', day: 'numeric', year: 'numeric' }) : ''

export function photosNear(lat: number, lng: number, r = PHOTO_RADIUS_M): string {
  const b = boxAround(lat, lng, r)
  return photosInArea(b.north, b.south, b.east, b.west)
}
