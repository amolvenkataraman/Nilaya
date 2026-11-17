// Everything the visible range shows, loaded in parallel: events (plus disabled calendars someone asked to see),
// photo counts, tasks and birthdays, grouped by day in the display zone. When the browser is idle the next
// range's events are fetched too, so stepping forward is instant.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useQueries, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import { dayKey, parseDayKey } from '../../lib/dates'
import type { CalEvent, Task } from '../../lib/types'
import { calendarEventsQuery, eventsQuery } from './api'
import { useBirthdays, usePhotoCounts, useRangeTasks, useShowBirthdays, useShowTasks } from './layers'
import { eventsByDay, fetchRange, stepDate, viewRange, type CalState } from './range'
import type { Layers } from './types'
import type { WeekStart, Zone } from './zone'

/** Events of disabled calendars, greyed (ghost) and read-only. */
const ghosts = (results: UseQueryResult<CalEvent[]>[]) => results.flatMap((r) => r.data ?? []).map((e) => ({ ...e, ghost: true }))

export function useCalendarData({
  state,
  weekDays,
  weekStart,
  tz,
  onTask,
}: {
  state: CalState
  weekDays: number
  weekStart: WeekStart
  tz: Zone
  onTask: (t: Task) => void
}) {
  const qc = useQueryClient()
  const agenda = state.view === 'agenda'
  const range = viewRange(agenda ? 'week' : state.view, state.date, weekDays, weekStart)
  // Instants to load: the visible days' midnights in the display zone (one request).
  const span = fetchRange(range, tz)
  const events = useQuery(eventsQuery(span.start, span.end))

  // Disabled calendars whose events someone asked to see ("Show events"): one request each, only then.
  const [peekCals, setPeekCals] = useState<number[]>([])
  const togglePeek = useCallback((id: number) => setPeekCals((l) => (l.includes(id) ? l.filter((x) => x !== id) : [...l, id])), [])
  const peeked = useQueries({ queries: peekCals.map((id) => calendarEventsQuery(span.start, span.end, id)), combine: ghosts })
  const allEvents = useMemo(() => {
    const base = events.data ?? []
    const extra = peeked.filter((e) => peekCals.includes(e.calendar_id))
    return extra.length ? [...base, ...extra] : base
  }, [events.data, peeked, peekCals])
  const byDay = useMemo(() => eventsByDay(allEvents, tz), [allEvents, tz])

  const [showTasks, setShowTasks] = useShowTasks()
  const [showBirthdays, setShowBirthdays] = useShowBirthdays()
  const photos = usePhotoCounts(range.days).data
  const tasks = useRangeTasks(span.start, span.end, showTasks && !agenda, tz)
  const birthdays = useBirthdays(range.days, showBirthdays && !agenda)
  const layers: Layers = useMemo(() => ({ tasks: tasks.byDay, birthdays, photos, onTask }), [tasks.byDay, birthdays, photos, onTask])

  // When the browser is idle, warm the next range's events (one request, cached 2 min).
  const nextKey = agenda ? '' : dayKey(stepDate(state.view, state.date, 1, weekDays))
  useEffect(() => {
    if (!nextKey || !events.isSuccess) return
    const next = viewRange(state.view, parseDayKey(nextKey), weekDays, weekStart)
    const run = () => {
      const r = fetchRange(next, tz)
      qc.prefetchQuery(eventsQuery(r.start, r.end))
    }
    if (window.requestIdleCallback) {
      const id = window.requestIdleCallback(run, { timeout: 4000 })
      return () => window.cancelIdleCallback(id)
    }
    const t = setTimeout(run, 1500)
    return () => clearTimeout(t)
  }, [nextKey, events.isSuccess, state.view, weekDays, weekStart, tz, qc])

  return {
    range,
    events,
    allEvents,
    byDay,
    layers,
    fetching: events.isFetching || tasks.isFetching,
    peek: { ids: peekCals, toggle: togglePeek },
    toggles: { showTasks, setShowTasks, showBirthdays, setShowBirthdays },
  }
}
