// Settings' server data: API keys (/keys/), signed-in phones (/devices/), private ICS feeds (/feeds/), the per-app guides and the staff usage
// summary. Profile and password go through lib/queries (useMe, useUpdateMe) and their own forms.
import { keepPreviousData, queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from '../../components/toast'
import { del, get, getText, patch, post } from '../../lib/api'
import { keys as libKeys } from '../../lib/queries'
import type { Me, Schemas } from '../../lib/types'

export interface KeyApp {
  app: string
  label: string
  scopes: string[]
}
export type ApiKey = Schemas['KeyOut']
export type Feed = Schemas['FeedOut']
interface Totals {
  views: number | null
  calls: number | null
}
export interface UsageSummary {
  days: number
  per_day: (Totals & { day: string; people: number })[]
  apps: (Totals & { app: string; people: number })[]
  people: (Totals & { user: string; name: string; active_days: number })[]
  matrix: (Totals & { user__username: string; app: string })[]
}

export const settingsKeys = {
  keys: ['settings', 'keys'] as const,
  keyApps: ['settings', 'key-apps'] as const,
  feeds: ['settings', 'feeds'] as const,
  devices: ['settings', 'devices'] as const,
  usage: (days: number) => ['settings', 'usage', days] as const,
  maintenance: ['settings', 'maintenance'] as const,
  placeSources: ['settings', 'place-sources'] as const,
}

export const apiKeysQuery = () =>
  queryOptions({ queryKey: settingsKeys.keys, queryFn: ({ signal }) => get<ApiKey[]>('keys/', undefined, signal) })
/** The apps a key can reach; the guides list uses it too. Fixed per deploy. */
export const keyAppsQuery = () =>
  queryOptions({
    queryKey: settingsKeys.keyApps,
    queryFn: ({ signal }) => get<KeyApp[]>('keys/apps', undefined, signal),
    staleTime: Number.POSITIVE_INFINITY,
  })
export const feedsQuery = () =>
  queryOptions({ queryKey: settingsKeys.feeds, queryFn: ({ signal }) => get<Feed[]>('feeds/', undefined, signal) })
export const usageQuery = (days: number) =>
  queryOptions({
    queryKey: settingsKeys.usage(days),
    queryFn: ({ signal }) => get<UsageSummary>('analytics/summary', { days }, signal),
    placeholderData: keepPreviousData,
    staleTime: 5 * 60_000,
  })

export const useApiKeys = () => useQuery(apiKeysQuery())
export const useKeyApps = () => useQuery(keyAppsQuery())
export const useFeeds = () => useQuery(feedsQuery())

export function useRevokeKey(k: ApiKey) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => del(`keys/${k.id}`),
    onSuccess: () => toast.show(`Revoked "${k.name}"`),
    onSettled: () => qc.invalidateQueries({ queryKey: settingsKeys.keys }),
  })
}

/** Create (returns the token, shown once) or edit a key's name and access (returns null). */
export function useSaveKey(apiKey: ApiKey | null, onError: (message: string) => void) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ name, scopes, expiryDays }: { name: string; scopes: string[]; expiryDays: string }): Promise<string | null> => {
      if (apiKey) {
        await patch<ApiKey>(`keys/${apiKey.id}`, { name, scopes })
        return null
      }
      const expires_on = expiryDays ? new Date(Date.now() + Number(expiryDays) * 86_400_000).toISOString() : null
      return (await post<{ key: ApiKey; token: string }>('keys/', { name, scopes, expires_on })).token
    },
    onSettled: () => qc.invalidateQueries({ queryKey: settingsKeys.keys }),
    meta: { errorMessage: () => null }, // shown in the form
    onError: (e) => onError((e as Error).message),
  })
}

/** A new feed; with `replace`, the old one is revoked once the new address exists ("New address"). */
export function useCreateFeed(onCreated: (created: { url: string; name: string }) => void) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (v: { kind: Feed['kind']; name: string; replace?: Feed }) =>
      post<{ feed: Feed; url: string }>('feeds/', { kind: v.kind, name: v.name }),
    onSuccess: (res, v) => {
      onCreated({ url: res.url, name: res.feed.name }) // keep the new URL even if revoking the old one fails
      if (v.replace) {
        del(`feeds/${v.replace.id}`)
          .then(() => toast.show('New address made; the old one stopped working'))
          .catch((e) => toast.error(`New address made, but the old one is still active: ${(e as Error).message}`))
          .finally(() => qc.invalidateQueries({ queryKey: settingsKeys.feeds }))
      }
    },
    onSettled: () => qc.invalidateQueries({ queryKey: settingsKeys.feeds }),
  })
}

export function useRevokeFeed(f: Feed) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => del(`feeds/${f.id}`),
    onSuccess: () => toast.show('Feed revoked'),
    onSettled: () => qc.invalidateQueries({ queryKey: settingsKeys.feeds }),
  })
}

/** An app's Markdown guide (fetched on demand for Copy and Download; Open links to it). */
export const fetchGuide = (app: string) => getText(`${encodeURIComponent(app)}/guide.md`)

/** Upload a cropped picture (a JPEG data URL); the server re-encodes it. */
export function useUploadPicture(onDone: () => void, onError: (message: string) => void) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (dataUrl: string) => post<Me>('me/picture', { data_url: dataUrl }),
    onSuccess: (me) => {
      qc.setQueryData(libKeys.me, me)
      qc.invalidateQueries({ queryKey: ['users', me.username] })
      toast.show('Profile picture updated')
      onDone()
    },
    meta: { errorMessage: () => null }, // shown in the dialog
    onError: (e) => onError((e as Error).message),
  })
}

/** Change the password (204); this device stays signed in. */
export function useChangePassword(onDone: () => void, onError: (message: string) => void) {
  return useMutation({
    mutationFn: (v: { old: string; next: string }) => post<void>('me/password', { old: v.old, new: v.next }),
    onSuccess: () => {
      onDone()
      toast.show('Password changed. You stay signed in here.')
    },
    meta: { errorMessage: () => null }, // shown in the form
    onError: (e) => onError((e as Error).message),
  })
}

/** A phone signed in to Nilaya's phone apps, and which apps on it have a key. */
export type Device = Schemas['DeviceOut']

export const devicesQuery = () =>
  queryOptions({ queryKey: settingsKeys.devices, queryFn: ({ signal }) => get<Device[]>('devices/', undefined, signal) })
export const useDevices = () => useQuery(devicesQuery())

/** Sign a phone out: its device token and every app key on it stop working. */
export function useSignOutDevice(d: Device) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => del(`devices/${d.id}`),
    onSuccess: () => toast.show(`Signed out ${d.name}`),
    onSettled: () => qc.invalidateQueries({ queryKey: settingsKeys.devices }),
  })
}

/** One run of a maintenance job (staff, GET /maintenance/jobs). The server types options and result as plain dicts. */
export type MaintenanceRun = Omit<Schemas['RunOut'], 'options' | 'result'> & {
  options: Record<string, boolean>
  /** Job-specific: "Name photo places" keeps its 25 most common [old, new, photos] changes and how many more kinds. */
  result: { changes?: [string, string, number][]; more_kinds?: number }
}
export interface MaintenanceJob {
  key: string
  title: string
  description: string
  group: string
  options: { key: string; label: string; default: boolean }[]
  /** Newest first, up to 5. */
  runs: MaintenanceRun[]
}
export interface Maintenance {
  services: {
    placewise: {
      ok: boolean
      error?: string
      data_version?: string
      uptime_s?: number
      cache?: { hits: number; misses: number; size: number }
    }
  }
  jobs: MaintenanceJob[]
}
const busy = (r?: MaintenanceRun) => !!r && (r.status === 'queued' || r.status === 'running')
/** Polls every 1.5 s while a job runs. */
export const maintenanceQuery = () =>
  queryOptions({
    queryKey: settingsKeys.maintenance,
    queryFn: ({ signal }) => get<Maintenance>('maintenance/jobs', undefined, signal),
    refetchInterval: (q) => (q.state.data?.jobs.some((j) => busy(j.runs[0])) ? 1500 : false),
  })
export const useMaintenance = () => useQuery(maintenanceQuery())
export const runIsBusy = busy

export function useStartJob() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (v: { key: string; options: Record<string, boolean> }) =>
      post<MaintenanceRun>(`maintenance/jobs/${encodeURIComponent(v.key)}/run`, { options: v.options }),
    onSettled: () => qc.invalidateQueries({ queryKey: settingsKeys.maintenance }),
  })
}

/** A data source behind place names, outlines and search (placewise's attribution registry). */
export interface PlaceSource {
  id: string
  name: string
  url: string
  licence: string
  credit: string
  used_in: string[]
}
export const placeSourcesQuery = () =>
  queryOptions({
    queryKey: settingsKeys.placeSources,
    queryFn: ({ signal }) => get<Record<string, PlaceSource>>('places/sources', undefined, signal),
    staleTime: 60 * 60_000,
  })
