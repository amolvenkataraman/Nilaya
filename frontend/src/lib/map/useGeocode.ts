// Place search on the map: GET /places/geocode?q= (placewise on the server, offline: towns, states, parks,
// lakes, airports by code, landmarks, postcodes; typos and old names work), debounced 300 ms, from 2
// characters, up to 6 hits. A 503 means placewise isn't running on the server: search reports `off` and
// sends no more requests this session. Used by Places' top search and location entry's map search.
import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { ApiError, get } from '../api'

export interface GeoHit {
  /** placewise id ("nps:YOSE", "iso:CA-ON"): its outline is GET /places/outline?id=. */
  id: string
  lat: number
  lng: number
  name: string
  /** What it is: locality, admin1, park, water, airport, landmark, postal code… */
  kind: string
  /** Where it is: "Ontario, CA". */
  address: string
  /** [south, north, west, east]. */
  bbox?: [number, number, number, number]
}

let offline = false

/** `text` as typed; `enabled` false keeps it quiet (e.g. while the results aren't shown). */
export function useGeocode(text: string, enabled = true) {
  const typed = text.trim()
  const [q, setQ] = useState(typed)
  useEffect(() => {
    const t = setTimeout(() => setQ(typed), 300)
    return () => clearTimeout(t)
  }, [typed])
  const [off, setOff] = useState(offline)
  const query = useQuery({
    queryKey: ['places', 'geocode', q],
    queryFn: async ({ signal }) => {
      try {
        return await get<GeoHit[]>('places/geocode', { q }, signal)
      } catch (e) {
        if (e instanceof ApiError && e.status === 503) {
          offline = true
          setOff(true)
          return []
        }
        throw e
      }
    },
    enabled: enabled && !off && q.length >= 2,
    staleTime: 60 * 60_000,
    retry: false,
  })
  return {
    hits: query.data ?? [],
    off,
    /** Typing hasn't settled yet, or the request is out. */
    waiting: !off && typed.length >= 2 && (q !== typed || query.isFetching),
    error: query.error,
  }
}
