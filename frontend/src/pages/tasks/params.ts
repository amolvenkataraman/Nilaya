// The server queries behind a Tasks list: the list's own params (a smart view, a project, a saved view),
// the page's extra filters on top, and the variants the other layouts and the "Completed" section need.
// Pure, so the page can memoise them by value and the cache keys stay stable.
import type { TaskQuery } from '../../lib/queries'
import type { TaskState } from '../../lib/qs'
import type { Overview, SavedView } from '../../lib/types'

/** Rows per page of a list (later pages load as you scroll). */
export const PAGE = 100
/** The timeline follows up to this many pages of 500 rows. */
export const TIMELINE_PAGES = 4

/** The list's query, or null while what it needs (the overview's inbox id, the saved view) loads.
 *  A project's list holds its open tasks; done ones are a separate, paged query. */
export function listParams(
  s: TaskState,
  overview: Overview | undefined,
  saved: SavedView | undefined,
  sortChosen = false,
): TaskQuery | null {
  const base: TaskQuery = { sort: s.sort, q: s.q || undefined, limit: PAGE }
  if (s.project) return { ...base, project: s.project, done: false }
  if (s.saved)
    return saved
      ? {
          ...base,
          ...saved.filters,
          limit: PAGE,
          q: s.q || (saved.filters.q as string | undefined),
          sort: sortChosen ? s.sort : (saved.filters.sort ?? s.sort),
        }
      : null
  switch (s.view) {
    case 'inbox':
      return overview ? { ...base, project: overview.inbox_id, done: false } : null
    // Manual order means nothing across projects (the Sort menu doesn't offer it here): page by due date,
    // so the date sections fill in order as you scroll.
    case 'all':
      return { ...base, sort: s.sort === 'position' ? 'due' : s.sort, done: false }
    case 'done':
      return { ...base, view: 'done', sort: 'done' }
    default:
      return { ...base, view: s.view ?? 'today' }
  }
}

export interface ExtraFilters {
  label: string
  prio: number
  assignee: string
}

/** Extra filters on top of a list (a saved view's own label/priority/assignee filters are kept). */
export function withFilters(p: TaskQuery, f: ExtraFilters): TaskQuery {
  const out = { ...p }
  if (f.label) out.label = [p.label, f.label].filter(Boolean).join(',')
  if (f.prio) out.priority_min = f.prio
  if (f.assignee) out.assignee = f.assignee
  return out
}

/** The timeline's query: every row of the list in big pages, with a project's done tasks too (the list
 *  keeps those in their own section). */
export function timelineParams(p: TaskQuery): TaskQuery {
  const o: TaskQuery = { ...p, limit: 500 }
  if (o.project && o.done === false) delete o.done
  return o
}

/** The "Completed" section under a list: the same filters, done tasks, newest first. Favourites and
 *  "assigned to me" stay views; date views don't apply to done tasks. */
export function completedParams(p: TaskQuery): TaskQuery {
  const o: TaskQuery = { ...p, done: true, sort: 'done' }
  if (o.view !== 'favorites' && o.view !== 'assigned') delete o.view
  return o
}
