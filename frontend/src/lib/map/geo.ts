// Coordinates and distances without Leaflet (cheap to import anywhere): great-circle distance, the two ways the
// apps print a distance and how they print an altitude (in the account's units), coordinate text, links out to
// OpenStreetMap and Google Maps, and a box around a point. Points are `{ lat, lng }`; Places' rows use `lon`, so
// the helpers take either.
import { displayPrefs } from '../display'

export type LatLng = { lat: number; lng: number }
type AnyLatLng = { lat: number; lng: number } | { lat: number; lon: number }

const lngOf = (p: AnyLatLng) => ('lng' in p ? p.lng : p.lon)

/** Great-circle distance in metres (haversine; the same sphere radius as Leaflet's map.distance). */
export function distanceM(a: AnyLatLng, b: AnyLatLng): number {
  const R = 6371000
  const r = Math.PI / 180
  const dLat = (b.lat - a.lat) * r
  const dLng = (lngOf(b) - lngOf(a)) * r
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

const M_PER_MI = 1609.344
const FT_PER_M = 3.28084
const grouped = (v: number) => Math.round(v).toLocaleString()
/** 2 decimals under 100, whole (grouped) from there: the classic Geoguessr page's precision. */
const twoPlaces = (v: number) => (v < 100 ? v.toFixed(2) : grouped(v))

function metric(m: number, style: 'short' | 'precise'): string {
  if (m < 1000) return `${Math.round(m)} m`
  const km = m / 1000
  if (style === 'precise') return `${twoPlaces(km)} km`
  return km < 10 ? `${km.toFixed(1)} km` : `${Math.round(km)} km`
}
/** Feet under a tenth of a mile (528 ft), as road signs count down. */
function imperial(m: number, style: 'short' | 'precise'): string {
  const mi = m / M_PER_MI
  if (mi < 0.1) return `${grouped(m * FT_PER_M)} ft`
  if (style === 'precise') return `${twoPlaces(mi)} mi`
  return mi < 10 ? `${mi.toFixed(1)} mi` : `${Math.round(mi)} mi`
}

/**
 * A distance for people, in the account's units (Settings › Preferences). `short` (lists): "350 m", "1.2 km",
 * "12 km" / "980 ft", "1.2 mi". `precise` (Geoguessr results): 2 decimals under 100. Both units (the default) is
 * metric in lists and both from a kilometre in precise text, as the classic page: "12.35 km · 7.67 mi".
 */
export function fmtDistance(m: number, style: 'short' | 'precise' = 'short'): string {
  const { units } = displayPrefs()
  if (units === 'mi') return imperial(m, style)
  if (units === 'both' && style === 'precise' && m >= 1000) return `${metric(m, style)} · ${twoPlaces(m / M_PER_MI)} mi`
  return metric(m, style)
}

/** A height above sea level: "350 m", or "1,148 ft" in miles. */
export const fmtAltitude = (m: number) => (displayPrefs().units === 'mi' ? `${grouped(m * FT_PER_M)} ft` : `${grouped(m)} m`)

/** "12.97160, 77.59456" (5 decimals ≈ 1 m, for display) or 6 for copying and links. */
export const fmtCoords = (lat: number, lng: number, digits = 5) => `${lat.toFixed(digits)}, ${lng.toFixed(digits)}`

/** OpenStreetMap at a point, with a marker. */
export const osmUrl = (lat: number, lng: number, zoom = 17, digits = 6) => {
  const [a, b] = [lat.toFixed(digits), lng.toFixed(digits)]
  return `https://www.openstreetmap.org/?mlat=${a}&mlon=${b}#map=${zoom}/${a}/${b}`
}

/** Directions to a point: OpenStreetMap's router, or Google Maps. */
export function directionsUrl(lat: number, lng: number, via: 'osm' | 'google' = 'osm'): string {
  const ll = `${lat.toFixed(6)},${lng.toFixed(6)}`
  return via === 'osm'
    ? `https://www.openstreetmap.org/directions?to=${lat.toFixed(6)}%2C${lng.toFixed(6)}`
    : `https://www.google.com/maps/dir/?api=1&destination=${ll}`
}

export interface Box {
  south: number
  west: number
  north: number
  east: number
}
export const WORLD: Box = { south: -90, west: -180, north: 90, east: 180 }

/** The box `r` metres around a point (longitude span widened by latitude, capped near the poles). */
export function boxAround(lat: number, lng: number, r: number): Box {
  const dLat = r / 111320
  const dLng = r / (111320 * Math.max(Math.cos((lat * Math.PI) / 180), 0.01))
  return { north: lat + dLat, south: lat - dLat, east: lng + dLng, west: lng - dLng }
}
