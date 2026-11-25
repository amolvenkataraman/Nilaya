// Per-account preferences: GET /me carries them with every default filled in (users/preferences.py), PATCH
// /me/preferences changes some. Every app reads one object from the cached /me, so a change shows everywhere at
// once; DEFAULT_PREFS covers the moment before /me arrives (and signed-out pages).
import { type QueryClient, useMutation, useQueryClient } from '@tanstack/react-query'
import { patch } from './api'
import { addDays, dayKey } from './dates'
import { DEFAULT_DISPLAY, setDisplayPrefs } from './display'
import { keys, useMe } from './queries'
import type { Me, Schemas } from './types'

export type Preferences = Schemas['Preferences']
export type PreferencesPatch = Schemas['PreferencesPatch']
export type WeekStart = Preferences['week_start']

// Mirrors the server's defaults: Sunday weeks, days that begin at 5 am (late nights count as the day before).
export const DEFAULT_PREFS: Preferences = {
  week_start: 0,
  day_starts_at: '05:00:00',
  ...DEFAULT_DISPLAY,
  work_days: [1, 2, 3, 4, 5],
  work_start: '09:00:00',
  work_end: '17:00:00',
  quiet_hours: { enabled: false, start: '22:00:00', end: '07:00:00' },
}

export function usePreferences(): Preferences {
  return useMe().data?.preferences ?? DEFAULT_PREFS
}

/** Keeps the formatters' copy of time, date and distance formats (lib/display) in step with /me: from the cache a
 *  reload restored, then on every change to /me's data (a fetch, or useSavePreferences' optimistic write), before
 *  React re-renders with it. Signed out, /me never loads and the browser's formats stay. */
export function followDisplayPrefs(qc: QueryClient): void {
  const apply = () => {
    const p = qc.getQueryData<Me>(keys.me)?.preferences
    if (p) setDisplayPrefs(p)
  }
  apply()
  qc.getQueryCache().subscribe((e) => {
    if (e.type === 'updated' && e.query.queryKey.length === 1 && e.query.queryKey[0] === keys.me[0]) apply()
  })
}

/** Saves at once and shows the change before the server answers; a refusal puts the old values back. */
export function useSavePreferences() {
  const qc = useQueryClient()
  const setPrefs = (fn: (p: Preferences) => Preferences) =>
    qc.setQueryData<Me>(keys.me, (me) => (me ? { ...me, preferences: fn(me.preferences) } : me))
  return useMutation({
    mutationFn: (body: PreferencesPatch) => patch<Preferences>('me/preferences', body),
    onMutate: async (body) => {
      await qc.cancelQueries({ queryKey: keys.me })
      const before = qc.getQueryData<Me>(keys.me)?.preferences
      setPrefs((p) => ({ ...p, ...stripNulls(body) }))
      return { before }
    },
    onError: (_e, _body, ctx) => {
      const before = ctx?.before
      if (before) setPrefs(() => before)
    },
    onSuccess: (prefs) => setPrefs(() => prefs),
  })
}

// A null in a patch means "back to the default", which only the server's answer knows for sure; meanwhile keep the
// old value rather than show a blank.
function stripNulls(body: PreferencesPatch): Partial<Preferences> {
  return Object.fromEntries(Object.entries(body).filter(([, v]) => v != null)) as Partial<Preferences>
}

/** "05:00:00" → minutes after midnight (300). */
export const clockMinutes = (t: string) => {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + (m || 0)
}

// ---------------------------------------------------------------- the user's day (photos and habits)
// A day begins at day_starts_at (5 am by default), so a 1:30 am photo or check-in belongs to the evening before.
// Same rule as the server (users/preferences.py local_day): the local clock time, less the day start. Calendar,
// tasks and event times keep midnight days.

/** Minutes after midnight the user's day begins (300 for 5 am). */
export const useDayStart = () => clockMinutes(usePreferences().day_starts_at)

/** The day `at` belongs to, as that day's local midnight. */
export function userDay(at: Date | string, dayStartMin: number): Date {
  const d = new Date(at)
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  return d.getHours() * 60 + d.getMinutes() < dayStartMin ? addDays(day, -1) : day
}

/** userDay as YYYY-MM-DD: the key photo day sections, /photos/days and habit entries use. */
export const userDayKey = (at: Date | string, dayStartMin: number) => dayKey(userDay(at, dayStartMin))

/** When `day` begins: its local midnight plus the day start (a day page's photos run to the next one's). */
export const userDayStart = (day: Date, dayStartMin: number) => new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, dayStartMin)
