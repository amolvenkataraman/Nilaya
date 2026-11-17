// Coordinates and distances without Leaflet (cheap to import anywhere): great-circle distance, the two ways
// the apps print a distance, coordinate text, links out to OpenStreetMap and Google Maps, and a box around a
// point. Points are `{ lat, lng }`; Places' rows use `lon`, so the helpers take either.

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

/**
 * A distance for people. `short` (lists): "350 m", "1.2 km", "12 km". `precise` (Geoguessr results, as the
 * classic page): "350 m", else km and miles to 2 decimals under 100 ("12.34 km · 7.67 mi").
 */
export function fmtDistance(m: number, style: 'short' | 'precise' = 'short'): string {
  if (m < 1000) return `${Math.round(m)} m`
  const km = m / 1000
  if (style === 'short') return km < 10 ? `${km.toFixed(1)} km` : `${Math.round(km)} km`
  const f = (v: number) => (v < 100 ? v.toFixed(2) : Math.round(v).toLocaleString())
  return `${f(km)} km · ${f(km / 1.609344)} mi`
}

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
