// Place search on the map: GET /places/geocode?q= (OpenStreetMap Nominatim through the server), debounced
// 450 ms, from 3 characters, up to 6 hits. A 503 means the server is in offline mode: search reports `off` and
// sends no more requests this session. Used by Places' top search and location entry's map search.
import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { ApiError, get } from '../api'

export interface GeoHit {
  lat: number
  lng: number
  name: string
  address: string
  /** [south, north, west, east], as Nominatim sends it. */
  bbox?: [number, number, number, number]
}
interface Nominatim {
  lat: string
  lon: string
  display_name?: string
  name?: string
  boundingbox?: string[]
}

let offline = false

function toHits(r: Nominatim[]): GeoHit[] {
  return (Array.isArray(r) ? r : []).slice(0, 6).flatMap((x): GeoHit[] => {
    const lat = parseFloat(x.lat)
    const lng = parseFloat(x.lon)
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return []
    const address = String(x.display_name ?? '')
    const bb = (x.boundingbox ?? []).map(Number)
    return [
      {
        lat,
        lng,
        name: String(x.name || address.split(',')[0] || 'Result'),
        address,
        bbox: bb.length === 4 && bb.every(Number.isFinite) ? (bb as [number, number, number, number]) : undefined,
      },
    ]
  })
}

/** `text` as typed; `enabled` false keeps it quiet (e.g. while the results aren't shown). */
export function useGeocode(text: string, enabled = true) {
  const typed = text.trim()
  const [q, setQ] = useState(typed)
  useEffect(() => {
    const t = setTimeout(() => setQ(typed), 450)
    return () => clearTimeout(t)
  }, [typed])
  const [off, setOff] = useState(offline)
  const query = useQuery({
    queryKey: ['places', 'geocode', q],
    queryFn: async ({ signal }) => {
      try {
        return toHits(await get<Nominatim[]>('places/geocode', { q }, signal))
      } catch (e) {
        if (e instanceof ApiError && e.status === 503) {
          offline = true
          setOff(true)
          return []
        }
        throw e
      }
    },
    enabled: enabled && !off && q.length >= 3,
    staleTime: 60 * 60_000,
    retry: false,
  })
  return {
    hits: query.data ?? [],
    off,
    /** Typing hasn't settled yet, or the request is out. */
    waiting: !off && typed.length >= 3 && (q !== typed || query.isFetching),
    error: query.error,
  }
}
