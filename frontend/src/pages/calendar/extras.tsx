// Calendar extras: photo counts per day and (optionally) open tasks with a due date in range.
import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Icon } from '../../components/Icon'
import { TaskCheck } from '../../components/TaskRow'
import { get } from '../../lib/api'
import { dayKey, fmtDate, fmtTime, isEndOfDay } from '../../lib/dates'
import { useSetDone, useTasks } from '../../lib/queries'
import type { Task } from '../../lib/types'
import { CACHE_PREFIX, ownerId } from '../../lib/owner'

/** {"2026-11-05": 12, ...} for the visible days, in the user's time zone. */
export function usePhotoCounts(days: Date[]) {
  const start = dayKey(days[0])
  const end = dayKey(days[days.length - 1])
  return useQuery({
    queryKey: ['photos', 'counts', start, end],
    queryFn: ({ signal }) => get<Record<string, number>>('photos/counts', { start, end }, signal),
    staleTime: 10 * 60_000,
    placeholderData: keepPreviousData,
  })
}

const SHOW_TASKS = 'app.calendar.showTasks'
export function useShowTasks(): [boolean, (v: boolean) => void] {
  const [on, setOn] = useState(() => {
    try {
      return localStorage.getItem(SHOW_TASKS) === '1'
    } catch {
      return false
    }
  })
  const set = (v: boolean) => {
    setOn(v)
    try {
      localStorage.setItem(SHOW_TASKS, v ? '1' : '0')
    } catch { /* per-page only */ }
  }
  return [on, set]
}

/** Open tasks due in [start, end), grouped by local day. 23:59 ("date only") tasks go in the all-day lane. */
export function useRangeTasks(start: Date, end: Date, enabled: boolean) {
  const q = useTasks({ due_after: start.toISOString(), due_before: end.toISOString(), done: false, sort: 'due', limit: 500 }, enabled)
  const byDay = new Map<string, Task[]>()
  if (enabled) {
    for (const t of q.data?.items ?? []) {
      if (!t.due) continue
      const k = dayKey(new Date(t.due))
      byDay.set(k, [...(byDay.get(k) ?? []), t])
    }
  }
  return { byDay, isFetching: enabled && q.isFetching }
}

export const isAllDayTask = (t: Task) => !t.due || isEndOfDay(new Date(t.due))

export function TaskChip({ task, onOpen, big }: { task: Task; onOpen: (t: Task) => void; big?: boolean }) {
  const setDone = useSetDone()
  const timed = !isAllDayTask(task)
  const label = `Task: ${task.title}${timed ? `, due ${fmtTime(new Date(task.due!))}` : ''}`
  return (
    <div className={'chip-task' + (big ? ' big' : '') + (task.done ? ' done' : '')} title={label} onClick={(e) => e.stopPropagation()}>
      <TaskCheck task={task} onToggle={() => setDone.mutate({ task, done: !task.done })} />
      {timed && <span className="chip-time tabular">{fmtTime(new Date(task.due!)).replace(/:00(?=\s|$)/, '').replace(/\s/g, '').toLowerCase()}</span>}
      <button type="button" className="chip-task-title truncate" onClick={() => onOpen(task)} aria-label={`Open ${label}`}>{task.title}</button>
    </div>
  )
}

export function PhotoBadge({ day, count }: { day: Date; count?: number }) {
  if (!count) return null
  const label = `${count} photo${count === 1 ? '' : 's'} on ${fmtDate(day, { weekday: 'long', month: 'long', day: 'numeric' })}`
  return (
    <Link to={`/photos?date=${dayKey(day)}`} className="photo-badge tabular" title={label} aria-label={label} onClick={(e) => e.stopPropagation()}>
      <Icon name="photo" size={11} />{count > 999 ? '999+' : count}
    </Link>
  )
}

// ---------------------------------------------------------------- birthdays (Contacts)
export interface Birthday { id: string; name: string; date: string; age: number | null }
const SHOW_BDAYS = 'app.calendar.showBirthdays'
// A cache of server data: per user, and wiped when another user signs in here (lib/owner.ts).
const BDAY_CACHE = CACHE_PREFIX + 'birthdays'
const DAY = 86_400_000

export function useShowBirthdays(): [boolean, (v: boolean) => void] {
  const [on, setOn] = useState(() => {
    try {
      return localStorage.getItem(SHOW_BDAYS) !== '0' // on by default
    } catch {
      return true
    }
  })
  return [on, (v) => {
    setOn(v)
    try { localStorage.setItem(SHOW_BDAYS, v ? '1' : '0') } catch { /* ignore */ }
  }]
}

type BdayCache = Record<string, { at: number; items: Birthday[] }>
const bdayKey = () => (ownerId() ? `${BDAY_CACHE}.${ownerId()}` : null)
function readBdays(): BdayCache {
  const k = bdayKey()
  try { return k ? JSON.parse(localStorage.getItem(k) || '{}') as BdayCache : {} } catch { return {} }
}

/** Birthdays in the visible range: fresh for a day, kept in localStorage so revisits cost no request. */
export function useBirthdays(days: Date[], enabled: boolean) {
  const start = dayKey(days[0])
  const end = dayKey(days[days.length - 1])
  const key = `${start}/${end}`
  const cached = readBdays()[key]
  const q = useQuery({
    queryKey: ['contacts', 'birthdays', start, end],
    queryFn: async ({ signal }) => {
      const items = await get<Birthday[]>('contacts/birthdays', { start, end }, signal)
      try {
        const all = readBdays()
        all[key] = { at: Date.now(), items }
        const keep = Object.entries(all).sort((a, b) => b[1].at - a[1].at).slice(0, 12)
        const k = bdayKey()
        if (k) localStorage.setItem(k, JSON.stringify(Object.fromEntries(keep)))
      } catch { /* ignore */ }
      return items
    },
    enabled,
    staleTime: DAY,
    initialData: cached?.items,
    initialDataUpdatedAt: cached?.at,
    placeholderData: keepPreviousData,
  })
  const byDay = new Map<string, Birthday[]>()
  if (enabled) for (const b of q.data ?? []) byDay.set(b.date, [...(byDay.get(b.date) ?? []), b])
  return byDay
}

export function BirthdayChip({ b, big }: { b: Birthday; big?: boolean }) {
  const navigate = useNavigate()
  const first = b.name.split(/\s+/)[0] || b.name
  const text = b.age ? `${first} turns ${b.age}` : `${first}'s birthday`
  return (
    <button type="button" className={'chip-bday' + (big ? ' big' : '')} title={`${b.name}${b.age ? ` turns ${b.age}` : ''}: open contact`}
      onClick={(e) => (e.stopPropagation(), navigate(`/contacts?person=${b.id}`))}>
      <Icon name="gift" size={12} /><span className="truncate">{text}</span>
    </button>
  )
}
