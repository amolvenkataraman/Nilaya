// Pure helpers for Geoguessr and location entry (tested in game.test.ts).

/** Great-circle distance in metres (haversine; same sphere radius as Leaflet's map.distance). */
export function distanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000
  const r = Math.PI / 180
  const dLat = (b.lat - a.lat) * r
  const dLng = (b.lng - a.lng) * r
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** GeoGuessr-style score: 5000 for a perfect guess, about 1840 at 2000 km. */
export const score = (m: number) => Math.round(5000 * Math.exp(-m / 1000 / 2000))

/** "350 m" under a kilometre, else "12.34 km · 7.67 mi" (the classic page showed metres or km to 2 decimals). */
export function fmtDistance(m: number): string {
  if (m < 1000) return `${Math.round(m)} m`
  const km = m / 1000
  const mi = km / 1.609344
  const f = (v: number) => (v < 100 ? v.toFixed(2) : Math.round(v).toLocaleString())
  return `${f(km)} km · ${f(mi)} mi`
}

/** Classic colours: close under 10 km, far over 100 km. */
export const closeness = (m: number): 'close' | 'far' | 'mid' => (m < 10_000 ? 'close' : m > 100_000 ? 'far' : 'mid')
