// Places API hooks (local to this page). The API also returns status/visited_on, newer than lib/types.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, del, get, patch, post, readCookie } from '../../lib/api'
import type { Photo, Place as BasePlace, PlaceCategory, PlaceGroup } from '../../lib/types'
import { toast } from '../../components/toast'

export type PlaceStatus = 'saved' | 'want_to_go' | 'visited'
export interface Place extends BasePlace { status?: PlaceStatus; visited_on?: string | null; updated_on?: string }
export type PlaceInput = Omit<Place, 'id' | 'updated_on'>
/** A map pin (GET /places/pins): only what the map and list rows need; the full place loads when opened. */
type PinField = 'id' | 'group_id' | 'name' | 'latitude' | 'longitude' | 'category' | 'status' | 'rating' | 'address' | 'visited_on'
export type Pin = Pick<Place, PinField> & Partial<Omit<Place, PinField>>

export const STATUSES: { key: PlaceStatus; label: string; icon: string }[] = [
  { key: 'saved', label: 'Saved', icon: 'star' },
  { key: 'want_to_go', label: 'Want to go', icon: 'flag' },
  { key: 'visited', label: 'Visited', icon: 'check' },
]

/** Category glyphs (Icon names; GET /places/categories has no icon field). The classic map's set, redrawn
 *  in the app's icon style. Unlisted keys ("other", anything new) get a plain dot on the map. */
const CATEGORY_ICON: Record<string, string> = {
  house: 'home', business: 'briefcase', school: 'book', university: 'school', restaurant: 'utensils', shop: 'tag',
  mall: 'cart', parking: 'car', religious: 'landmark', hospital: 'stethoscope', transit: 'train', park: 'tree', nature: 'leaf',
}
export const categoryIcon = (key: string): string | undefined => CATEGORY_ICON[key]

export interface PlaceFilter { group?: number; category?: string; status?: PlaceStatus; q?: string }

/** A group with my per-person map visibility (hidden by default) and the owner's archive flag. */
export interface Group extends PlaceGroup { visible: boolean; archived: boolean }
export const usePlaceGroups = (includeArchived = false) =>
  useQuery({
    queryKey: ['places', 'groups', includeArchived],
    queryFn: () => get<Group[]>('places/groups', { include_archived: includeArchived || undefined }),
    staleTime: 5 * 60_000,
    placeholderData: (prev) => prev,
  })

export const VISIBLE_KEY = ['places', 'pins', 'visible'] as const
export const fetchVisiblePins = (signal?: AbortSignal) => get<Pin[]>('places/pins', { visible: true }, signal)
/** The map's normal load: pins of the groups I turned on (never archived ones). Off while nothing is on. */
export const useVisiblePlaces = (enabled: boolean) =>
  useQuery({ queryKey: VISIBLE_KEY, queryFn: ({ signal }) => fetchVisiblePins(signal), enabled, staleTime: 5 * 60_000 })

/** One full place (description, notes, address…): when its panel opens, or before editing it. */
export const placeQuery = (id: string) => ({ queryKey: ['places', 'one', id], queryFn: () => get<Place>(`places/${id}`), staleTime: 60_000 })
export const usePlace = (id: string | null) => useQuery({ ...placeQuery(id ?? ''), enabled: !!id })
/** Text filter over the groups that are on: matched on the server (address, notes and description aren't in pins). */
export const useVisibleTextMatches = (q: string, enabled: boolean) =>
  useQuery({
    queryKey: ['places', 'list', { visible: true, q }],
    queryFn: ({ signal }) => get<Place[]>('places/', { visible: true, q }, signal),
    enabled: enabled && q.length >= 2, staleTime: 60_000, placeholderData: (prev) => prev,
  })

/** Search every non-archived group I can see (shown or not), on the server. */
export const usePlaceSearch = (q: string) =>
  useQuery({ queryKey: ['places', 'search', q], queryFn: ({ signal }) => get<Place[]>('places/', { q }, signal), enabled: q.length >= 2, staleTime: 60_000 })

const patchGroups = (qc: ReturnType<typeof useQueryClient>, fn: (g: Group) => Group) =>
  qc.setQueriesData<Group[]>({ queryKey: ['places', 'groups'] }, (old) => old?.map(fn))

/** Show/hide one group (optimistic). Hiding drops its places from the cache: no request; showing refetches. */
export function useGroupVisibility() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, visible }: { id: number; visible: boolean }) => api(`places/groups/${id}/visibility`, { method: 'PUT', body: { visible } }),
    onMutate: ({ id, visible }) => {
      const snaps = qc.getQueriesData<Group[]>({ queryKey: ['places', 'groups'] })
      patchGroups(qc, (g) => (g.id === id ? { ...g, visible } : g))
      if (!visible) qc.setQueryData<Pin[]>(VISIBLE_KEY, (old) => old?.filter((p) => p.group_id !== id))
      return { rollback: () => snaps.forEach(([k, d]) => qc.setQueryData(k, d)) }
    },
    onSuccess: (_r, { visible }) => { if (visible) qc.invalidateQueries({ queryKey: VISIBLE_KEY }) },
    onError: (e, _v, ctx) => (ctx?.rollback(), toast.error((e as Error).message), qc.invalidateQueries({ queryKey: VISIBLE_KEY })),
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
    onSuccess: (_r, g) => { if (!g.visible) qc.invalidateQueries({ queryKey: VISIBLE_KEY }) },
    onError: (e) => (toast.error((e as Error).message), qc.invalidateQueries({ queryKey: ['places'] })),
  })
}
export const usePlaceCategories = () =>
  useQuery({ queryKey: ['places', 'categories'], queryFn: () => get<PlaceCategory[]>('places/categories'), staleTime: Infinity })
export const usePlaces = (f: PlaceFilter) =>
  useQuery({
    queryKey: ['places', 'list', f],
    queryFn: ({ signal }) => get<Place[]>('places/', { group: f.group, category: f.category, status: f.status, q: f.q }, signal),
    placeholderData: (prev) => prev,
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
    onError: (e) => toast.error((e as Error).message),
    onSettled: done,
  })
}

export function useDeletePlace() {
  const done = useInvalidate()
  return useMutation({
    mutationFn: (p: Place) => del(`places/${p.id}`),
    onSuccess: (_r, p) => toast.show(`Deleted "${p.name}"`),
    onError: (e) => toast.error((e as Error).message),
    onSettled: done,
  })
}

export function useSaveGroup() {
  const done = useInvalidate()
  return useMutation({
    mutationFn: ({ id, body }: { id?: number; body: Partial<Pick<Group, 'name' | 'description' | 'is_public' | 'archived'>> }) =>
      id ? patch<PlaceGroup>(`places/groups/${id}`, body) : post<PlaceGroup>('places/groups', body),
    onError: (e) => toast.error((e as Error).message),
    onSettled: done,
  })
}

export function useDeleteGroup() {
  const done = useInvalidate()
  return useMutation({
    mutationFn: (g: PlaceGroup) => del(`places/groups/${g.id}`),
    onSuccess: (_r, g) => toast.show(`Deleted the group "${g.name}"`),
    onError: (e) => toast.error((e as Error).message),
    onSettled: done,
  })
}

// ---------------------------------------------------------------- parity with the classic Places page

/** Every place once; filters, search and counts are done in the browser (one request, no refetch per filter). */
export const useAllPlaces = () =>
  useQuery({ queryKey: ['places', 'list', 'all'], queryFn: ({ signal }) => get<Place[]>('places/', undefined, signal), staleTime: 5 * 60_000 })

export interface PlacePhotos { count: number; visits: number; first_visit: string | null; last_visit: string | null; photos: Photo[] }
export const usePlacePhotos = (id: string | null) =>
  useQuery({ queryKey: ['places', 'photos', id], queryFn: () => get<PlacePhotos>(`places/${id}/photos`), enabled: !!id, staleTime: 30 * 60_000 })

export interface Suggestion { latitude: number; longitude: number; photos: number; days: number; first_day: string; last_day: string; city: string | null; country: string | null; name: string; address: string }
export const useSuggestions = (enabled: boolean) =>
  useQuery({ queryKey: ['places', 'suggestions'], queryFn: () => get<Suggestion[]>('places/suggestions', { limit: 30 }), enabled, staleTime: 60 * 60_000 })

export interface PlaceStats {
  total: number; by_status: Record<PlaceStatus, number>; by_category: { key: string; label: string; count: number }[]
  most_visited: { id: string; name: string; category: string; visits: number; last_visit: string | null }[]
}
export const usePlaceStats = (enabled: boolean) =>
  useQuery({ queryKey: ['places', 'stats'], queryFn: () => get<PlaceStats>('places/stats'), enabled, staleTime: 10 * 60_000 })

export interface ImportResult { format: string; found: number; new: number; duplicates: number; invalid: number; created: number; sample: string[] }
/** POST /places/import (multipart): dryRun previews what would be added. */
export async function importPlaces(file: File, groupId: number, dryRun: boolean): Promise<ImportResult> {
  const fd = new FormData()
  fd.append('file', file)
  fd.append('group_id', String(groupId))
  fd.append('dry_run', dryRun ? 'true' : 'false')
  const res = await fetch('/api/v2/places/import', { method: 'POST', body: fd, credentials: 'same-origin', headers: { 'X-CSRFToken': readCookie('csrftoken'), Accept: 'application/json' } })
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new Error((data && typeof data.detail === 'string' && data.detail) || `Import failed (${res.status})`)
  return data as ImportResult
}

/** Great-circle distance in metres. */
export function distanceM(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R = 6371e3
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLon = toRad(b.lon - a.lon)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}
export const fmtDistance = (m: number) => (m < 1000 ? `${Math.round(m)} m` : m < 10_000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m / 1000)} km`)
