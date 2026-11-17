// Event and calendar mutations for the Calendar page. Everything invalidates ['calendar'] (events,
// agenda, insights) when it settles; deletes and edits are also applied optimistically.
import { queryOptions, useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { del, get, patch, post } from '../../lib/api'
import { toast } from '../../components/toast'
import type { Calendar, CalEvent, EventDetail, EventIn, EventPatch, Task } from '../../lib/types'

const refresh = (qc: QueryClient) => qc.invalidateQueries({ queryKey: ['calendar'] })

function patchEventCaches(qc: QueryClient, fn: (list: CalEvent[]) => CalEvent[]) {
  const snaps = qc.getQueriesData<CalEvent[]>({ queryKey: ['calendar', 'events'] })
  qc.setQueriesData<CalEvent[]>({ queryKey: ['calendar', 'events'] }, (old) => (old ? fn(old) : old))
  return () => snaps.forEach(([k, d]) => qc.setQueryData(k, d))
}

const onErr = (_e: unknown, _v: unknown, ctx?: { rollback?: () => void }) => ctx?.rollback?.()

/** One event with its reminders and attendees: the peek, the edit dialog and deep links share this cache entry. */
export const eventDetailQuery = (id: string) =>
  queryOptions({
    queryKey: ['calendar', 'event', id],
    queryFn: ({ signal }) => get<EventDetail>(`calendar/events/${id}`, undefined, signal),
    staleTime: 30_000,
  })

/** Icon keys for calendars, categories and events. One query for every picker (they never change at runtime). */
export const useCalendarIcons = (enabled = true) =>
  useQuery({ queryKey: ['calendar', 'icons'], queryFn: () => get<string[]>('calendar/icons'), staleTime: Infinity, enabled })

/** The fields that recreate an event as it was (undo after a delete). A deleted occurrence of a repeating
 *  event comes back as a single event: copying the rule would start a new series. */
export function eventToInput(e: EventDetail): EventIn {
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
    onError: onErr,
    onSettled: () => refresh(qc),
  })
}

export type Scope = 'this' | 'following' | 'all'
const scoped = (id: string, scope?: Scope) => `calendar/events/${encodeURIComponent(id)}${scope ? `?scope=${scope}` : ''}`

export function useUpdateEvent() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body, scope }: { id: string; body: EventPatch; scope?: Scope }) => patch<CalEvent>(scoped(id, scope), body),
    onMutate: async ({ id, body }) => {
      await qc.cancelQueries({ queryKey: ['calendar', 'events'] })
      return { rollback: patchEventCaches(qc, (l) => l.map((e) => (e.id === id ? ({ ...e, ...body } as CalEvent) : e))) }
    },
    onError: onErr,
    onSettled: () => refresh(qc),
  })
}

export function useDeleteEvent() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, scope }: { id: string; scope?: Scope }) => del(scoped(id, scope)),
    onMutate: async ({ id, scope }) => {
      await qc.cancelQueries({ queryKey: ['calendar', 'events'] })
      // Whole series: drop every occurrence of it; otherwise just this one.
      const series = id.split(':')[0]
      return {
        rollback: patchEventCaches(qc, (l) =>
          l.filter((e) => (scope === 'all' ? (e.series_id ?? e.id.split(':')[0]) !== series : e.id !== id)),
        ),
      }
    },
    onError: onErr,
    onSettled: () => refresh(qc),
  })
}

export function useDuplicateEvent() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, days }: { id: string; days: number }) =>
      post<CalEvent>(`calendar/events/${encodeURIComponent(id)}/duplicate`, undefined, { days }),
    onError: onErr,
    onSettled: () => refresh(qc),
  })
}

export function useUpdateCalendar() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, visible }: { id: number; visible: boolean }) => patch<Calendar>(`calendar/calendars/${id}`, { visible }),
    onMutate: async ({ id, visible }) => {
      await qc.cancelQueries({ queryKey: ['calendar', 'calendars'] })
      const prev = qc.getQueryData<Calendar[]>(['calendar', 'calendars'])
      qc.setQueryData<Calendar[]>(['calendar', 'calendars'], (old) => old?.map((c) => (c.id === id ? { ...c, visible } : c)))
      // Hide its events right away instead of waiting for the refetch.
      const rollback = visible ? () => {} : patchEventCaches(qc, (l) => l.filter((e) => e.calendar_id !== id))
      return { rollback: () => (qc.setQueryData(['calendar', 'calendars'], prev), rollback()) }
    },
    onError: onErr,
    onSettled: () => refresh(qc),
  })
}

export function useTaskFromEvent() {
  const qc = useQueryClient()
  return useMutation({
    // The whole id: an occurrence (<series>:<start>) makes a task due on its own date, not the series' first.
    mutationFn: (id: string) => post<Task>(`tasks/from-event/${encodeURIComponent(id)}`),
    onSuccess: (t) => toast.show(`Task "${t.title}" is in your Inbox`),
    onError: onErr,
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['tasks'] })
      refresh(qc)
    },
  })
}
