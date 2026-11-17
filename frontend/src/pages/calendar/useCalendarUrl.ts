// The calendar's state in the URL, so views, dates, an open event or task and insights survive reloads and
// can be linked: ?view=&date=&insights=&event=&task=&new=1. Every change is one setParams call, so two changes
// in one handler never overwrite each other.
import { useCallback } from 'react'
import { useSearchParams } from 'react-router'
import { dayKey, isSameDay } from '../../lib/dates'
import type { CalEvent, Task } from '../../lib/types'
import { eventDayKey, parseCalState, type CalView, type InsightsPeriod } from './range'
import { zoneDay, type Zone } from './zone'

export interface CalChange {
  view?: CalView
  date?: Date
  insights?: InsightsPeriod | null
}

export function useCalendarUrl(tz: Zone, today: Date) {
  const [params, setParams] = useSearchParams()
  const state = parseCalState(params, today)
  const edit = useCallback(
    (fn: (p: URLSearchParams) => void, replace = true) =>
      setParams(
        (p) => {
          const next = new URLSearchParams(p)
          fn(next)
          return next
        },
        { replace },
      ),
    [setParams],
  )
  const update = useCallback(
    (change: CalChange) =>
      edit((next) => {
        next.delete('new')
        if (change.view) change.view === 'month' ? next.delete('view') : next.set('view', change.view)
        if (change.date) isSameDay(change.date, zoneDay(Date.now(), tz)) ? next.delete('date') : next.set('date', dayKey(change.date))
        if (change.insights !== undefined) change.insights ? next.set('insights', change.insights) : next.delete('insights')
      }),
    [edit, tz],
  )
  return {
    state,
    update,
    eventId: params.get('event'),
    taskId: params.get('task'),
    setEvent: (id: string | null) => edit((n) => (id ? n.set('event', id) : n.delete('event'))),
    /** Jump to an event's day and open it (from search). */
    showEvent: (e: CalEvent) =>
      edit((n) => {
        n.set('date', eventDayKey(e, tz))
        n.set('event', e.id)
        n.delete('new')
      }),
    openTask: (t: Pick<Task, 'id'>) => edit((n) => n.set('task', t.id), false),
    closeTask: () => edit((n) => n.delete('task')),
  }
}
