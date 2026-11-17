// The Tasks page's state lives in the URL, so every list, filter and layout can be linked and survives a
// reload. lib/qs.ts parses the list part (view/project/saved, list/board/table, sort, search, open task);
// this hook adds the page-only keys (label, prio, assignee, done, group, and layout=timeline|calendar),
// the per-list layout memory and the setters the page uses.
import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router'
import { nextTaskState, parseTaskState, serializeTaskState, type Sort, type SmartView, type TaskState } from '../../lib/qs'
import { readPref, writePref } from '../../lib/storage'
import type { Overview, Project } from '../../lib/types'

export type LayoutName = 'list' | 'board' | 'table' | 'calendar' | 'timeline'
export type Grouping = 'auto' | 'due' | 'priority' | 'project' | 'none'
type Alt = 'timeline' | 'calendar' | null
export type PageChange = Partial<TaskState> & { alt?: Alt }

/** Page-only URL keys, kept while moving around inside one list (dropped when switching lists). */
const EXTRA_KEYS = ['label', 'prio', 'group', 'assignee', 'done'] as const
type ExtraKey = (typeof EXTRA_KEYS)[number] | 'sort'
const GROUPINGS: readonly Grouping[] = ['due', 'priority', 'project', 'none']

const layoutKey = (s: Pick<TaskState, 'project' | 'saved' | 'view'>) =>
  `app.tasks.layout.${s.project ?? (s.saved ? `saved:${s.saved}` : `view:${s.view}`)}`

export function useTasksUrl(projects: Project[] | undefined, overview: Overview | undefined) {
  const [search, setSearch] = useSearchParams()
  const state = useMemo(() => parseTaskState(search), [search])
  const altRaw = search.get('layout')
  const alt: Alt = altRaw === 'timeline' || altRaw === 'calendar' ? altRaw : null
  const group = search.get('group') as Grouping | null

  const update = useCallback(
    (change: PageChange, replace = false) => {
      const { alt: altChange, ...rest } = change
      const switching = 'view' in rest || 'project' in rest || 'saved' in rest
      let nextState = nextTaskState(state, rest)
      let nextAlt: Alt = altChange !== undefined ? altChange : !switching && !('layout' in rest) ? alt : null
      if (switching && !('layout' in rest) && altChange === undefined) {
        // A list opens in the layout last used there (projects: else their default view).
        const p = nextState.project ? projects?.find((x) => x.id === nextState.project) : undefined
        const L = (readPref<string>(layoutKey(nextState), '') || p?.default_view || 'list') as LayoutName
        if (L === 'calendar' || L === 'timeline') nextAlt = L
        else if (L !== 'list') nextState = nextTaskState(nextState, { layout: L })
      }
      const next = new URLSearchParams(serializeTaskState(nextState))
      if (!switching)
        for (const k of EXTRA_KEYS) {
          const v = search.get(k)
          if (v && !next.has(k)) next.set(k, v)
        }
      if (nextAlt) next.set('layout', nextAlt)
      setSearch(next, { replace })
    },
    [state, search, alt, projects, setSearch],
  )

  /** Set or clear page-only keys (and sort) without a new history entry. */
  const setKeys = useCallback(
    (change: Partial<Record<ExtraKey | 'q', string | null>>) =>
      setSearch(
        (p) => {
          const n = new URLSearchParams(p)
          for (const [k, v] of Object.entries(change)) {
            if (v) n.set(k, v)
            else n.delete(k)
          }
          return n
        },
        { replace: true },
      ),
    [setSearch],
  )

  const isBoard = state.layout === 'board' && !!state.project && !alt
  const isTable = state.layout === 'table' && !alt
  const layout: LayoutName = isBoard ? 'board' : isTable ? 'table' : (alt ?? 'list')
  const labelFilter = search.get('label') ?? ''

  return {
    state,
    layout,
    labelFilter,
    labelIds: labelFilter.split(',').filter(Boolean),
    prioMin: Number(search.get('prio')) || 0,
    assignee: search.get('assignee') ?? '',
    showCompleted: search.get('done') === '1',
    grouping: (group && GROUPINGS.includes(group) ? group : 'auto') as Grouping,
    /** A sort picked on this page (it overrides a saved view's own sort). */
    sortChosen: search.has('sort'),
    update,
    setKeys,
    /** Replace the whole URL (a label's list, a saved view as saved). */
    reset: (params: Record<string, string>) => setSearch(new URLSearchParams(params)),
    setSort: (s: Sort | null) => setKeys({ sort: s }),
    clearFilters: () => setKeys({ label: null, prio: null, assignee: null, q: null }),
    setLayout: (L: LayoutName) => {
      writePref(layoutKey(state), L)
      if (L === 'calendar' || L === 'timeline') update({ layout: 'list', alt: L })
      else update({ layout: L, alt: null })
    },
    goView: (v: SmartView) =>
      v === 'inbox' && overview ? update({ project: overview.inbox_id, task: null }) : update({ view: v, task: null }),
  }
}

export type TasksUrl = ReturnType<typeof useTasksUrl>
