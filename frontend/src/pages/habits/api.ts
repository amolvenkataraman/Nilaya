// /api/v2/habits/ types and hooks (query keys under ['habits']).
import { useMutation, useQuery, useQueryClient, keepPreviousData, type QueryClient } from '@tanstack/react-query'
import { del, get, patch, post, api } from '../../lib/api'
import { toast } from '../../components/toast'

export type Kind = 'yesno' | 'measurable'
export type Goal = 'at_least' | 'at_most'
export type Period = 'day' | 'week' | 'month'
export type Schedule = 'daily' | 'weekdays' | 'interval'

export interface Habit {
  id: string; name: string; description: string; colour: string; icon: string; position: number; archived: boolean
  paused: boolean; start_date: string; end_date: string | null; kind: Kind; unit: string; goal: Goal; target: number
  period: Period; schedule: Schedule; weekdays: number; interval: number; reminder_time: string | null
  reminder_days: number; created_on: string
}
export type HabitInput = Partial<Omit<Habit, 'id' | 'position' | 'created_on' | 'start_date'>> & { name?: string; start_date?: string | null }
export interface TodayRow {
  habit: Habit; due: boolean; done: boolean; over: boolean; value: number; skipped: boolean; note: string
  period_value: number; period_required: number; streak: number; streak_unit: Period
}
export interface Today { date: string; done: number; total: number; left: number; over: number; habits: TodayRow[] }
export interface Entry { habit_id: string; date: string; value: number; note: string; skipped: boolean }
export interface Streak { habit_id: string; name: string; colour: string; current: number; best: number; unit: Period }
export interface Overview { date: string; done: number; total: number; left: number; over: number; week_rate: number | null; streaks: Streak[] }
export interface Stats {
  habit_id: string; today: string; streak_unit: Period; current_streak: number; best_streak: number; score: number
  rates: { d7: number | null; d30: number | null; d90: number | null; all: number | null }
  period_value: number; period_required: number
  score_trend: { date: string; score: number }[]
  heatmap: { start: string; end: string; levels: string; values: (number | null)[] }
  weekdays: { weekday: number; done: number; judged: number; rate: number | null; average: number | null }[]
  totals: { total: number; week: number; month: number; days: number; average: number | null; best: number | null }
  notes: { date: string; note: string; value: number; skipped: boolean }[]
}
export interface HabitSettings { evening_nudge: boolean; nudge_time: string }

export const hk = {
  all: ['habits'] as const,
  today: ['habits', 'today'] as const,
  overview: ['habits', 'overview'] as const,
  list: (archived: boolean) => ['habits', 'list', archived] as const,
  entries: (start: string, end: string) => ['habits', 'entries', start, end] as const,
  stats: (id: string) => ['habits', 'stats', id] as const,
  settings: ['habits', 'settings'] as const,
}

const onError = (e: unknown) => toast.error((e as Error).message)

export const useToday = () => useQuery({ queryKey: hk.today, queryFn: () => get<Today>('habits/today') })
export const useHabitsOverview = () => useQuery({ queryKey: hk.overview, queryFn: () => get<Overview>('habits/overview') })
export const useHabits = (archived = false) =>
  useQuery({ queryKey: hk.list(archived), queryFn: () => get<Habit[]>('habits/', { include_archived: archived || undefined }) })
export const useEntries = (start: string, end: string) =>
  useQuery({ queryKey: hk.entries(start, end), queryFn: () => get<Entry[]>('habits/entries', { start, end }), placeholderData: keepPreviousData })
export const useStats = (id: string | undefined) =>
  useQuery({ queryKey: hk.stats(id ?? ''), queryFn: () => get<Stats>(`habits/${id}/stats`), enabled: !!id })
export const useHabitSettings = () => useQuery({ queryKey: hk.settings, queryFn: () => get<HabitSettings>('habits/settings') })

/** Refresh everything derived from entries, except the query we just patched. */
function refreshDerived(qc: QueryClient) {
  qc.invalidateQueries({ queryKey: hk.all, predicate: (q) => q.queryKey[1] !== 'settings' })
}

/** Optimistically reflect a new day value in Today and in every cached entries range. */
function patchCaches(qc: QueryClient, habit: Habit, day: string, value: number | null, skipped = false) {
  const today = qc.getQueryData<Today>(hk.today)
  if (today && today.date === day) {
    qc.setQueryData<Today>(hk.today, {
      ...today,
      habits: today.habits.map((r) => {
        if (r.habit.id !== habit.id) return r
        const v = value ?? 0
        const periodValue = r.period_value - r.value + v
        const done = habit.goal === 'at_least' ? periodValue >= r.period_required : periodValue <= r.period_required
        return { ...r, value: v, skipped, period_value: periodValue, done, over: habit.goal === 'at_most' && periodValue > r.period_required }
      }),
    })
  }
  for (const [key, data] of qc.getQueriesData<Entry[]>({ queryKey: ['habits', 'entries'] })) {
    if (!data) continue
    const rest = data.filter((e) => !(e.habit_id === habit.id && e.date === day))
    qc.setQueryData<Entry[]>(key, value === null && !skipped ? rest : [...rest, { habit_id: habit.id, date: day, value: value ?? 0, note: '', skipped }])
  }
}

/** Tap a habit: toggle yes/no, or add `amount` to a measurable one. `date` defaults to the user's today. */
export function useCheck() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (v: { habit: Habit; amount?: number; done?: boolean; date?: string; current?: number }) =>
      post<TodayRow>(`habits/${v.habit.id}/check`, { amount: v.amount ?? null, done: v.done ?? null, date: v.date ?? null }),
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: hk.all })
      const snaps = qc.getQueriesData({ queryKey: hk.all })
      const today = qc.getQueryData<Today>(hk.today)
      const day = v.date ?? today?.date
      if (day) {
        const cur = v.current ?? today?.habits.find((r) => r.habit.id === v.habit.id)?.value ?? 0
        const next = v.habit.kind === 'yesno' ? (v.done ?? cur < 1) ? 1 : 0 : Math.max(0, cur + (v.amount ?? 1))
        patchCaches(qc, v.habit, day, next || null)
      }
      return { rollback: () => snaps.forEach(([k, d]) => qc.setQueryData(k, d)) }
    },
    onError: (e, _v, ctx) => (ctx?.rollback(), onError(e)),
    onSuccess: (row) => {
      qc.setQueryData<Today>(hk.today, (old) => old && old.date ? { ...old, habits: old.habits.map((r) => (r.habit.id === row.habit.id ? row : r)) } : old)
    },
    onSettled: () => refreshDerived(qc),
  })
}

/** Set a day's value / skip, or clear it (value null and not skipped). */
export function useSetEntry() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ habit, day, value, skipped, note }: { habit: Habit; day: string; value: number | null; skipped?: boolean; note?: string }) =>
      value === null && !skipped && !note
        ? del(`habits/entries/${habit.id}/${day}`)
        : api(`habits/entries/${habit.id}/${day}`, { method: 'PUT', body: { value: value ?? 0, skipped: !!skipped, ...(note !== undefined ? { note } : {}) } }),
    onMutate: async ({ habit, day, value, skipped }) => {
      await qc.cancelQueries({ queryKey: hk.all })
      const snaps = qc.getQueriesData({ queryKey: hk.all })
      patchCaches(qc, habit, day, value, !!skipped)
      return { rollback: () => snaps.forEach(([k, d]) => qc.setQueryData(k, d)) }
    },
    onError: (e, _v, ctx) => (ctx?.rollback(), onError(e)),
    onSettled: () => refreshDerived(qc),
  })
}

export function useSaveHabit() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id?: string; body: HabitInput }) => (id ? patch<Habit>(`habits/${id}`, body) : post<Habit>('habits/', body)),
    onSuccess: () => refreshDerived(qc),
    onError,
  })
}

export function useArchiveHabit() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, archived }: { id: string; archived: boolean }) => post<Habit>(`habits/${id}/archive`, { archived }),
    onSuccess: (h) => (refreshDerived(qc), toast.show(h.archived ? `Archived "${h.name}"` : `Restored "${h.name}"`)),
    onError,
  })
}

export function useDeleteHabit() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => del(`habits/${id}`),
    onSuccess: () => refreshDerived(qc),
    onError,
  })
}

export function useReorder() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (ids: string[]) => post<void>('habits/reorder', { ids }),
    onMutate: (ids) => {
      const order = new Map(ids.map((id, i) => [id, i]))
      qc.setQueryData<Habit[]>(hk.list(false), (old) => old && [...old].sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0)))
      qc.setQueryData<Today>(hk.today, (old) => old && { ...old, habits: [...old.habits].sort((a, b) => (order.get(a.habit.id) ?? 0) - (order.get(b.habit.id) ?? 0)) })
    },
    onError,
    onSettled: () => refreshDerived(qc),
  })
}

export function useSaveHabitSettings() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: Partial<HabitSettings>) => patch<HabitSettings>('habits/settings', body),
    onSuccess: (s) => qc.setQueryData(hk.settings, s),
    onError,
  })
}
