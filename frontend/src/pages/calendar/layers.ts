// What the calendar draws besides events, each from its own app: photo counts per day (Photos), open tasks
// with a due date (Tasks) and birthdays (Contacts). Tasks and birthdays can be switched off (per device).
import { useMemo } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { get } from '../../lib/api'
import { dayKey, isEndOfDay } from '../../lib/dates'
import { CACHE_PREFIX, ownerId } from '../../lib/owner'
import { useTasks } from '../../lib/queries'
import { readPref, usePref, writePref } from '../../lib/storage'
import type { Task } from '../../lib/types'
import type { Birthday } from './types'
import { zoneDayKey, type Zone } from './zone'

const DAY_MS = 86_400_000
const rangeOf = (days: Date[]) => ({ start: dayKey(days[0]), end: dayKey(days[days.length - 1]) })

/** {"2026-11-05": 12, ...} for the visible days, in the user's time zone. */
export function usePhotoCounts(days: Date[]) {
  const { start, end } = rangeOf(days)
  return useQuery({
    queryKey: ['photos', 'counts', start, end],
    queryFn: ({ signal }) => get<Record<string, number>>('photos/counts', { start, end }, signal),
    staleTime: 10 * 60_000,
    placeholderData: keepPreviousData,
  })
}

export const useShowTasks = () => usePref<boolean>('app.calendar.showTasks', false)
export const useShowBirthdays = () => usePref<boolean>('app.calendar.showBirthdays', true)

export const isAllDayTask = (t: Task) => !t.due || isEndOfDay(new Date(t.due))

/** Open tasks due in [start, end) (ISO instants), grouped by day. 23:59 ("date only") tasks go in the
 *  all-day lane on their own date; timed ones on their date in the display zone. */
export function useRangeTasks(start: string, end: string, enabled: boolean, tz?: Zone) {
  const q = useTasks({ due_after: start, due_before: end, done: false, sort: 'due', limit: 500 }, enabled)
  const items = enabled ? q.data?.items : undefined
  const byDay = useMemo(() => {
    const map = new Map<string, Task[]>()
    for (const t of items ?? []) {
      if (!t.due) continue
      const k = isAllDayTask(t) ? dayKey(new Date(t.due)) : zoneDayKey(new Date(t.due).getTime(), tz)
      map.set(k, [...(map.get(k) ?? []), t])
    }
    return map
  }, [items, tz])
  return { byDay, isFetching: enabled && q.isFetching }
}

// A cache of server data: per user, and wiped when another user signs in here (lib/owner.ts).
type BdayCache = Record<string, { at: number; items: Birthday[] }>
const bdayKey = () => (ownerId() ? `${CACHE_PREFIX}birthdays.${ownerId()}` : null)
const readBdays = (): BdayCache => {
  const k = bdayKey()
  return k ? readPref<BdayCache>(k, {}) : {}
}

/** Birthdays in the visible range by date: fresh for a day, kept in localStorage so revisits cost no request. */
export function useBirthdays(days: Date[], enabled: boolean) {
  const { start, end } = rangeOf(days)
  const range = `${start}/${end}`
  const cached = readBdays()[range]
  const q = useQuery({
    queryKey: ['contacts', 'birthdays', start, end],
    queryFn: async ({ signal }) => {
      const items = await get<Birthday[]>('contacts/birthdays', { start, end }, signal)
      const k = bdayKey()
      if (k) {
        const all = { ...readBdays(), [range]: { at: Date.now(), items } }
        const keep = Object.entries(all)
          .sort((a, b) => b[1].at - a[1].at)
          .slice(0, 12)
        writePref(k, Object.fromEntries(keep))
      }
      return items
    },
    enabled,
    staleTime: DAY_MS,
    initialData: cached?.items,
    initialDataUpdatedAt: cached?.at,
    placeholderData: keepPreviousData,
  })
  const list = enabled ? q.data : undefined
  return useMemo(() => {
    const byDay = new Map<string, Birthday[]>()
    for (const b of list ?? []) byDay.set(b.date, [...(byDay.get(b.date) ?? []), b])
    return byDay
  }, [list])
}
