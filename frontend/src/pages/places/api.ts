// Places API: types, query factories and mutations. The API also returns status/visited_on, newer than lib/types.
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from '../../components/toast'
import { api, del, get, patch, post, upload } from '../../lib/api'
import type { Place as BasePlace, Photo, PlaceCategory, PlaceGroup } from '../../lib/types'
import type { IconName } from '../../components/Icon'

export type PlaceStatus = 'saved' | 'want_to_go' | 'visited'
export interface Place extends BasePlace {
  status?: PlaceStatus
  visited_on?: string | null
  updated_on?: string
}
export type PlaceInput = Omit<Place, 'id' | 'updated_on'>
/** A map pin (GET /places/pins): only what the map and list rows need; the full place loads when opened. */
type PinField = 'id' | 'group_id' | 'name' | 'latitude' | 'longitude' | 'category' | 'status' | 'rating' | 'address' | 'visited_on'
export type Pin = Pick<Place, PinField> & Partial<Omit<Place, PinField>>

export const STATUSES: { key: PlaceStatus; label: string; icon: IconName }[] = [
  { key: 'saved', label: 'Saved', icon: 'star' },
  { key: 'want_to_go', label: 'Want to go', icon: 'flag' },
  { key: 'visited', label: 'Visited', icon: 'check' },
]
/** Unknown or missing statuses count as saved. */
export const statusOf = (p: { status?: string | null }): PlaceStatus =>
  p.status === 'visited' || p.status === 'want_to_go' ? p.status : 'saved'

/** Category glyphs (Icon names; GET /places/categories has no icon field). The classic map's set, redrawn
 *  in the app's icon style. Unlisted keys ("other", anything new) get a plain dot on the map. */
const CATEGORY_ICON: Record<string, IconName> = {
  house: 'home',
  business: 'briefcase',
  school: 'book',
  university: 'school',
  restaurant: 'utensils',
  shop: 'tag',
  mall: 'cart',
  parking: 'car',
  religious: 'landmark',
  hospital: 'stethoscope',
  transit: 'train',
  park: 'tree',
  nature: 'leaf',
}
export const categoryIcon = (key: string): IconName | undefined => CATEGORY_ICON[key]

/** "★★★☆☆" for a 1-5 rating ('' for none). */
export const stars = (n: number | null | undefined) => (n ? '★'.repeat(n) + '☆'.repeat(5 - n) : '')

/** A group with my per-person map visibility (hidden by default) and the owner's archive flag. */
export interface Group extends PlaceGroup {
  visible: boolean
  archived: boolean
}
export const usePlaceGroups = (includeArchived = false) =>
  useQuery({
    queryKey: ['places', 'groups', includeArchived],
    queryFn: ({ signal }) => get<Group[]>('places/groups', { include_archived: includeArchived || undefined }, signal),
    staleTime: 5 * 60_000,
    placeholderData: (prev) => prev,
  })

/** The map's normal load: pins of the groups I turned on (never archived ones). */
export const visiblePinsQuery = queryOptions({
  queryKey: ['places', 'pins', 'visible'],
  queryFn: ({ signal }) => get<Pin[]>('places/pins', { visible: true }, signal),
  staleTime: 5 * 60_000,
})
const VISIBLE_KEY = visiblePinsQuery.queryKey
/** Off while no group is on. */
export const useVisiblePlaces = (enabled: boolean) => useQuery({ ...visiblePinsQuery, enabled })

/** One full place (description, notes, address…): when its panel opens, or before editing it. */
export const placeQuery = (id: string) =>
  queryOptions({
    queryKey: ['places', 'one', id],
    queryFn: ({ signal }) => get<Place>(`places/${id}`, undefined, signal),
    staleTime: 60_000,
  })
export const usePlace = (id: string | null) => useQuery({ ...placeQuery(id ?? ''), enabled: !!id })
/** Text filter over the groups that are on: matched on the server (address, notes and description aren't in pins). */
export const useVisibleTextMatches = (q: string, enabled: boolean) =>
  useQuery({
    queryKey: ['places', 'list', { visible: true, q }],
    queryFn: ({ signal }) => get<Place[]>('places/', { visible: true, q }, signal),
    enabled: enabled && q.length >= 2,
    staleTime: 60_000,
    placeholderData: (prev) => prev,
  })

/** Search every non-archived group I can see (shown or not), on the server. */
export const usePlaceSearch = (q: string) =>
  useQuery({
    queryKey: ['places', 'search', q],
    queryFn: ({ signal }) => get<Place[]>('places/', { q }, signal),
    enabled: q.length >= 2,
    staleTime: 60_000,
  })

const patchGroups = (qc: ReturnType<typeof useQueryClient>, fn: (g: Group) => Group) =>
  qc.setQueriesData<Group[]>({ queryKey: ['places', 'groups'] }, (old) => old?.map(fn))

/** Show/hide one group (optimistic). Hiding drops its places from the cache: no request; showing refetches. */
export function useGroupVisibility() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, visible }: { id: number; visible: boolean }) =>
      api(`places/groups/${id}/visibility`, { method: 'PUT', body: { visible } }),
    onMutate: ({ id, visible }) => {
      const snaps = qc.getQueriesData<Group[]>({ queryKey: ['places', 'groups'] })
      patchGroups(qc, (g) => (g.id === id ? { ...g, visible } : g))
      if (!visible) qc.setQueryData<Pin[]>(VISIBLE_KEY, (old) => old?.filter((p) => p.group_id !== id))
      return {
        rollback: () => {
          for (const [k, d] of snaps) qc.setQueryData(k, d)
        },
      }
    },
    onSuccess: (_r, { visible }) => {
      if (visible) qc.invalidateQueries({ queryKey: VISIBLE_KEY })
    },
    onError: (_e, _v, ctx) => {
      ctx?.rollback()
      qc.invalidateQueries({ queryKey: VISIBLE_KEY })
    },
  })
}

/** Show only this group. If it was already on, the cached places are just filtered (no request). */
export function useShowOnlyGroup() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (g: Group) => post(`places/groups/${g.id}/only`),
    onMutate: (g) => {
      patchGroups(qc, (x) => ({ ...x, visible: x.id === g.id }))
      if (g.visible) qc.setQueryData<Pin[]>(VISIBLE_KEY, (old) => old?.filter((p) => p.group_id === g.id))
    },
    onSuccess: (_r, g) => {
      if (!g.visible) qc.invalidateQueries({ queryKey: VISIBLE_KEY })
    },
    onError: () => qc.invalidateQueries({ queryKey: ['places'] }),
  })
}
export const usePlaceCategories = () =>
  useQuery({
    queryKey: ['places', 'categories'],
    queryFn: ({ signal }) => get<PlaceCategory[]>('places/categories', undefined, signal),
    staleTime: Number.POSITIVE_INFINITY,
  })

function useInvalidate() {
  const qc = useQueryClient()
  return () => qc.invalidateQueries({ queryKey: ['places'] })
}

export function useSavePlace() {
  const done = useInvalidate()
  return useMutation({
    mutationFn: ({ id, body }: { id?: string; body: Partial<PlaceInput> }) =>
      id ? patch<Place>(`places/${id}`, body) : post<Place>('places/', body),
    onSuccess: (p, v) => toast.show(v.id ? `Saved "${p.name}"` : `Added "${p.name}"`),
    onSettled: done,
  })
}

export function useDeletePlace() {
  const done = useInvalidate()
  return useMutation({
    mutationFn: (p: Place) => del(`places/${p.id}`),
    onSuccess: (_r, p) => toast.show(`Deleted "${p.name}"`),
    onSettled: done,
  })
}

export function useSaveGroup() {
  const done = useInvalidate()
  return useMutation({
    mutationFn: ({ id, body }: { id?: number; body: Partial<Pick<Group, 'name' | 'description' | 'is_public' | 'archived'>> }) =>
      id ? patch<PlaceGroup>(`places/groups/${id}`, body) : post<PlaceGroup>('places/groups', body),
    onSettled: done,
  })
}

export function useDeleteGroup() {
  const done = useInvalidate()
  return useMutation({
    mutationFn: (g: PlaceGroup) => del(`places/groups/${g.id}`),
    onSuccess: (_r, g) => toast.show(`Deleted the group "${g.name}"`),
    onSettled: done,
  })
}

// ---------------------------------------------------------------- photos, suggestions, stats, import

export interface PlacePhotos {
  count: number
  visits: number
  first_visit: string | null
  last_visit: string | null
  photos: Photo[]
}
export const usePlacePhotos = (id: string | null) =>
  useQuery({
    queryKey: ['places', 'photos', id],
    queryFn: ({ signal }) => get<PlacePhotos>(`places/${id}/photos`, undefined, signal),
    enabled: !!id,
    staleTime: 30 * 60_000,
  })
/** Photos near a spot (a suggestion; Photos › Map's "photos near here" asks for 24). */
export const usePhotosNear = (lat: number, lng: number, limit = 12) =>
  useQuery({
    queryKey: ['places', 'photos-near', lat.toFixed(4), lng.toFixed(4)],
    queryFn: ({ signal }) => get<PlacePhotos>('places/photos-near', { latitude: lat.toFixed(6), longitude: lng.toFixed(6), limit }, signal),
    staleTime: 30 * 60_000,
  })

export interface Suggestion {
  latitude: number
  longitude: number
  photos: number
  days: number
  first_day: string
  last_day: string
  city: string | null
  country: string | null
  name: string
  address: string
}
export const useSuggestions = (enabled: boolean) =>
  useQuery({
    queryKey: ['places', 'suggestions'],
    queryFn: ({ signal }) => get<Suggestion[]>('places/suggestions', { limit: 30 }, signal),
    enabled,
    staleTime: 60 * 60_000,
  })

export interface PlaceStats {
  total: number
  by_status: Record<PlaceStatus, number>
  by_category: { key: string; label: string; count: number }[]
  most_visited: { id: string; name: string; category: string; visits: number; last_visit: string | null }[]
}
export const usePlaceStats = (enabled: boolean) =>
  useQuery({
    queryKey: ['places', 'stats'],
    queryFn: ({ signal }) => get<PlaceStats>('places/stats', undefined, signal),
    enabled,
    staleTime: 10 * 60_000,
  })

export interface ImportResult {
  format: string
  found: number
  new: number
  duplicates: number
  invalid: number
  created: number
  sample: string[]
}
/** POST /places/import (multipart): dryRun previews what would be added. */
export async function importPlaces(file: File, groupId: number, dryRun: boolean): Promise<ImportResult> {
  const fd = new FormData()
  fd.append('file', file)
  fd.append('group_id', String(groupId))
  fd.append('dry_run', dryRun ? 'true' : 'false')
  return upload<ImportResult>('places/import', fd)
}
