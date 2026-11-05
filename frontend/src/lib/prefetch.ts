// Start the dashboard's requests while its code chunk is still downloading, so data and code
// arrive together. Keys and params match the hooks in lib/queries.ts exactly.
import type { QueryClient } from '@tanstack/react-query'
import { get } from './api'
import { dayKey } from './dates'
import { photoAlbumsQuery, photoHiddenModeQuery, photoLibrariesQuery, photoSummaryQuery } from './photoQueries'
import { DASH_AGENDA_DAYS, DASH_TODAY_PARAMS, fetchOverview, keys } from './queries'

export function prefetchDashboard(qc: QueryClient) {
  const p = (queryKey: readonly unknown[], fn: () => Promise<unknown>) => qc.prefetchQuery({ queryKey, queryFn: fn })
  p(keys.me, () => get('me'))
  p(keys.overview, () => fetchOverview(qc)) // also seeds projects, labels and views
  p([...keys.agenda(DASH_AGENDA_DAYS), false], () => get('calendar/agenda', { days: DASH_AGENDA_DAYS }))
  p(keys.taskList(DASH_TODAY_PARAMS), () => get('tasks/', DASH_TODAY_PARAMS))
  const today = dayKey(new Date())
  p(keys.insights('week', today), () => get('calendar/insights', { period: 'week', date: today }))
  p(keys.notifCount, () => get('notifications/unread-count'))
}

/** Every page: the shell's own data (account, unread badge), started before any page chunk arrives. */
export function prefetchShell(qc: QueryClient) {
  qc.prefetchQuery({ queryKey: keys.me, queryFn: () => get('me') })
  qc.prefetchQuery({ queryKey: keys.notifCount, queryFn: () => get('notifications/unread-count') })
}

/** Route loaders: a page's first requests start in parallel with its code chunk (same keys as its hooks). */
export function prefetchTasks(qc: QueryClient) {
  qc.prefetchQuery({ queryKey: keys.overview, queryFn: () => fetchOverview(qc) })
}
export function prefetchCalendar(qc: QueryClient) {
  qc.prefetchQuery({ queryKey: keys.calendars, queryFn: () => get('calendar/calendars', {}), staleTime: 5 * 60_000 })
}
export function prefetchPhotos(qc: QueryClient) {
  // Same tick: one GET /photos/sidebar serves all four.
  for (const q of [photoSummaryQuery(), photoAlbumsQuery(), photoLibrariesQuery(), photoHiddenModeQuery()]) qc.prefetchQuery(q)
}
