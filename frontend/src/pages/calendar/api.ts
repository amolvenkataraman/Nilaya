// The Calendar app's server calls: one key factory (`ck`), the queries more than one place reads (as
// queryOptions), and every mutation. Event edits are applied optimistically and roll back on failure; each
// mutation refreshes only what it changes. Failures toast once from main.tsx's MutationCache (meta.errorMessage
// words the sync ones), so the hooks here only add success messages, rollbacks and refreshes.
import { keepPreviousData, queryOptions, useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { toast } from '../../components/toast'
import { ApiError, del, get, patch, post } from '../../lib/api'
import { plural } from '../../lib/format'
import { keys } from '../../lib/queries'
import type {
  Attendee,
  Calendar,
  CalEvent,
  Category,
  EventDetail,
  EventIn,
  EventOrDetail,
  EventPatch,
  Schemas,
  Task,
} from '../../lib/types'
import { type CalendarDetail, type CalendarPatchBody, type Invite, personName, type Subscriber } from './types'

/** Query keys. Everything sits under ['calendar'] except what other apps own (contacts, places, users). */
export const ck = {
  all: ['calendar'] as const,
  calendars: keys.calendars,
  allCalendars: [...keys.calendars, 'all'] as const,
  categories: keys.categories,
  /** Another owner's categories (someone else's calendar uses theirs). */
  ownerCategories: (calendarId: number) => [...keys.categories, calendarId] as const,
  eventLists: ['calendar', 'events'] as const,
  events: keys.events,
  /** One disabled calendar's events, shown on request. */
  calendarEvents: (start: string, end: string, calendarId: number) => [...keys.events(start, end), { calendar: calendarId }] as const,
  event: (id: string) => ['calendar', 'event', id] as const,
  agenda: ['calendar', 'agenda'] as const,
  insights: ['calendar', 'insights'] as const,
  details: ['calendar', 'detail'] as const,
  detail: (id: number) => ['calendar', 'detail', id] as const,
  subscribers: (id: number) => ['calendar', 'subscribers', id] as const,
  allSubscribers: ['calendar', 'subscribers'] as const,
  invites: (id: number) => ['calendar', 'invites', id] as const,
  searches: ['calendar', 'search'] as const,
  search: (q: string) => ['calendar', 'search', q] as const,
  availability: (username: string, day: string) => ['calendar', 'availability', username, day] as const,
  icons: ['calendar', 'icons'] as const,
  user: (username: string) => ['users', username] as const,
  contactSearch: (q: string) => ['contacts', 'search', q] as const,
  /** The Places app's "every place" list (pages/places/api.ts useAllPlaces): one cached copy for both. */
  places: ['places', 'list', 'all'] as const,
}

// ---------------------------------------------------------------- queries

/** Events in [start, end): the visible range, and the next one warmed while idle. */
export const eventsQuery = (start: string, end: string) =>
  queryOptions({
    queryKey: ck.events(start, end),
    queryFn: ({ signal }) => get<CalEvent[]>('calendar/events', { start, end }, signal),
    placeholderData: keepPreviousData,
    staleTime: 2 * 60_000,
  })

/** A disabled calendar's events for the range ("Show events"): asked for one calendar at a time. */
export const calendarEventsQuery = (start: string, end: string, calendarId: number) =>
  queryOptions({
    queryKey: ck.calendarEvents(start, end, calendarId),
    queryFn: ({ signal }) => get<CalEvent[]>('calendar/events', { start, end, calendar: calendarId }, signal),
    staleTime: 2 * 60_000,
  })

/** One event with its reminders and attendees: the peek, the edit dialog and deep links share this cache entry. */
export const eventDetailQuery = (id: string) =>
  queryOptions({
    queryKey: ck.event(id),
    queryFn: ({ signal }) => get<EventDetail>(`calendar/events/${encodeURIComponent(id)}`, undefined, signal),
    staleTime: 30_000,
  })

/** Icon keys for calendars, categories and events. One query for every picker (they never change at runtime). */
export const useCalendarIcons = (enabled = true) =>
  useQuery({
    queryKey: ck.icons,
    queryFn: ({ signal }) => get<string[]>('calendar/icons', undefined, signal),
    staleTime: Number.POSITIVE_INFINITY,
    enabled,
  })

export const useCalendarDetail = (id: number) =>
  useQuery({ queryKey: ck.detail(id), queryFn: ({ signal }) => get<CalendarDetail>(`calendar/calendars/${id}`, undefined, signal) })

export const useSubscribers = (id: number) =>
  useQuery({
    queryKey: ck.subscribers(id),
    queryFn: ({ signal }) => get<Subscriber[]>(`calendar/calendars/${id}/subscribers`, undefined, signal),
  })

export const useInvites = (id: number) =>
  useQuery({ queryKey: ck.invites(id), queryFn: ({ signal }) => get<Invite[]>(`calendar/calendars/${id}/invites`, undefined, signal) })

/** Categories of the owner of calendar `calendarId` (null: my own, from lib's useCategories). */
export const useOwnerCategories = (calendarId: number | null) =>
  useQuery({
    queryKey: ck.ownerCategories(calendarId ?? 0),
    queryFn: ({ signal }) => get<Category[]>('calendar/categories', { calendar: calendarId! }, signal),
    enabled: calendarId != null,
    staleTime: 60 * 60_000,
  })

/** Events matching `q` (name, location, description) within ±200 days of today. */
export const useEventSearch = (q: string, start: string, end: string, enabled: boolean) =>
  useQuery({
    queryKey: ck.search(q),
    queryFn: ({ signal }) => get<CalEvent[]>('calendar/events', { q, start, end }, signal),
    enabled,
    staleTime: 60_000,
  })

export interface Busy {
  start: string
  end: string
}
export interface Availability {
  username: string
  name?: string
  date: string
  busy: Busy[]
}
/** Someone's busy times on one day (cut in their time zone). A 404 (no such user) isn't retried. */
export const availabilityQuery = (username: string, day: string, enabled: boolean) =>
  queryOptions({
    queryKey: ck.availability(username, day),
    queryFn: ({ signal }) => get<Availability>(`calendar/availability/${encodeURIComponent(username)}`, { date: day }, signal),
    staleTime: 2 * 60_000,
    enabled,
    retry: (n: number, e: unknown) => !(e instanceof ApiError && e.status === 404) && n < 2,
  })

export type Profile = Schemas['UsersPersonOut']
/** Someone's public profile (shared with the Users app's page under the same key). Not retried: 404 is an answer. */
export const userQuery = (username: string) =>
  queryOptions({
    queryKey: ck.user(username),
    queryFn: ({ signal }) => get<Profile>(`users/${encodeURIComponent(username)}`, undefined, signal),
    staleTime: 10 * 60_000,
    retry: false,
  })

export type PlaceOption = Pick<Schemas['MapPlaceOut'], 'id' | 'name' | 'address'>
export const usePlaces = (enabled: boolean) =>
  useQuery({
    queryKey: ck.places,
    queryFn: ({ signal }) => get<PlaceOption[]>('places/', undefined, signal),
    staleTime: 5 * 60_000,
    enabled,
  })

export type ContactHit = Pick<Schemas['PersonBrief'], 'id' | 'name' | 'email'>
export const useContactSearch = (q: string) =>
  useQuery({
    queryKey: ck.contactSearch(q),
    queryFn: ({ signal }) => get<{ items: ContactHit[] }>('contacts/', { q, sort: 'name', limit: 8 }, signal),
    enabled: q.length >= 2,
    staleTime: 60_000,
  })

// ---------------------------------------------------------------- events

/** After an event changes: lists, agenda and insights (not calendars, categories or settings). */
function refreshEvents(qc: QueryClient, id?: string) {
  qc.invalidateQueries({ queryKey: ck.eventLists })
  qc.invalidateQueries({ queryKey: ck.agenda })
  qc.invalidateQueries({ queryKey: ck.insights })
  qc.invalidateQueries({ queryKey: ck.searches })
  if (id) qc.invalidateQueries({ queryKey: ck.event(id) })
}

function patchEventCaches(qc: QueryClient, fn: (list: CalEvent[]) => CalEvent[]) {
  const snaps = qc.getQueriesData<CalEvent[]>({ queryKey: ck.eventLists })
  qc.setQueriesData<CalEvent[]>({ queryKey: ck.eventLists }, (old) => (old ? fn(old) : old))
  return () => {
    for (const [k, d] of snaps) qc.setQueryData(k, d)
  }
}

const rollback = (_e: unknown, _v: unknown, ctx?: { rollback?: () => void }) => ctx?.rollback?.()

/** The fields that recreate an event as it was (undo after a delete). A deleted occurrence of a repeating
 *  event comes back as a single event: copying the rule would start a new series. */
export function eventToInput(e: EventOrDetail): EventIn {
  const allDay = e.kind === 'all_day' && !!e.start_date
  return {
    calendar_id: e.calendar_id,
    name: e.name,
    kind: e.kind,
    ...(allDay ? { start_date: e.start_date, end_date: e.end_date ?? null } : { start: e.start, end: e.end }),
    all_day: e.all_day,
    category_id: e.category_id ?? null,
    location: e.location,
    description: e.description,
    priority: e.priority,
    colour: e.colour ?? null,
    icon: e.icon ?? null,
    tags: e.tags ?? [],
    rrule: e.recurring || e.series_id ? '' : (e.rrule ?? ''),
    reminders: e.reminders ?? null,
    meeting_url: e.meeting_url ?? '',
    place_id: e.place?.id ?? null,
    status: e.status,
    transparency: e.transparency,
    visibility: e.visibility,
  }
}

export function useCreateEvent() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: EventIn) => post<CalEvent>('calendar/events', body),
    onSettled: () => refreshEvents(qc),
  })
}

export type Scope = 'this' | 'following' | 'all'
const eventPath = (id: string) => `calendar/events/${encodeURIComponent(id)}`

export function useUpdateEvent() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body, scope }: { id: string; body: EventPatch; scope?: Scope }) =>
      patch<CalEvent>(eventPath(id), body, scope ? { scope } : undefined),
    onMutate: async ({ id, body }) => {
      await qc.cancelQueries({ queryKey: ck.eventLists })
      return { rollback: patchEventCaches(qc, (l) => l.map((e) => (e.id === id ? ({ ...e, ...body } as CalEvent) : e))) }
    },
    onError: rollback,
    onSettled: (_r, _e, { id }) => refreshEvents(qc, id),
  })
}

/** Deletes an event; `restore` (its detail) offers Undo in the toast, which recreates it. The toast is shown
 *  here rather than by the caller: the peek and the dialog close before the request returns. */
export function useDeleteEvent() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, scope }: { id: string; scope?: Scope; done: string; restore?: EventOrDetail }) =>
      del(eventPath(id), scope ? { scope } : undefined),
    onMutate: async ({ id, scope }) => {
      await qc.cancelQueries({ queryKey: ck.eventLists })
      // Whole series: drop every occurrence of it; otherwise just this one.
      const series = id.split(':')[0]
      return {
        rollback: patchEventCaches(qc, (l) =>
          l.filter((e) => (scope === 'all' ? (e.series_id ?? e.id.split(':')[0]) !== series : e.id !== id)),
        ),
      }
    },
    onError: rollback,
    onSuccess: (_r, { done, restore }) => {
      const run = () =>
        post('calendar/events', eventToInput(restore!)).then(
          () => refreshEvents(qc),
          (err: unknown) => toast.fail(err),
        )
      toast.show(done, restore ? { action: { label: 'Undo', run } } : {})
    },
    onSettled: () => refreshEvents(qc),
  })
}

export function useDuplicateEvent() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, days }: { id: string; days: number }) => post<CalEvent>(`${eventPath(id)}/duplicate`, undefined, { days }),
    onSuccess: (_c, { days }) =>
      toast.show(days ? `Duplicated ${plural(Math.abs(days), 'day')} ${days > 0 ? 'later' : 'earlier'}` : 'Duplicated'),
    onSettled: () => refreshEvents(qc),
  })
}

export function useTaskFromEvent() {
  const qc = useQueryClient()
  return useMutation({
    // The whole id: an occurrence (<series>:<start>) makes a task due on its own date, not the series' first.
    mutationFn: (id: string) => post<Task>(`tasks/from-event/${encodeURIComponent(id)}`),
    onSuccess: (t) => toast.show(`Task "${t.title}" is in your Inbox`),
    onSettled: (_t, _e, id) => {
      qc.invalidateQueries({ queryKey: ['tasks'] })
      qc.invalidateQueries({ queryKey: ck.event(id) })
      qc.invalidateQueries({ queryKey: ck.agenda })
    },
  })
}

// ---------------------------------------------------------------- attendees
const attendeesPath = (eventId: string) => `${eventPath(eventId)}/attendees`

export function useAttendeeMutations() {
  const qc = useQueryClient()
  const onSettled = (_r: unknown, _e: unknown, v: { eventId: string }) => qc.invalidateQueries({ queryKey: ck.event(v.eventId) })
  return {
    add: useMutation({
      mutationFn: ({ eventId, attendee }: { eventId: string; attendee: Partial<Attendee> & { contact_id?: string } }) =>
        post(attendeesPath(eventId), attendee),
      onSettled,
    }),
    rsvp: useMutation({
      mutationFn: ({ eventId, id, rsvp }: { eventId: string; id: number; rsvp: string }) =>
        patch(`${attendeesPath(eventId)}/${id}`, { rsvp }),
      onSettled,
    }),
    remove: useMutation({
      mutationFn: ({ eventId, id }: { eventId: string; id: number }) => del(`${attendeesPath(eventId)}/${id}`),
      onSettled,
    }),
  }
}

// ---------------------------------------------------------------- calendars

/** Show or hide a calendar in my view; its events go away at once instead of after the refetch. */
export function useSetVisible() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, visible }: { id: number; visible: boolean }) => patch<Calendar>(`calendar/calendars/${id}`, { visible }),
    onMutate: async ({ id, visible }) => {
      await qc.cancelQueries({ queryKey: ck.calendars })
      const prev = qc.getQueryData<Calendar[]>(ck.calendars)
      qc.setQueryData<Calendar[]>(ck.calendars, (old) => old?.map((c) => (c.id === id ? { ...c, visible } : c)))
      const restore = visible ? () => {} : patchEventCaches(qc, (l) => l.filter((e) => e.calendar_id !== id))
      return {
        rollback: () => {
          qc.setQueryData(ck.calendars, prev)
          restore()
        },
      }
    },
    onError: rollback,
    onSettled: (_r, _e, { id }) => {
      qc.invalidateQueries({ queryKey: ck.calendars })
      qc.invalidateQueries({ queryKey: ck.detail(id) })
      refreshEvents(qc)
    },
  })
}

/** PATCH a calendar's settings; the reply is the new detail. Names, colours and visibility show in the list
 *  and on events, so those refresh too. */
export function useSaveCalendar(id: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: CalendarPatchBody) => patch<CalendarDetail>(`calendar/calendars/${id}`, body),
    onSuccess: (d) => {
      qc.setQueryData(ck.detail(id), d)
      qc.invalidateQueries({ queryKey: ck.calendars })
      qc.invalidateQueries({ queryKey: ck.eventLists })
    },
  })
}

export type SyncResult = { ok: boolean; not_modified?: boolean; last_synced_at?: string | null; last_sync_error?: string }

/** Readable text for a failed preview or sync (503 = offline mode). */
export const syncError = (e: unknown) =>
  e instanceof ApiError && e.status === 503
    ? 'Syncing is off on this server (offline mode).'
    : (e as Error).message || 'Something went wrong.'

/** Sync a calendar now (its own window) or a month range [start, end); toasts the result. */
export function useSyncCalendar(id: number, name: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body?: { start: string; end: string; token?: string }) => post<SyncResult>(`calendar/calendars/${id}/sync`, body),
    onSuccess: (r) =>
      r.ok ? toast.show(r.not_modified ? `"${name}" is up to date` : `Synced "${name}"`) : toast.error(r.last_sync_error || 'Sync failed'),
    meta: { errorMessage: syncError },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ck.detail(id) })
      refreshEvents(qc)
    },
  })
}

/** Leave someone else's calendar (my subscription goes; its events disappear everywhere). */
export function useLeaveCalendar() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (cal: Pick<Calendar, 'id' | 'name'>) => del(`calendar/calendars/${cal.id}/subscription`),
    onSuccess: (_r, cal) => toast.show(`Left "${cal.name}"`),
    onSettled: () => qc.invalidateQueries({ queryKey: ck.all }),
  })
}

/** Delete my calendar and its events for everyone; the server wants its name typed back as confirmation. */
export function useDeleteCalendar() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ cal, typed }: { cal: Pick<Calendar, 'id' | 'name'>; typed: string }) =>
      del(`calendar/calendars/${cal.id}`, { confirm: typed }),
    onSuccess: (_r, { cal }) => toast.show(`Deleted "${cal.name}"`),
    onSettled: () => qc.invalidateQueries({ queryKey: ck.all }),
  })
}

export interface NewCalendar {
  name: string
  colour: string
  icon: string
  sync?: { calendar_type: number; calendar_url: string; auto_sync: boolean; sync_past_months: number; sync_future_months: number }
}
/** Create a calendar; one synced from a link syncs right away and that result is the toast. */
export function useCreateCalendar() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ sync, ...body }: NewCalendar) => post<Calendar>('calendar/calendars', { ...body, ...sync }),
    onSuccess: async (c, { sync }) => {
      qc.invalidateQueries({ queryKey: ck.calendars })
      if (!sync) return void toast.show(`Created "${c.name}"`)
      try {
        const r = await post<SyncResult>(`calendar/calendars/${c.id}/sync`)
        if (r.ok) toast.show(`Created and synced "${c.name}"`)
        else toast.error(`Created "${c.name}", but the first sync failed: ${r.last_sync_error || 'unknown error'}`)
      } catch (e) {
        toast.error(`Created "${c.name}", but it didn't sync: ${syncError(e)}`)
      } finally {
        qc.invalidateQueries({ queryKey: ck.all })
      }
    },
  })
}

export interface Preview {
  name: string | null
  events: number | null
  series: number | null
  upcoming: { name: string; start: string; all_day: boolean; repeats: boolean }[]
}
/** What a source holds, before connecting it. Errors show inline, not as a toast. */
export const usePreviewSource = () =>
  useMutation({
    mutationFn: (src: { calendar_type: number; url: string }) => post<Preview>('calendar/preview-source', src),
    meta: { errorMessage: () => null },
  })

/** Join a calendar with an invite code; also fetches its owner's name for the confirmation. Errors show inline. */
export function useSubscribe() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (code: string) => {
      const cal = await post<Calendar>('calendar/subscribe', undefined, { code })
      let owner = ''
      try {
        const d = await qc.fetchQuery({
          queryKey: ck.detail(cal.id),
          queryFn: ({ signal }) => get<CalendarDetail>(`calendar/calendars/${cal.id}`, undefined, signal),
        })
        if (d.owner) owner = personName(d.owner)
      } catch {
        /* the calendar's name is enough */
      }
      return { cal, owner }
    },
    meta: { errorMessage: () => null },
    onSuccess: () => qc.invalidateQueries({ queryKey: ck.all }),
  })
}

// ---------------------------------------------------------------- people and invites

export function useSubscriberMutations(calId: number) {
  const qc = useQueryClient()
  const onSettled = () => qc.invalidateQueries({ queryKey: ck.subscribers(calId) })
  return {
    setRole: useMutation({
      mutationFn: ({ id, role }: { id: number; role: string }) => patch(`calendar/calendars/${calId}/subscribers/${id}`, { role }),
      onSettled,
    }),
    remove: useMutation({ mutationFn: (id: number) => del(`calendar/calendars/${calId}/subscribers/${id}`), onSettled }),
  }
}

export type InviteIn = Schemas['InviteIn']
export function useInviteMutations(calId: number) {
  const qc = useQueryClient()
  const onSettled = () => qc.invalidateQueries({ queryKey: ck.invites(calId) })
  return {
    create: useMutation({
      mutationFn: (body: InviteIn) => post<Invite>(`calendar/calendars/${calId}/invites`, body),
      onSuccess: (inv) => toast.copy(inv.code, 'Invite code copied'),
      onSettled,
    }),
    setActive: useMutation({
      mutationFn: ({ id, active }: { id: number; active: boolean }) => patch(`calendar/calendars/${calId}/invites/${id}`, { active }),
      onSettled,
    }),
    remove: useMutation({ mutationFn: (id: number) => del(`calendar/calendars/${calId}/invites/${id}`), onSettled }),
  }
}

// ---------------------------------------------------------------- categories

export type CategoryPatch = Partial<Pick<Category, 'name' | 'colour' | 'icon' | 'position'>>

export function useCategoryMutations() {
  const qc = useQueryClient()
  // Categories show on events too: refresh both after a change.
  const onSettled = () => {
    qc.invalidateQueries({ queryKey: ck.categories })
    qc.invalidateQueries({ queryKey: ck.eventLists })
  }
  return {
    save: useMutation({
      mutationFn: ({ id, body }: { id?: number; body: CategoryPatch }) =>
        id ? patch<Category>(`calendar/categories/${id}`, body) : post<Category>('calendar/categories', body),
      onSettled,
    }),
    remove: useMutation({
      mutationFn: (c: Category) => del(`calendar/categories/${c.id}`),
      onSuccess: (_r, c) => toast.show(`Deleted "${c.name}": its events are now Uncategorized`),
      onSettled,
    }),
    /** Swap two neighbours' positions (positions may have gaps or ties, so both are renumbered). */
    swap: useMutation({
      mutationFn: ({ a, b, pa }: { a: Category; b: Category; pa: number }) =>
        Promise.all([
          patch(`calendar/categories/${a.id}`, { position: pa }),
          patch(`calendar/categories/${b.id}`, { position: a.position }),
        ]),
      onMutate: ({ a, b, pa }) => {
        const prev = qc.getQueryData<Category[]>(ck.categories)
        qc.setQueryData<Category[]>(ck.categories, (old) =>
          old?.map((c) => (c.id === a.id ? { ...c, position: pa } : c.id === b.id ? { ...c, position: a.position } : c)),
        )
        return { rollback: () => qc.setQueryData(ck.categories, prev) }
      },
      onError: rollback,
      onSettled,
    }),
  }
}
