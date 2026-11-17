// Home's view of the 7-day agenda: what's on today (events covering today, all-day items, ongoing multi-day
// events), how many timed items are left, the next start within two hours, and what comes after today.
// Tasks (kind 'todo') are left out: the Tasks card shows them.
import { useMemo } from 'react'
import { addDays, coversDay, isSameDay, placedStart, startOfDay } from '../../lib/dates'
import { DASH_AGENDA_DAYS, useAgenda } from '../../lib/queries'
import type { AgendaItem } from '../../lib/types'

export function splitAgenda(items: AgendaItem[], now: Date) {
  const notTodo = items.filter((i) => i.kind !== 'todo')
  const today = notTodo.filter((i) =>
    i.kind === 'all_day' && i.start_date
      ? coversDay(i, now)
      : !i.start || isSameDay(new Date(i.start), now) || (!!i.end && new Date(i.end) > now && new Date(i.start) < now),
  )
  const tomorrow = startOfDay(addDays(now, 1))
  return {
    today,
    /** Timed items today that haven't ended. */
    left: today.filter((i) => i.kind !== 'all_day' && i.start && new Date(i.end ?? i.start) > now).length,
    /** The next timed start within two hours. */
    soon: notTodo.find(
      (i) => i.kind !== 'all_day' && i.start && new Date(i.start) > now && new Date(i.start).getTime() - now.getTime() < 2 * 3600_000,
    ),
    later: notTodo.filter((i) => i.start && new Date(placedStart(i) as string) >= tomorrow),
  }
}

export function useTodayAgenda(now: Date) {
  const agenda = useAgenda(DASH_AGENDA_DAYS)
  const split = useMemo(() => (agenda.data ? splitAgenda(agenda.data, now) : null), [agenda.data, now])
  return { agenda, split }
}
