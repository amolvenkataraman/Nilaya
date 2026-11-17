// Notifications' server data: the paged inbox (search, source and unread filters run on the server), delivery
// channels, automatic reminders and the reminder settings other apps own. The flat inbox, the unread count and
// marking read live in lib/queries because the bell and Home use them too.
import {
  type InfiniteData,
  infiniteQueryOptions,
  type QueryClient,
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { toast } from '../../components/toast'
import { del, get, patch, post } from '../../lib/api'
import { plural } from '../../lib/format'
import { useMarkRead, useReadAll } from '../../lib/queries'
import type { Channel, ChannelType, Inbox, Notification, ReminderSettings } from '../../lib/types'

export const INBOX_PAGE = 30
/** A channel's "send at least" choices (notification priority 0-20). */
export const MIN_PRIORITY = [
  { value: 0, label: 'Everything' },
  { value: 10, label: 'Normal and up' },
  { value: 15, label: 'High and up' },
  { value: 20, label: 'Urgent only' },
]
export type InboxPages = InfiniteData<Inbox, string | undefined>
type ChannelPatch = Partial<Pick<Channel, 'name' | 'enabled' | 'min_priority' | 'config'>>

export const notifKeys = {
  // Not under ['notifications','inbox'] on purpose: those caches hold a flat Inbox, these hold pages.
  pages: ['notifications', 'page'] as const,
  page: (unreadOnly: boolean, q: string, source: string) => ['notifications', 'page', unreadOnly, q, source] as const,
  sources: ['notifications', 'sources'] as const,
  channels: ['notifications', 'channels'] as const,
  channelTypes: ['notifications', 'channel-types'] as const,
  reminders: ['notifications', 'reminders'] as const,
}

export const inboxPagesQuery = (unreadOnly: boolean, q: string, source: string) =>
  infiniteQueryOptions({
    queryKey: notifKeys.page(unreadOnly, q, source),
    queryFn: ({ pageParam, signal }) =>
      get<Inbox>(
        'notifications/',
        { unread_only: unreadOnly || undefined, q: q || undefined, source: source || undefined, limit: INBOX_PAGE, before: pageParam },
        signal,
      ),
    placeholderData: (prev) => prev,
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => (last.items.length < INBOX_PAGE ? undefined : last.items[last.items.length - 1].created_on),
  })
export const sourcesQuery = () =>
  queryOptions({
    queryKey: notifKeys.sources,
    queryFn: ({ signal }) => get<string[]>('notifications/sources', undefined, signal),
    staleTime: 60_000,
  })
export const channelsQuery = () =>
  queryOptions({ queryKey: notifKeys.channels, queryFn: ({ signal }) => get<Channel[]>('notifications/channels', undefined, signal) })
export const channelTypesQuery = () =>
  queryOptions({
    queryKey: notifKeys.channelTypes,
    queryFn: ({ signal }) => get<ChannelType[]>('notifications/channel-types', undefined, signal),
    staleTime: Number.POSITIVE_INFINITY,
  })
export const remindersQuery = () =>
  queryOptions({
    queryKey: notifKeys.reminders,
    queryFn: ({ signal }) => get<ReminderSettings>('notifications/reminders', undefined, signal),
  })

/** Apply `fn` to every page of every cached inbox list. */
export function patchPages(qc: QueryClient, fn: (items: Notification[], unread: number) => Inbox) {
  qc.setQueriesData<InboxPages>({ queryKey: notifKeys.pages }, (old) =>
    old ? { ...old, pages: old.pages.map((p) => fn(p.items, p.unread)) } : old,
  )
}

/** Marking read from the inbox: the shared mutations (bell, flat inbox, unread count) plus the paged lists.
 *  NotificationRow's own read button still goes through lib's useMarkRead alone, so its change reaches these
 *  pages on the refetch after it settles; see the report for the two-line lib change that makes it instant. */
export function useInboxReads() {
  const qc = useQueryClient()
  const mark = useMarkRead()
  const readAll = useReadAll()
  return {
    mark: (n: Notification, read: boolean) => {
      patchPages(qc, (items, unread) => ({
        unread: Math.max(0, unread + (n.read === read ? 0 : read ? -1 : 1)),
        items: items.map((x) => (x.id === n.id ? { ...x, read } : x)),
      }))
      mark.mutate({ id: n.id, read })
    },
    readAll: () => {
      patchPages(qc, (items) => ({ unread: 0, items: items.map((x) => ({ ...x, read: true })) }))
      readAll.mutate()
    },
    readingAll: readAll.isPending,
  }
}

/** Snapshot the paged lists, apply `fn`, and hand back a rollback. */
function optimisticPages(qc: QueryClient, fn: (items: Notification[], unread: number) => Inbox) {
  const snaps = qc.getQueriesData<InboxPages>({ queryKey: notifKeys.pages })
  patchPages(qc, fn)
  return () => {
    for (const [k, d] of snaps) qc.setQueryData(k, d)
  }
}

export function useDeleteNotification() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => del(`notifications/${id}`),
    onMutate: (id) => ({ rollback: optimisticPages(qc, (items, unread) => ({ unread, items: items.filter((n) => n.id !== id) })) }),
    onError: (_e, _id, ctx) => ctx?.rollback(),
    onSettled: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  })
}

/** Delete every read notification (not only the ones loaded). */
export function useClearRead() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => post<{ deleted: number }>('notifications/clear-read'),
    onMutate: () => {
      optimisticPages(qc, (items, unread) => ({ unread, items: items.filter((n) => !n.read) }))
    },
    onSuccess: (r) => toast.show(r.deleted ? `Cleared ${plural(r.deleted, 'read notification')}` : 'Nothing to clear'),
    onSettled: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  })
}

// ---------------------------------------------------------------- channels
export function useChannelPatch() {
  const qc = useQueryClient()
  const key = notifKeys.channels
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: ChannelPatch }) => patch<Channel>(`notifications/channels/${id}`, body),
    onMutate: async ({ id, body }) => {
      await qc.cancelQueries({ queryKey: key })
      const prev = qc.getQueryData<Channel[]>(key)
      if (!body.config) qc.setQueryData<Channel[]>(key, (old) => old?.map((c) => (c.id === id ? ({ ...c, ...body } as Channel) : c)))
      return { prev }
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(key, ctx.prev)
    },
    onSettled: () => qc.invalidateQueries({ queryKey: key }),
  })
}

/** Send a test; the outcome (delivered or the channel's error) goes to `onResult`, shown on the row. */
export function useTestChannel(c: Channel, onResult: (r: { ok: boolean; text: string } | null) => void) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => post<{ ok: boolean; error?: string }>(`notifications/channels/${c.id}/test`),
    onMutate: () => onResult(null),
    onSuccess: (r) => onResult(r.ok ? { ok: true, text: 'Test delivered' } : { ok: false, text: r.error || 'Delivery failed' }),
    meta: { errorMessage: () => null }, // shown on the row
    onError: (e) => onResult({ ok: false, text: (e as Error).message }),
    onSettled: () => qc.invalidateQueries({ queryKey: notifKeys.channels }),
  })
}

export function useDeleteChannel(c: Channel) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => del(`notifications/channels/${c.id}`),
    onSuccess: () => toast.show(`Deleted "${c.name}"`),
    onSettled: () => qc.invalidateQueries({ queryKey: notifKeys.channels }),
  })
}

/** Add a channel, or save an existing one's name, priority and settings. */
export function useSaveChannel(channel: Channel | null, onSaved: () => void, onError: (message: string) => void) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (v: { kind: string; name: string; min_priority: number; config: Record<string, string> }) =>
      channel
        ? patch<Channel>(`notifications/channels/${channel.id}`, { name: v.name, min_priority: v.min_priority, config: v.config })
        : post<Channel>('notifications/channels', { ...v, enabled: true }),
    onSuccess: (c) => {
      toast.show(channel ? `Saved "${c.name}"` : `Added "${c.name}"`)
      qc.invalidateQueries({ queryKey: notifKeys.channels })
      onSaved()
    },
    meta: { errorMessage: () => null }, // shown in the form
    onError: (e) => onError((e as Error).message),
  })
}

// ---------------------------------------------------------------- reminders
export function useSaveReminders(onStatus: (s: 'saving' | 'saved' | 'error') => void) {
  const qc = useQueryClient()
  const key = notifKeys.reminders
  return useMutation({
    mutationFn: (body: Partial<ReminderSettings>) => patch<ReminderSettings>('notifications/reminders', body),
    onMutate: (body) => {
      onStatus('saving')
      const prev = qc.getQueryData<ReminderSettings>(key)
      if (prev) qc.setQueryData<ReminderSettings>(key, { ...prev, ...body })
      return { prev }
    },
    onError: (_e, _b, ctx) => {
      if (ctx?.prev) qc.setQueryData(key, ctx.prev)
      onStatus('error')
    },
    onSuccess: (s) => {
      qc.setQueryData(key, s)
      onStatus('saved')
    },
  })
}

/** Reminder settings owned by another app (habits, contacts): saved as they change, with a brief "Saved". */
export function useAppSettings<T extends object>(path: string, onSaved: () => void) {
  const qc = useQueryClient()
  const key = ['settings', path]
  const q = useQuery({ queryKey: key, queryFn: ({ signal }) => get<T>(path, undefined, signal), retry: false })
  const m = useMutation({
    mutationFn: (body: Partial<T>) => patch<T>(path, body),
    onMutate: (body) => {
      const prev = qc.getQueryData<T>(key)
      if (prev) qc.setQueryData<T>(key, { ...prev, ...body })
      return { prev }
    },
    onError: (_e, _b, ctx) => {
      if (ctx?.prev) qc.setQueryData(key, ctx.prev)
    },
    onSuccess: (v) => {
      qc.setQueryData(key, v)
      onSaved()
    },
  })
  return { q, save: m.mutate, error: m.error as Error | null }
}
