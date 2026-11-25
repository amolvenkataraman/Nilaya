// Photos read queries used from more than one screen, as queryOptions factories so every caller shares one
// cache entry (and one request): a photo's details (viewer actions + info panel), per-day totals (timeline
// day headers + the day page), browse lists (filters drawer + Browse), one photo by id (deep links).
import { queryOptions } from '@tanstack/react-query'
import { get } from '../../lib/api'
import type { Photo, Schemas, YearGroup } from '../../lib/types'

export type PhotoDetails = Schemas['PhotoDetailOut']

export const photoDetailsQuery = (id: string) =>
  queryOptions({
    queryKey: ['photos', 'details', id],
    queryFn: ({ signal }) => get<PhotoDetails>(`photos/${id}/details`, undefined, signal),
    staleTime: 10 * 60_000,
  })

export const photoQuery = (id: string) =>
  queryOptions({ queryKey: ['photos', 'photo', id], queryFn: ({ signal }) => get<Photo>(`photos/${id}`, undefined, signal) })

/** Totals of one local day ("10 photos · 1 video · 56.6 MB"), keyed by YYYY-MM-DD. */
export type DayInfo = { photos: number; videos: number; size_kb: number }
export const dayInfoQuery = (start: string, end: string) =>
  queryOptions({
    queryKey: ['photos', 'days', start, end],
    queryFn: ({ signal }) => get<Record<string, DayInfo>>('photos/days', { start, end }, signal),
    staleTime: 30 * 60_000,
  })

export type BrowseItem = { display: string; value: string; count: number; country?: string }
export type BrowseCategory = 'cities' | 'countries' | 'cameras' | 'objects'
export const browseQuery = (cat: BrowseCategory) =>
  queryOptions({
    queryKey: ['photos', 'browse', cat],
    queryFn: ({ signal }) => get<BrowseItem[]>(`photos/browse/${cat}`, undefined, signal),
    staleTime: 60 * 60_000,
  })

export const onThisDayQuery = queryOptions({
  queryKey: ['photos', 'on-this-day'],
  queryFn: ({ signal }) => get<YearGroup[]>('photos/on-this-day', undefined, signal),
  staleTime: 30 * 60_000,
})
