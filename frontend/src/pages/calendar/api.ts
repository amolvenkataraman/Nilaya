// Event and calendar mutations for the Calendar page. Everything invalidates ['calendar'] (events,
// agenda, insights) when it settles; deletes and edits are also applied optimistically.
import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { del, patch, post } from '../../lib/api'
import { toast } from '../../components/toast'
import type { Calendar, CalEvent, EventIn, EventPatch, Task } from '../../lib/types'

const refresh = (qc: QueryClient) => qc.invalidateQueries({ queryKey: ['calendar'] })

function patchEventCaches(qc: QueryClient, fn: (list: CalEvent[]) => CalEvent[]) {
  const snaps = qc.getQueriesData<CalEvent[]>({ queryKey: ['calendar', 'events'] })
  qc.setQueriesData<CalEvent[]>({ queryKey: ['calendar', 'events'] }, (old) => (old ? fn(old) : old))
  return () => snaps.forEach(([k, d]) => qc.setQueryData(k, d))
}

const onErr = (e: unknown, _v: unknown, ctx?: { rollback?: () => void }) => {
  ctx?.rollback?.()
  toast.error((e as Error).message)
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
      return { rollback: patchEventCaches(qc, (l) => l.filter((e) => (scope === 'all' ? (e.series_id ?? e.id.split(':')[0]) !== series : e.id !== id))) }
    },
    onError: onErr,
    onSettled: () => refresh(qc),
  })
}

export function useDuplicateEvent() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, days }: { id: string; days: number }) => post<CalEvent>(`calendar/events/${encodeURIComponent(id)}/duplicate`, undefined, { days }),
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
    mutationFn: (id: string) => post<Task>(`tasks/from-event/${id.split(':')[0]}`),
    onSuccess: (t) => toast.show(`Task "${t.title}" is in your Inbox`),
    onError: onErr,
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['tasks'] })
      refresh(qc)
    },
  })
}
