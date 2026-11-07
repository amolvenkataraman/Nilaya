// Query-string state for the Tasks page: /tasks?view=today&layout=board&task=<id>
// Defaults are left out of the URL so links stay short and stable.

export const SMART_VIEWS = ['inbox', 'today', 'upcoming', 'overdue', 'nodate', 'favorites', 'assigned', 'done', 'all'] as const
export type SmartView = (typeof SMART_VIEWS)[number]
export const SORTS = ['position', 'due', 'priority', 'created', 'updated', 'title'] as const
export type Sort = (typeof SORTS)[number]
export type Layout = 'list' | 'board' | 'table'

export interface TaskState {
  view: SmartView | null // null when a project or saved view is selected
  project: string | null
  saved: string | null
  layout: Layout
  sort: Sort
  q: string
  task: string | null // open detail drawer
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const uuidOrNull = (v: string | null) => (v && UUID_RE.test(v) ? v.toLowerCase() : null)

export const DEFAULT_VIEW: SmartView = 'today'

export function parseTaskState(search: string | URLSearchParams): TaskState {
  const p = typeof search === 'string' ? new URLSearchParams(search) : search
  const project = uuidOrNull(p.get('project'))
  const saved = project ? null : uuidOrNull(p.get('saved'))
  const rawView = p.get('view') as SmartView | null
  const view = project || saved ? null : rawView && SMART_VIEWS.includes(rawView) ? rawView : DEFAULT_VIEW
  const rawSort = p.get('sort') as Sort | null
  return {
    view,
    project,
    saved,
    layout: p.get('layout') === 'board' && project ? 'board' : p.get('layout') === 'table' ? 'table' : 'list',
    sort: rawSort && SORTS.includes(rawSort) ? rawSort : view && view !== 'inbox' && view !== 'all' ? 'due' : 'position',
    q: (p.get('q') ?? '').slice(0, 200),
    task: uuidOrNull(p.get('task')),
  }
}

export function serializeTaskState(s: Partial<TaskState>): string {
  const p = new URLSearchParams()
  if (s.project) p.set('project', s.project)
  else if (s.saved) p.set('saved', s.saved)
  else if (s.view && s.view !== DEFAULT_VIEW) p.set('view', s.view)
  if (s.layout === 'board' && s.project) p.set('layout', 'board')
  else if (s.layout === 'table') p.set('layout', 'table')
  const defaultSort = s.view && s.view !== 'inbox' && s.view !== 'all' ? 'due' : 'position'
  if (s.sort && s.sort !== defaultSort) p.set('sort', s.sort)
  if (s.q) p.set('q', s.q)
  if (s.task) p.set('task', s.task)
  const out = p.toString()
  return out ? '?' + out : ''
}

/** Merge a change into the current state; switching list (view/project/saved) resets layout-only bits. */
export function nextTaskState(cur: TaskState, change: Partial<TaskState>): TaskState {
  const switching = 'view' in change || 'project' in change || 'saved' in change
  const base: Partial<TaskState> = switching
    ? { view: null, project: null, saved: null, layout: 'list', q: '', task: cur.task } // sort falls back to the list's default
    : cur
  const merged = { ...base, ...change }
  return parseTaskState(serializeTaskState(merged))
}
