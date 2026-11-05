// Tasks: smart views, projects (tree), labels and saved views in the sidebar; list (grouped, nested
// subtasks, inline rename and subtask add), board, table, calendar and timeline layouts; natural-language
// quick add; a detail drawer (?task=<id>); bulk actions; the classic keyboard shortcuts and focus mode.
// URL holds the state (lib/qs.ts plus ?label/prio/assignee/group/done and layout=timeline|calendar, kept here).
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent, type ReactNode } from 'react'
import { useSearchParams } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { AppShell } from '../../components/AppShell'
import { Icon } from '../../components/Icon'
import { ErrorBox, Menu, MenuItem, SkeletonRows, useMediaQuery } from '../../components/ui'
import { Ring, TaskRow } from '../../components/TaskRow'
import { QuickAddInput } from '../../components/QuickAdd'
import { keys, useLabels, useMe, useOverview, useProjects, useSavedViews, useSetDone, useTasks, useUpdateTask, type TaskQuery } from '../../lib/queries'
import { toast } from '../../components/toast'
import { TaskTable } from './TaskTable'
import { nextTaskState, parseTaskState, serializeTaskState, type Sort, type TaskState, type SmartView } from '../../lib/qs'
import { groupByDay, groupByDue, fmtDate, isSameDay, addDays, dayKey, parseDayKey, startOfDay, weekdayName } from '../../lib/dates'
import { PRIORITIES, type Label, type Overview, type Project, type SavedView, type Task, type TaskPage } from '../../lib/types'
import { Board, boardParams } from './Board'
import { TaskDrawer } from './TaskDrawer'
import { ProjectDialog, ProjectMenu, SaveViewDialog, viewFilters } from './ProjectDialog'
import { ShareDialog } from './ProjectShare'
import { LabelDialog } from './Labels'
import { Timeline, TimelineIcon } from './Timeline'
import { Calendar } from './Calendar'
import { BulkBar } from './BulkBar'
import { TasksSidebar, VIEWS, ViewMenu } from './Sidebar'
import { ShortcutsDialog, useTaskKeys } from './Shortcuts'
import { useSelection, type Selection } from './selection'
import { plural, useBulkOps, useDeleteWithUndo, useHiddenTasks, useReorderTasks, useSaveView } from './api'
import { fitsList, nestTasks } from './util'
import './tasks.css'

const SORT_LABELS: Record<Sort, string> = { position: 'Manual', due: 'Due date', priority: 'Priority', created: 'Newest', updated: 'Recently updated', title: 'Title' }
/** Page-only URL keys, kept while moving around inside one list (dropped when switching lists). */
const EXTRA_KEYS = ['label', 'prio', 'group', 'assignee', 'done'] as const
type Alt = 'timeline' | 'calendar' | null
type LayoutName = 'list' | 'board' | 'table' | 'calendar' | 'timeline'
const PRIO_FILTERS: [number, string][] = [[0, 'Any priority'], [5, 'Low and up'], [10, 'Medium and up'], [15, 'High and up'], [20, 'Urgent']]
const GROUPS = [['auto', 'Automatic'], ['due', 'Due date'], ['priority', 'Priority'], ['project', 'Project'], ['none', 'No grouping']] as const
const GROUP_BTN = { auto: 'Group', due: 'By due', priority: 'By priority', project: 'By project', none: 'No groups' }
const COLLAPSED_TASKS = 'app.tasks.collapsedTasks'

export function listParams(s: TaskState, overview: Overview | undefined, saved: SavedView | undefined, sortChosen = false): TaskQuery | null {
  const base: TaskQuery = { sort: s.sort, q: s.q || undefined, limit: 500 }
  if (s.project) return { ...base, project: s.project }
  if (s.saved) return saved ? { ...base, ...saved.filters, q: s.q || (saved.filters.q as string | undefined), sort: sortChosen ? s.sort : saved.filters.sort ?? s.sort } : null
  switch (s.view) {
    case 'inbox': return overview ? { ...base, project: overview.inbox_id } : null
    case 'all': return { ...base, done: false }
    case 'done': return { ...base, view: 'done', sort: 'done', limit: 200 }
    default: return { ...base, view: s.view ?? 'today' }
  }
}

/** Extra filters on top of a list (a saved view's own label/priority/assignee filters are kept). */
export function withFilters(p: TaskQuery, f: { label: string; prio: number; assignee: string }): TaskQuery {
  const out = { ...p }
  if (f.label) out.label = [p.label, f.label].filter(Boolean).join(',')
  if (f.prio) out.priority_min = f.prio
  if (f.assignee) out.assignee = f.assignee
  return out
}

const layoutKey = (s: Pick<TaskState, 'project' | 'saved' | 'view'>) => 'app.tasks.layout.' + (s.project ?? (s.saved ? 'saved:' + s.saved : 'view:' + s.view))
const readLayout = (k: string): LayoutName | null => { try { return localStorage.getItem(k) as LayoutName | null } catch { return null } }
const readSet = (k: string) => { try { return new Set<string>(JSON.parse(localStorage.getItem(k) || '[]')) } catch { return new Set<string>() } }

type PageChange = Partial<TaskState> & { alt?: Alt }

export default function TasksPage() {
  const qc = useQueryClient()
  const [search, setSearch] = useSearchParams()
  const state = useMemo(() => parseTaskState(search), [search])
  const altRaw = search.get('layout')
  const alt: Alt = altRaw === 'timeline' || altRaw === 'calendar' ? altRaw : null
  const overview = useOverview().data
  const [showArchived, setShowArchived] = useState(() => { try { return localStorage.getItem('app.tasks.showArchived') === '1' } catch { return false } })
  const toggleArchived = () => setShowArchived((v) => { try { localStorage.setItem('app.tasks.showArchived', v ? '0' : '1') } catch { /* ignore */ } return !v })
  const projects = useProjects(showArchived).data
  const views = useSavedViews().data
  const labels = useLabels().data
  const me = useMe().data
  const hidden = useHiddenTasks()

  const update = useCallback((change: PageChange, replace = false) => {
    const { alt: altChange, ...rest } = change
    const switching = 'view' in rest || 'project' in rest || 'saved' in rest
    let nextState = nextTaskState(state, rest)
    let nextAlt: Alt = altChange !== undefined ? altChange : !switching && !('layout' in rest) ? alt : null
    if (switching && !('layout' in rest) && altChange === undefined) {
      // A list opens in the layout last used there (projects: else their default view).
      const p = nextState.project ? projects?.find((x) => x.id === nextState.project) : undefined
      const L = readLayout(layoutKey(nextState)) ?? (p?.default_view as LayoutName | undefined) ?? 'list'
      if (L === 'calendar' || L === 'timeline') nextAlt = L
      else if (L !== 'list') nextState = nextTaskState(nextState, { layout: L })
    }
    const next = new URLSearchParams(serializeTaskState(nextState))
    if (!switching) for (const k of EXTRA_KEYS) { const v = search.get(k); if (v && !next.has(k)) next.set(k, v) }
    if (nextAlt) next.set('layout', nextAlt)
    setSearch(next, { replace })
  }, [state, search, alt, projects, setSearch])
  const setExtra = (k: string, v: string | null) => setSearch((p) => { const n = new URLSearchParams(p); if (v) n.set(k, v); else n.delete(k); return n }, { replace: true })

  const saved = views?.find((v) => v.id === state.saved)
  const project = projects?.find((p) => p.id === state.project) ?? (state.view === 'inbox' ? projects?.find((p) => p.is_inbox) : undefined)
  const labelFilter = search.get('label') ?? ''
  const prioMin = Number(search.get('prio')) || 0
  const assignee = search.get('assignee') ?? ''
  const showCompleted = search.get('done') === '1'
  const grouping = (['due', 'priority', 'project', 'none'].includes(search.get('group') ?? '') ? search.get('group') : 'auto') as 'auto' | 'due' | 'priority' | 'project' | 'none'
  const baseParams = listParams(state, overview, saved, search.has('sort'))
  const params = baseParams && withFilters(baseParams, { label: labelFilter, prio: prioMin, assignee })
  const isBoard = state.layout === 'board' && !!state.project && !alt
  const isTable = state.layout === 'table' && !alt
  const isCal = alt === 'calendar'
  const isTimeline = alt === 'timeline'
  const isList = !isBoard && !isTable && !alt
  const layout: LayoutName = isBoard ? 'board' : isTable ? 'table' : alt ?? 'list'
  const isProjectList = !!state.project || state.view === 'inbox'
  const tasks = useTasks(params ?? {}, !!params && !isBoard && !isCal)
  const doneParams = useMemo(() => {
    if (!params || isProjectList || state.view === 'done' || !showCompleted || !(isList || isTable)) return null
    const p: TaskQuery = { ...params, done: true, sort: 'done', limit: 100 }
    if (p.view !== 'favorites' && p.view !== 'assigned') delete p.view
    return p
  }, [params, isProjectList, state.view, showCompleted, isList, isTable]) // eslint-disable-line react-hooks/exhaustive-deps
  const doneQuery = useTasks(doneParams ?? {}, !!doneParams)
  const todayStart = startOfDay(new Date()).toISOString()
  const doneToday = useTasks({ view: 'done', done_after: todayStart, limit: 1 }, state.view === 'today' && !state.q)
  const bParams = state.project ? boardParams(state.project, state.q) : {}
  const boardTasks = useTasks(bParams, isBoard)
  const setDone = useSetDone()
  const updateTask = useUpdateTask()
  const ops = useBulkOps()
  const deleteLater = useDeleteWithUndo()
  const saveView = useSaveView()
  const [projectDialog, setProjectDialog] = useState<{ project: Project | null; parent?: string | null } | null>(null)
  const [labelDialog, setLabelDialog] = useState<Label | 'new' | null>(null)
  const [sharing, setSharing] = useState<Project | null>(null)
  const [viewDialog, setViewDialog] = useState<{ view: SavedView | null } | null>(null)
  const [help, setHelp] = useState(false)
  const [selected, setSelected] = useState<string | null>(null) // keyboard cursor
  const [editing, setEditing] = useState<string | null>(null)
  const [addingSub, setAddingSub] = useState<string | null>(null)
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(() => new Set())
  const [collapsedTasks, setCollapsedTasks] = useState(() => readSet(COLLAPSED_TASKS))
  const [focus, setFocus] = useState(false)
  const [q, setQ] = useState(state.q)
  const sel = useSelection()
  const touch = useMediaQuery('(hover: none)')
  useEffect(() => setQ(state.q), [state.q])
  useEffect(() => {
    const t = setTimeout(() => q !== state.q && update({ q }, true), 300)
    return () => clearTimeout(t)
  }, [q]) // eslint-disable-line
  // A new list (or filter, or layout) starts with nothing selected, no open sections collapsed, no focus mode.
  useEffect(() => sel.clear(), [state.project, state.view, state.saved, state.q, labelFilter, prioMin, assignee, layout]) // eslint-disable-line
  useEffect(() => { setCollapsedSections(new Set()); setSelected(null) }, [state.project, state.view, state.saved])
  useEffect(() => { if (!isList) setFocus(false) }, [isList, state.project, state.view, state.saved])
  useEffect(() => {
    document.body.classList.toggle('tasks-focus', focus)
    return () => document.body.classList.remove('tasks-focus')
  }, [focus])

  const title = state.project ? project?.name ?? 'Project' : state.saved ? saved?.name ?? 'Saved view' : VIEWS.find((v) => v.id === state.view)?.label ?? 'Tasks'
  const byId = useMemo(() => new Map((projects ?? []).map((p) => [p.id, p])), [projects])
  const pathOf = useMemo(() => {
    const m = new Map<string, string>()
    for (const p of projects ?? []) {
      const parts = [p.name]
      let cur = p.parent_id ? byId.get(p.parent_id) : undefined
      for (let i = 0; cur && i < 5; i++, cur = cur.parent_id ? byId.get(cur.parent_id) : undefined) parts.unshift(cur.name)
      m.set(p.id, parts.join(' › '))
    }
    return m
  }, [projects, byId])
  const items = useMemo(() => (tasks.data?.items ?? []).filter((t) => !hidden.has(t.id)), [tasks.data, hidden])
  const open = useMemo(() => items.filter((t) => !t.done), [items])
  const doneList = useMemo(() => (isProjectList ? items.filter((t) => t.done) : (doneQuery.data?.items ?? []).filter((t) => !hidden.has(t.id))), [isProjectList, items, doneQuery.data, hidden])
  const nested = useMemo(() => nestTasks(isProjectList ? open : items), [isProjectList, open, items])

  const groups = useMemo(() => {
    if (state.view === 'done') {
      return groupByDay(items, (t) => t.done_at).map((g) => ({
        key: g.key,
        label: g.date ? (isSameDay(g.date, new Date()) ? 'Today' : isSameDay(g.date, addDays(new Date(), -1)) ? 'Yesterday' : fmtDate(g.date, { weekday: 'long', month: 'short', day: 'numeric' })) : 'Undated',
        items: g.items, keep: false,
      }))
    }
    const base = nested.roots
    if (grouping === 'none' || (grouping === 'auto' && isProjectList && state.sort !== 'due')) return [{ key: 'all', label: '', items: base, keep: false }]
    if (grouping === 'priority') {
      return [{ value: 0, label: 'No priority' }, ...PRIORITIES].reverse().map((p) => ({ key: 'p' + p.value, label: p.label, keep: false, items: base.filter((t) => (t.priority >= 20 ? 20 : t.priority >= 15 ? 15 : t.priority >= 10 ? 10 : t.priority >= 5 ? 5 : 0) === p.value) })).filter((g) => g.items.length)
    }
    if (grouping === 'project') {
      const m = new Map<string, Task[]>()
      for (const t of base) m.set(t.project_id ?? '', [...(m.get(t.project_id ?? '') ?? []), t])
      return [...m.entries()].map(([id, list]) => ({ key: 'pr' + id, label: id ? (byId.get(id)?.is_inbox ? 'Inbox' : pathOf.get(id) ?? 'Project') : 'No project', items: list, keep: false }))
    }
    const g = groupByDue(base, (t) => t.due).map((x) => ({ ...x, keep: false }))
    if (state.view !== 'upcoming') return g
    // Upcoming reads like a planner: one section per day for the coming week, empty ones included (drop targets).
    const today = startOfDay(new Date())
    const days = Array.from({ length: 7 }, (_, i) => {
      const d = addDays(today, i)
      const key = i === 0 ? 'today' : i === 1 ? 'tomorrow' : `day:${dayKey(d)}`
      const label = i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : weekdayName(d) + ', ' + fmtDate(d)
      return { key, label, items: g.find((x) => x.key === key)?.items ?? [], keep: true }
    })
    return [...g.filter((x) => x.key === 'overdue'), ...days]
  }, [items, nested, state.view, state.sort, isProjectList, grouping, pathOf, byId])

  const visibleRows = (list: Task[]): Task[] => list.flatMap((t) => [t, ...(collapsedTasks.has(t.id) ? [] : visibleRows(nested.kids.get(t.id) ?? []))])
  const flat = groups.filter((g) => !collapsedSections.has(g.key)).flatMap((g) => (state.view === 'done' ? g.items : visibleRows(g.items)))
  const tableTasks = state.view === 'done' ? items : [...open, ...(showCompleted ? doneList : [])]
  const boardItems = useMemo(() => (boardTasks.data?.items ?? []).filter((t) => !hidden.has(t.id)), [boardTasks.data, hidden])
  /** Row order on screen, for Shift-click ranges, Ctrl+A and j/k. */
  const order = useMemo(() => [...flat, ...(showCompleted && state.view !== 'done' ? doneList : [])].map((t) => t.id), [flat, doneList, showCompleted, state.view])
  const navOrder = isTable ? tableTasks.map((t) => t.id) : isBoard ? boardItems.map((t) => t.id) : isTimeline ? items.filter((t) => t.due || t.start).map((t) => t.id) : order
  const pool = isBoard ? boardItems : isTable ? tableTasks : [...items, ...doneList]
  const picked = pool.filter((t) => sel.ids.has(t.id))
  const taskById = useMemo(() => new Map([...items, ...doneList, ...boardItems].map((t) => [t.id, t])), [items, doneList, boardItems])
  const findTask = (id: string | null): Task | undefined => {
    if (!id) return undefined
    return taskById.get(id) ?? qc.getQueryData<Task>(keys.task(id)) ?? qc.getQueriesData<TaskPage>({ queryKey: ['tasks', 'list'] }).flatMap(([, d]) => d?.items ?? []).find((t) => t.id === id)
  }

  const toggle = (t: Task) => setDone.mutate({ task: t, done: !t.done })
  // Keep each task's time of day, move the date to today (an earlier time today becomes "today", 23:59).
  const rescheduleToToday = (list: Task[]) => {
    const now = new Date()
    for (const t of list) {
      if (!t.due) continue
      const d = new Date(t.due)
      d.setFullYear(now.getFullYear(), now.getMonth(), now.getDate())
      if (d < now) d.setHours(23, 59, 0, 0)
      updateTask.mutate({ id: t.id, body: { due: d.toISOString() } })
    }
    toast.show(`Moved ${plural(list.length)} to today`)
  }
  const openTask = (t: Task) => { if (t.id.startsWith('temp-')) return; setSelected(t.id); update({ task: t.id }) }
  const listKey = params ? keys.taskList(params) : undefined
  const quickKey = isBoard && state.project ? keys.taskList(bParams) : listKey
  const totalOpen = isProjectList ? open.length : items.filter((t) => !t.done).length

  const setLayout = (L: LayoutName) => {
    try { localStorage.setItem(layoutKey(state), L) } catch { /* ignore */ }
    if (L === 'calendar' || L === 'timeline') update({ layout: 'list', alt: L })
    else update({ layout: L, alt: null })
  }
  const goView = (v: SmartView) => (v === 'inbox' && overview ? update({ project: overview.inbox_id, task: null }) : update({ view: v, task: null }))

  // ---------------------------------------------------------------- quick add: context and "Added to …"
  const quickCreated = (t: Task) => {
    const body: Partial<Task> & Record<string, unknown> = {}
    if (state.view === 'favorites') body.favorite = true
    if (state.view === 'assigned' && me) body.assignees = [me.username] as unknown as Task['assignees']
    const extraLabels = labelFilter.split(',').filter(Boolean).map(Number).filter((id) => !t.labels.includes(id))
    if (extraLabels.length) body.labels = [...t.labels, ...extraLabels]
    if (Object.keys(body).length) updateTask.mutate({ id: t.id, body: body as never })
    const after: Task = { ...t, favorite: body.favorite ?? t.favorite, labels: (body.labels as number[]) ?? t.labels, assignees: body.assignees && me ? [{ id: me.id, username: me.username, name: me.username }] : t.assignees }
    const fits = params && !isBoard && !isCal ? fitsList(after, params as Record<string, unknown>, me?.username) : true
    if (fits === false) {
      const p = t.project_id ? byId.get(t.project_id) : undefined
      toast.show(`Added "${t.title}" to ${p ? (p.is_inbox ? 'Inbox' : p.name) : 'a project'}`, { action: { label: 'Open', run: () => update({ task: t.id }) } })
    }
  }

  // ---------------------------------------------------------------- drag and drop (list rows)
  const [drag, setDrag] = useState<{ ids: string[]; over: string | null; index?: number } | null>(null)
  const reorderProject = state.project ?? (state.view === 'inbox' ? overview?.inbox_id ?? '' : '')
  const reorder = useReorderTasks(reorderProject)
  const canReorder = isProjectList && state.sort === 'position' && groups.length === 1 && groups[0]?.key === 'all' && !state.q && !labelFilter && !prioMin && !assignee && (project?.role ?? 2) >= 1
  const groupOf = useMemo(() => new Map(groups.flatMap((g) => g.items.map((t) => [t.id, g.key] as const))), [groups])
  const today = startOfDay(new Date())
  /** What dropping on a section does: due-date sections reschedule, priority sections re-prioritise, project sections move. */
  const dropAction = (key: string): ((ids: string[]) => void) | null => {
    if (state.view === 'done') return null
    if (key === 'today' || key === 'tomorrow' || key === 'nodate' || key.startsWith('day:')) {
      const day = key === 'nodate' ? null : key === 'today' ? today : key === 'tomorrow' ? addDays(today, 1) : parseDayKey(key.slice(4))
      return (ids) => ops.setDue(ids.map((id) => taskById.get(id)!).filter(Boolean), day)
    }
    if (/^p\d+$/.test(key)) return (ids) => ops.setPriority(ids, Number(key.slice(1)))
    const p = key.startsWith('pr') ? byId.get(key.slice(2)) : undefined
    if (p && p.role >= 1 && !p.archived) return (ids) => ops.move(ids, p)
    return null
  }
  const startDrag = (e: DragEvent, t: Task) => {
    const ids = sel.ids.has(t.id) ? order.filter((id) => sel.ids.has(id)) : [t.id]
    e.dataTransfer.setData('text/x-task', t.id)
    e.dataTransfer.effectAllowed = 'move'
    setTimeout(() => setDrag({ ids, over: null }), 0) // after the browser grabbed the drag image
  }
  const indexAt = (el: HTMLElement, y: number) => {
    const rows = Array.from(el.querySelectorAll<HTMLElement>('.pick[data-root]')).filter((r) => !drag?.ids.includes(r.dataset.id!))
    const i = rows.findIndex((r) => { const b = r.getBoundingClientRect(); return y < b.top + b.height / 2 })
    return i < 0 ? rows.length : i
  }
  const isChild = (id: string) => { const t = taskById.get(id); return !!t?.parent_id && taskById.has(t.parent_id) }
  const sectionDrop = (key: string, list: Task[]) => {
    if (!drag) return {}
    const reorderHere = canReorder && key === 'all' && !drag.ids.some(isChild)
    const act = reorderHere ? null : dropAction(key)
    if (!reorderHere && (!act || drag.ids.every((id) => groupOf.get(id) === key))) return {}
    return {
      onDragOver: (e: DragEvent<HTMLElement>) => {
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        const index = reorderHere ? indexAt(e.currentTarget, e.clientY) : undefined
        if (drag.over !== key || drag.index !== index) setDrag({ ...drag, over: key, index })
      },
      onDragLeave: (e: DragEvent<HTMLElement>) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node) && drag.over === key) setDrag({ ...drag, over: null })
      },
      onDrop: (e: DragEvent<HTMLElement>) => {
        e.preventDefault()
        if (reorderHere) {
          const rest = list.map((t) => t.id).filter((id) => !drag.ids.includes(id))
          const at = indexAt(e.currentTarget, e.clientY)
          const ids = [...rest.slice(0, at), ...drag.ids, ...rest.slice(at)]
          if (ids.join() !== list.map((t) => t.id).join()) reorder.mutate(ids)
        } else act?.(drag.ids)
        setDrag(null)
      },
    }
  }
  const projectDrop = (p: Project | undefined): Record<string, unknown> => {
    if (!drag || !p || p.role < 1 || p.archived) return {}
    const key = 'side:' + p.id
    return {
      onDragOver: (e: DragEvent) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (drag.over !== key) setDrag({ ...drag, over: key }) },
      onDragLeave: (e: DragEvent<HTMLElement>) => { if (!e.currentTarget.contains(e.relatedTarget as Node) && drag.over === key) setDrag({ ...drag, over: null }) },
      onDrop: (e: DragEvent) => { e.preventDefault(); ops.move(drag.ids, p); setDrag(null) },
    }
  }

  // ---------------------------------------------------------------- keyboard (classic keys)
  const targets = (): Task[] => {
    const ids = sel.ids.size ? [...sel.ids] : state.task ? [state.task] : selected ? [selected] : []
    return ids.map(findTask).filter((t): t is Task => !!t && !t.id.startsWith('temp-'))
  }
  const focusTitle = () => setTimeout(() => document.querySelector<HTMLTextAreaElement>('.detail-title')?.focus(), 250)
  useTaskKeys((k) => {
    const ts = () => targets()
    const go: Record<string, () => void> = {
      'g:i': () => goView('inbox'), 'g:t': () => goView('today'), 'g:u': () => goView('upcoming'), 'g:o': () => goView('overdue'),
      'g:n': () => goView('nodate'), 'g:f': () => goView('favorites'), 'g:a': () => goView('assigned'), 'g:d': () => goView('done'),
      'v:l': () => setLayout('list'), 'v:t': () => setLayout('table'), 'v:c': () => setLayout('calendar'), 'v:g': () => setLayout('timeline'),
    }
    if (state.project) go['v:b'] = () => setLayout('board')
    if (go[k]) return go[k](), true
    switch (k) {
      case '?': setHelp(true); return true
      case '/': document.querySelector<HTMLInputElement>('.tasks-search input')?.focus(); return true
      case 'q': case 'n': {
        const el = document.querySelector<HTMLInputElement>('.tasks-quick .quick-add-input')
        if (!el || state.task) return false
        el.focus()
        return true
      }
      case 'j': case 'k': case 'ArrowDown': case 'ArrowUp': {
        if (!navOrder.length || isCal) return false
        const i = navOrder.indexOf(selected ?? '')
        const down = k === 'j' || k === 'ArrowDown'
        const next = navOrder[i < 0 ? (down ? 0 : navOrder.length - 1) : Math.max(0, Math.min(navOrder.length - 1, i + (down ? 1 : -1)))]
        setSelected(next)
        document.querySelector(`[data-task="${next}"]`)?.scrollIntoView({ block: 'nearest' })
        if (state.task) update({ task: next }, true)
        return true
      }
      case 'Enter': case 'o': if (!selected || state.task) return false; update({ task: selected }); return true
      case 'x': if (!selected) return false; sel.toggle(selected); return true
      case 'e': {
        const t = findTask(state.task ?? selected)
        if (!t) return false
        if (isList && !state.task) setEditing(t.id)
        else { if (!state.task) update({ task: t.id }); focusTitle() }
        return true
      }
      case 'd': {
        const list = ts()
        if (!list.length) return false
        if (list.length === 1) setDone.mutate({ task: list[0], done: !list[0].done })
        else ops.setDone(list.map((t) => t.id), !list.every((t) => t.done))
        sel.clear()
        return true
      }
      case 's': {
        const list = ts()
        if (!list.length) return false
        const fav = !list.every((t) => t.favorite)
        ops.update(list.map((t) => t.id), { favorite: fav }, list.length > 1 ? (fav ? 'Added to favourites' : 'Removed from favourites') : undefined)
        return true
      }
      case 't': {
        const list = ts()
        if (!list.length) return false
        const eod = new Date(); eod.setHours(23, 59, 0, 0)
        ops.update(list.map((t) => t.id), { due: eod.toISOString() }, 'Due today')
        return true
      }
      case '1': case '2': case '3': case '4': {
        const list = ts()
        if (!list.length) return false
        const p = PRIORITIES[Number(k) - 1]
        ops.setPriority(list.map((t) => t.id), p.value)
        toast.show(`Priority: ${p.label}`)
        return true
      }
      case 'Delete': case 'Backspace': {
        const list = ts()
        if (!list.length) return false
        deleteLater(list)
        sel.clear()
        if (state.task && list.some((t) => t.id === state.task)) update({ task: null })
        return true
      }
      case 'f': if (!isList) return false; setFocus((f) => !f); return true
      case '[': document.querySelector<HTMLButtonElement>('.topbar [aria-controls="app-sidebar"]')?.click(); return true
      case 'Escape':
        if (state.task || document.querySelector('.dialog,.menu,.drawer')) return false
        if (sel.ids.size) { sel.clear(); return true }
        if (focus) { setFocus(false); return true }
        return false
      case 'ctrl+a':
        if (!(isList || isTable || isBoard) || state.task) return false
        sel.set(isTable ? tableTasks.map((t) => t.id) : isBoard ? boardItems.map((t) => t.id) : order)
        return true
      default: return false
    }
  })

  // ---------------------------------------------------------------- list rows
  const toggleCollapsedTask = (id: string) => setCollapsedTasks((s) => {
    const n = new Set(s)
    if (n.has(id)) n.delete(id); else n.add(id)
    try { localStorage.setItem(COLLAPSED_TASKS, JSON.stringify([...n].slice(-500))) } catch { /* ignore */ }
    return n
  })
  const canEditTask = (t: Task) => !me || t.owner.id === me.id || (t.project_id ? (byId.get(t.project_id)?.role ?? 0) >= 1 : true)
  const rowFor = (t: Task, depth: number, nKids: number, root: boolean, showProject: boolean): ReactNode => {
    const collapsed = collapsedTasks.has(t.id)
    const editable = canEditTask(t) && !t.id.startsWith('temp-')
    return (
      <Pickable key={t.id} id={t.id} title={t.title} sel={sel} order={order} touch={touch} depth={depth} root={root}
        onRename={editable && state.view !== 'done' ? () => setEditing(t.id) : undefined} onOpen={() => openTask(t)}>
        {nKids > 0 && (
          <button className="row-twisty" onClick={(e) => (e.stopPropagation(), toggleCollapsedTask(t.id))} aria-expanded={!collapsed} aria-label={collapsed ? `Show ${plural(nKids, 'subtask')}` : 'Hide subtasks'}>
            <Icon name={collapsed ? 'chevronRight' : 'chevronDown'} size={12} />
          </button>
        )}
        <TaskRow
          task={t}
          project={t.project_id ? byId.get(t.project_id) : undefined}
          showProject={showProject}
          projectPath={t.project_id ? pathOf.get(t.project_id) : undefined}
          labels={labels}
          selected={sel.ids.has(t.id) || t.id === state.task || t.id === selected}
          onToggle={() => toggle(t)}
          onOpen={() => openTask(t)}
          draggable={!touch && editable && state.view !== 'done' && editing !== t.id}
          onDragStart={(e) => startDrag(e, t)}
          onDragEnd={() => setDrag(null)}
          titleSlot={editing === t.id ? <InlineTitle task={t} onDone={(v) => { setEditing(null); if (v && v !== t.title) updateTask.mutate({ id: t.id, body: { title: v } }) }} /> : undefined}
          extra={editable && !t.done && state.view !== 'done' ? (
            <button className="btn ghost icon sm row-act" title="Add subtask" aria-label={`Add subtask to "${t.title}"`}
              onClick={(e) => { e.stopPropagation(); setAddingSub(t.id); if (collapsed) toggleCollapsedTask(t.id) }}><Icon name="plus" size={14} /></button>
          ) : undefined}
        />
      </Pickable>
    )
  }
  const rowsOf = (t: Task, depth: number, showProject: boolean): ReactNode[] => {
    const kids = nested.kids.get(t.id) ?? []
    const collapsed = collapsedTasks.has(t.id)
    return [
      rowFor(t, depth, kids.length, depth === 0, showProject),
      addingSub === t.id && (
        <div key={'sub' + t.id} className="sub-add" style={{ '--depth': depth + 1 } as CSSProperties}
          onKeyDown={(e) => e.key === 'Escape' && (e.stopPropagation(), setAddingSub(null))}
          onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node) && !e.currentTarget.querySelector('input')?.value) setAddingSub(null) }}>
          <QuickAddInput compact autoFocus parentId={t.id} projectId={t.project_id} listKey={listKey} optimistic={{ parent_id: t.id, project_id: t.project_id }} placeholder="Subtask, then Enter (Esc to finish)" />
        </div>
      ),
      ...(collapsed ? [] : kids.flatMap((c) => rowsOf(c, depth + 1, showProject))),
    ]
  }

  const filtersActive = !!(labelFilter || prioMin || assignee || state.q)
  const savedDirty = !!saved && (!!labelFilter || !!prioMin || !!assignee || search.has('sort') || (!!state.q && state.q !== saved.filters.q))
  const updateSaved = (v: SavedView) => saveView.mutate({ id: v.id, body: { filters: viewFilters(params) } }, { onSuccess: () => { toast.show('View updated'); setSearch(new URLSearchParams({ saved: v.id })) } })
  const doneTodayN = doneToday.data?.total ?? 0
  const projectPct = items.length ? Math.round(((items.length - open.length) / items.length) * 100) : 0
  const writable = (project?.role ?? 0) >= 1

  const sidebar = (
    <TasksSidebar
      overview={overview} projects={projects} labels={labels} views={views} showArchived={showArchived} toggleArchived={toggleArchived}
      active={{ view: state.view, project: state.project, saved: state.saved, inbox: !!project?.is_inbox }} labelFilter={labelFilter}
      taskDrop={projectDrop} taskOver={drag?.over ?? null}
      onView={goView}
      onProject={(p) => update({ project: p.id, task: null })}
      // Like the classic label page: every open task with that label (click again to clear).
      onLabel={(l) => (labelFilter === String(l.id) ? setExtra('label', null) : setSearch(new URLSearchParams({ view: 'all', label: String(l.id) })))}
      onSaved={(v) => update({ saved: v.id, task: null })}
      onNewProject={() => setProjectDialog({ project: null })}
      onEditProject={(p) => setProjectDialog({ project: p })}
      onAddSub={(p) => setProjectDialog({ project: null, parent: p.id })}
      onShare={setSharing}
      onProjectDeleted={(p) => state.project === p.id && update({ view: 'today' })}
      onNewLabel={() => setLabelDialog('new')}
      onEditLabel={setLabelDialog}
      onLabelDeleted={(l) => labelFilter.split(',').includes(String(l.id)) && setExtra('label', labelFilter.split(',').filter((x) => x !== String(l.id)).join(',') || null)}
      onSaveView={() => setViewDialog({ view: null })}
      onRenameView={(v) => setViewDialog({ view: v })}
      onUpdateView={savedDirty ? updateSaved : undefined}
      onViewDeleted={(v) => state.saved === v.id && update({ view: 'today' })}
    />
  )

  const topbar = (
    <div className="tasks-top">
      <label className="tasks-search">
        <Icon name="search" size={14} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search tasks" aria-label="Search tasks"
          onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); if (q) setQ(''); else (e.target as HTMLInputElement).blur() } if (e.key === 'Enter' || e.key === 'ArrowDown') { e.preventDefault(); (e.target as HTMLInputElement).blur(); if (navOrder[0]) setSelected(navOrder[0]) } }} />
        {q ? <button className="btn ghost icon sm" onClick={() => setQ('')} aria-label="Clear search"><Icon name="x" size={12} /></button> : <span className="kbd search-slash">/</span>}
      </label>
    </div>
  )

  const chips: ReactNode[] = []
  if (prioMin) chips.push(<FilterChip key="prio" text={`Priority ≥ ${PRIORITIES.find((p) => p.value === prioMin)?.label ?? prioMin}`} onRemove={() => setExtra('prio', null)} />)
  for (const id of labelFilter.split(',').filter(Boolean)) {
    chips.push(<FilterChip key={'l' + id} text={labels?.find((l) => String(l.id) === id)?.name ?? 'Label'} colour={labels?.find((l) => String(l.id) === id)?.colour} onRemove={() => setExtra('label', labelFilter.split(',').filter((x) => x !== id).join(',') || null)} />)
  }
  if (assignee) chips.push(<FilterChip key="as" text={`Assignee: ${assignee === me?.username ? 'me' : assignee}`} onRemove={() => setExtra('assignee', null)} />)

  return (
    <AppShell app="tasks" pageTitle={title} topbar={topbar} sidebar={sidebar} fullHeight>
      <div className={'tasks-main' + (isBoard ? ' board-mode' : '') + (isTimeline || isCal ? ' wide' : '') + (focus ? ' focus' : '')}>
        <header className="tasks-head">
          <div className="grow">
            <h1 className="row">
              {project && !project.is_inbox && <span className="dot lg" style={{ background: project.colour || 'var(--app-muted)' }} />}
              {saved && <Icon name="filter" size={16} className="muted" />}
              <span className="truncate">{title}</span>
              {!isBoard && !isCal && tasks.data && <span className="tasks-count">{totalOpen}</span>}
              {project && !project.is_inbox && project.shared && (
                <button className="chip shared-chip" onClick={() => setSharing(project)} title="People with access"><Icon name="users" size={11} />Shared</button>
              )}
            </h1>
            {isProjectList && !isBoard && !isCal && tasks.data && items.length > 0 && (
              <p className="muted small row tasks-progress" title={`${projectPct}% complete`}><Ring value={projectPct} size={14} />{open.length} open · {items.length - open.length} done</p>
            )}
            {state.view === 'today' && !state.q && tasks.data && doneToday.data && (doneTodayN + totalOpen > 0) && (
              <p className="muted small row tasks-progress"><Ring value={Math.round((doneTodayN / (doneTodayN + totalOpen)) * 100)} size={14} />{doneTodayN} of {doneTodayN + totalOpen} done today</p>
            )}
            {project?.description && <p className="muted small truncate">{project.description}</p>}
          </div>
          {isList && (
            <button className={'btn sm' + (focus ? ' filter-on' : '')} aria-pressed={focus} onClick={() => setFocus((f) => !f)} title="Focus mode (f)"><Icon name="target" size={14} /><span className="btn-label">Focus</span></button>
          )}
          {project && !project.is_inbox && <button className="btn sm" onClick={() => setSharing(project)} title="Share"><Icon name="users" size={14} /><span className="btn-label">Share</span></button>}
          {project && (
            <ProjectMenu project={project} trigger="header" onEdit={() => setProjectDialog({ project })} onShare={() => setSharing(project)}
              onAddSub={() => setProjectDialog({ project: null, parent: project.id })} onDeleted={() => update({ view: 'today' })} />
          )}
          {saved && views && (() => {
            const i = views.findIndex((v) => v.id === saved.id)
            return <ViewMenu header view={saved} prev={views[i - 1]} next={views[i + 1]} before={views[i - 2]} after={views[i + 2]} onRename={() => setViewDialog({ view: saved })}
              onUpdate={savedDirty ? () => updateSaved(saved) : undefined} onDeleted={() => update({ view: 'today' })} />
          })()}
          <button className="btn ghost icon sm" onClick={() => setHelp(true)} aria-label="Keyboard shortcuts" title="Keyboard shortcuts (?)"><Icon name="command" size={15} /></button>
        </header>

        <div className="tasks-tools">
          <div className="seg layout-seg" role="group" aria-label="Layout">
            <button aria-pressed={isList} onClick={() => setLayout('list')} title="List (v l)"><Icon name="list" size={14} /><span>List</span></button>
            {state.project && <button aria-pressed={isBoard} onClick={() => setLayout('board')} title="Board (v b)"><Icon name="board" size={14} /><span>Board</span></button>}
            <button aria-pressed={isTable} onClick={() => setLayout('table')} title="Table (v t)"><Icon name="layers" size={14} /><span>Table</span></button>
            <button aria-pressed={isCal} onClick={() => setLayout('calendar')} title="Calendar (v c)"><Icon name="calendar" size={14} /><span>Calendar</span></button>
            <button aria-pressed={isTimeline} onClick={() => setLayout('timeline')} title="Timeline (v g)"><TimelineIcon /><span>Timeline</span></button>
          </div>
          <span className="spacer" />
          {!isBoard && (
            <Menu align="end" label="Filter" width="16rem" trigger={(p) => (
              <button {...p} className={'btn sm' + (labelFilter || prioMin || assignee ? ' filter-on' : '')}><Icon name="filter" size={14} /><span className="btn-label">Filter</span>{chips.length ? ` · ${chips.length}` : ''}</button>
            )}>
              {(close) => <FilterMenu close={close} labels={labels} prioMin={prioMin} labelFilter={labelFilter} assignee={assignee} me={me?.username}
                set={setExtra} clear={() => (close(), setSearch((p) => { const n = new URLSearchParams(p); for (const k of ['label', 'prio', 'assignee', 'q']) n.delete(k); return n }))} />}
            </Menu>
          )}
          {isList && state.view !== 'done' && (
            <Menu align="end" label="Group" trigger={(p) => (
              <button {...p} className="btn sm"><Icon name="layers" size={14} /><span className="btn-label">{GROUP_BTN[grouping]}</span></button>
            )}>
              {(close) => GROUPS.map(([k, l]) => (
                <MenuItem key={k} active={grouping === k} end={grouping === k ? '✓' : undefined} onClick={() => (close(), setExtra('group', k === 'auto' ? null : k))}>{l}</MenuItem>
              ))}
            </Menu>
          )}
          {(isList || isTable) && state.view !== 'done' && (
            <Menu align="end" label="Sort" trigger={(p) => (
              <button {...p} className="btn sm"><Icon name="sort" size={14} /><span className="btn-label">{SORT_LABELS[(params?.sort as Sort) ?? state.sort] ?? 'Sort'}</span></button>
            )}>
              {(close) => (Object.keys(SORT_LABELS) as Sort[]).filter((s) => s !== 'position' || isProjectList).map((s) => (
                <MenuItem key={s} active={s === params?.sort} end={s === params?.sort ? '✓' : undefined} onClick={() => { close(); setSearch((p) => { const n = new URLSearchParams(p); n.set('sort', s); return n }, { replace: true }) }}>{SORT_LABELS[s]}</MenuItem>
              ))}
            </Menu>
          )}
          {(isList || isTable) && state.view !== 'done' && (
            <button className={'btn sm' + (showCompleted ? ' filter-on' : '')} aria-pressed={showCompleted} onClick={() => setExtra('done', showCompleted ? null : '1')} title="Show completed tasks">
              <Icon name="check" size={14} /><span className="btn-label">Completed</span>
            </button>
          )}
          {filtersActive && !state.saved && <button className="btn sm primary" onClick={() => setViewDialog({ view: null })}>Save view</button>}
          {savedDirty && saved && <button className="btn sm primary" onClick={() => updateSaved(saved)} disabled={saveView.isPending}>Update view</button>}
        </div>
        {chips.length > 0 && <div className="filter-chips">{chips}</div>}

        {state.view !== 'done' && (isList || isTable || isTimeline || (isBoard && writable)) && (
          <div className="tasks-quick">
            <QuickAddInput
              key={(state.project ?? state.view ?? state.saved ?? '') + layout}
              projectId={state.project ?? (state.view === 'inbox' ? overview?.inbox_id : null)}
              defaultToday={state.view === 'today'}
              listKey={quickKey}
              onCreated={quickCreated}
              placeholder={state.view === 'today' ? 'Add a task for today…  e.g. "Call mom 5pm !3"' : 'Add a task…  try "Pay rent tomorrow 5pm *bills +Home !3 every month"'}
            />
          </div>
        )}

        {isBoard && state.project ? (
          <Board projectId={state.project} labels={labels} q={state.q} onOpen={openTask} writable={writable} hidden={hidden} sel={sel} selected={state.task ?? selected} />
        ) : isCal ? (
          !params ? <SkeletonRows rows={8} /> : <Calendar base={params} labels={labels} projectId={state.project ?? (state.view === 'inbox' ? overview?.inbox_id ?? null : null)} hidden={hidden} onOpen={openTask} selected={state.task} />
        ) : isTimeline ? (
          !params || tasks.isPending ? <SkeletonRows rows={8} /> : tasks.error && !tasks.data ? <ErrorBox error={tasks.error} retry={() => tasks.refetch()} /> : <Timeline tasks={items} onOpen={openTask} selected={state.task ?? selected} />
        ) : isTable ? (
          !params || tasks.isPending ? <SkeletonRows rows={8} /> : <TaskTable tasks={tableTasks} labels={labels} pathOf={pathOf} onOpen={openTask} onToggle={toggle} selected={state.task ?? selected} sel={sel} />
        ) : (
          <div className={'tasks-list' + (sel.ids.size ? ' selecting' : '') + (drag ? ' dragging' : '')}>
            {!params || tasks.isPending ? (
              <SkeletonRows rows={7} avatar />
            ) : tasks.error && !tasks.data ? (
              <ErrorBox error={tasks.error} retry={() => tasks.refetch()} />
            ) : groups.every((g) => !g.items.length) && !(showCompleted && doneList.length) && !groups.some((g) => g.keep) ? (
              <div className="empty tasks-empty">{state.q ? `No tasks match "${state.q}".` : emptyText(state.view)}</div>
            ) : (
              groups.filter((g) => g.items.length || g.keep).map((g) => {
                const reordering = drag?.over === g.key && drag.index !== undefined
                const collapsed = collapsedSections.has(g.key)
                let k = 0 // index among root rows that aren't being dragged, for the drop line
                return (
                  <section key={g.key} className={'task-section' + (drag?.over === g.key && !reordering ? ' drop' : '')} aria-label={g.label || title} {...sectionDrop(g.key, g.items)}>
                    {g.label && (
                      <h2 className={'task-section-head' + (g.key === 'overdue' ? ' danger' : '')}>
                        <button className="section-toggle" aria-expanded={!collapsed} onClick={() => setCollapsedSections((s) => { const n = new Set(s); if (n.has(g.key)) n.delete(g.key); else n.add(g.key); return n })}>
                          <Icon name={collapsed ? 'chevronRight' : 'chevronDown'} size={12} />{g.label}<span>{g.items.length}</span>
                        </button>
                        {g.key === 'overdue' && g.items.length > 0 && <button className="btn ghost sm section-act" onClick={() => rescheduleToToday(g.items)} title="Move all overdue tasks to today">Reschedule to today</button>}
                        {drag?.over === g.key && !reordering && <span className="drop-hint">Drop to {dropHint(g.key, g.label)}</span>}
                      </h2>
                    )}
                    {!collapsed && (state.view === 'done'
                      ? g.items.map((t) => rowFor(t, 0, 0, true, true))
                      : g.items.map((t) => {
                        const line = reordering && !drag!.ids.includes(t.id) && k++ === drag!.index
                        return [line && <div key={'dl' + t.id} className="drop-line list" />, ...rowsOf(t, 0, !isProjectList)]
                      }))}
                    {!collapsed && reordering && drag!.index === k && <div className="drop-line list" />}
                    {!collapsed && g.keep && !g.items.length && <div className="section-empty muted xsmall">Nothing scheduled</div>}
                  </section>
                )
              })
            )}
            {showCompleted && state.view !== 'done' && tasks.data && (
              <section className="task-section done-section">
                <h2 className="task-section-head"><Icon name="check" size={12} />Completed<span>{isProjectList ? doneList.length : doneQuery.data?.total ?? '…'}</span></h2>
                {doneQuery.isPending && doneParams ? <SkeletonRows rows={2} /> : doneList.length ? doneList.map((t) => rowFor(t, 0, 0, false, !isProjectList)) : <div className="section-empty muted xsmall">No completed tasks</div>}
              </section>
            )}
            {isProjectList && !showCompleted && tasks.data && doneList.length > 0 && (
              <button className="task-section-head toggle" onClick={() => setExtra('done', '1')}><Icon name="chevronRight" size={14} />Completed<span>{doneList.length}</span></button>
            )}
            {tasks.data && tasks.data.total > (tasks.data.items.length) && (
              <p className="muted xsmall" style={{ padding: '0.75rem' }}>Showing {tasks.data.items.length} of {tasks.data.total}. Narrow the list with a filter.</p>
            )}
            {canReorder && open.length > 1 && !touch && <p className="muted xsmall tasks-hint">Drag tasks to reorder them, or onto a project in the sidebar to move them. Double-click a title to rename.</p>}
          </div>
        )}
      </div>
      {(isList || isTable || isBoard) && picked.length > 0 && <BulkBar tasks={picked} projects={projects} labels={labels} onClear={sel.clear} />}
      <TaskDrawer id={state.task} onClose={() => update({ task: null })} onOpen={(id) => update({ task: id })} />
      <ProjectDialog open={projectDialog !== null} project={projectDialog?.project ?? null} parentId={projectDialog?.parent} projects={projects}
        onClose={() => setProjectDialog(null)} onCreated={(p) => update({ project: p.id, task: null })} />
      <LabelDialog open={labelDialog !== null} label={labelDialog === 'new' ? null : labelDialog} onClose={() => setLabelDialog(null)} />
      <ShareDialog project={sharing && (byId.get(sharing.id) ?? sharing)} onClose={() => setSharing(null)} onLeft={() => state.project === sharing?.id && update({ view: 'today' })} />
      <SaveViewDialog open={viewDialog !== null} view={viewDialog?.view} params={params} position={(views?.at(-1)?.position ?? 0) + 1}
        onClose={() => setViewDialog(null)} onSaved={(v) => !viewDialog?.view && update({ saved: v.id, task: null })} />
      <ShortcutsDialog open={help} onClose={() => setHelp(false)} />
    </AppShell>
  )
}

function FilterChip({ text, colour, onRemove }: { text: string; colour?: string; onRemove: () => void }) {
  return (
    <span className="chip filter-chip">
      {colour && <span className="dot" style={{ background: colour }} />}{text}
      <button onClick={onRemove} aria-label={`Remove filter ${text}`}><Icon name="x" size={11} /></button>
    </span>
  )
}

function FilterMenu({ close, labels, prioMin, labelFilter, assignee, me, set, clear }: {
  close: () => void; labels?: Label[]; prioMin: number; labelFilter: string; assignee: string; me?: string
  set: (k: string, v: string | null) => void; clear: () => void
}) {
  const [who, setWho] = useState(assignee && assignee !== me ? assignee : '')
  return (
    <>
      <div className="menu-label">Priority</div>
      {PRIO_FILTERS.map(([v, l]) => (
        <MenuItem key={v} active={prioMin === v} end={prioMin === v ? '✓' : undefined} onClick={() => (close(), set('prio', v ? String(v) : null))}>{l}</MenuItem>
      ))}
      {labels && labels.length > 0 && <div className="menu-label">Labels (all of)</div>}
      {labels?.map((l) => {
        const on = labelFilter.split(',').includes(String(l.id))
        return (
          <MenuItem key={l.id} active={on} end={on ? '✓' : undefined} onClick={() => {
            const ids = labelFilter ? labelFilter.split(',').filter(Boolean) : []
            set('label', (on ? ids.filter((x) => x !== String(l.id)) : [...ids, String(l.id)]).join(',') || null)
          }}><span className="row bulk-prio"><span className="dot" style={{ background: l.colour || 'var(--app-muted)' }} />{l.name}</span></MenuItem>
        )
      })}
      <div className="menu-label">Assignee</div>
      <MenuItem active={!assignee} end={!assignee ? '✓' : undefined} onClick={() => (close(), set('assignee', null))}>Anyone</MenuItem>
      {me && <MenuItem active={assignee === me} end={assignee === me ? '✓' : undefined} onClick={() => (close(), set('assignee', me))}>Me</MenuItem>}
      <form className="date-pop" onSubmit={(e) => { e.preventDefault(); const u = who.trim().replace(/^@/, ''); close(); set('assignee', u || null) }}>
        <input className="input" value={who} onChange={(e) => setWho(e.target.value)} placeholder="Username, then Enter" aria-label="Assignee username" maxLength={150} />
      </form>
      {(labelFilter || prioMin || assignee) ? <><div className="menu-sep" /><MenuItem icon="x" onClick={clear}>Clear all filters</MenuItem></> : null}
    </>
  )
}

/** Inline title editor for a list row (Enter saves, Esc cancels, blur saves). */
function InlineTitle({ task, onDone }: { task: Task; onDone: (v: string | null) => void }) {
  const [v, setV] = useState(task.title)
  const done = useRef(false)
  const finish = (save: boolean) => { if (done.current) return; done.current = true; onDone(save ? v.replace(/\s+/g, ' ').trim() || null : null) }
  return (
    <input className="input inline-title" autoFocus value={v} maxLength={256} aria-label="Task title" onFocus={(e) => e.target.select()}
      onChange={(e) => setV(e.target.value)} onClick={(e) => e.stopPropagation()} onBlur={() => finish(true)}
      onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') (e.preventDefault(), finish(true)); if (e.key === 'Escape') (e.preventDefault(), finish(false)) }} />
  )
}

/** One list row that can be picked: a checkbox in the gutter, Ctrl/Cmd/Shift-click, long-press on touch.
 *  A mouse click on the title opens the task after a beat, so a double-click can rename it instead. */
function Pickable({ id, title, sel, order, touch, depth, root, onRename, onOpen, children }: {
  id: string; title: string; sel: Selection; order: string[]; touch: boolean; depth: number; root: boolean
  onRename?: () => void; onOpen: () => void; children: ReactNode
}) {
  const press = useRef<{ timer: number; x: number; y: number; fired: boolean } | null>(null)
  const pointer = useRef('mouse')
  const clickTimer = useRef(0)
  const on = sel.ids.has(id)
  const cancel = () => { if (press.current && !press.current.fired) { clearTimeout(press.current.timer); press.current = null } }
  useEffect(() => () => clearTimeout(clickTimer.current), [])
  return (
    <div
      className={'pick' + (on ? ' on' : '') + (depth ? ' nested' : '')}
      style={depth ? ({ '--depth': depth } as CSSProperties) : undefined}
      data-id={id}
      data-root={root ? '' : undefined}
      onPointerDown={(e) => {
        pointer.current = e.pointerType
        if (e.pointerType !== 'touch' || (e.target as HTMLElement).closest('.check,.sel-box,.row-twisty,.row-act')) return
        const p = { x: e.clientX, y: e.clientY, fired: false, timer: 0 }
        p.timer = window.setTimeout(() => { p.fired = true; sel.toggle(id); navigator.vibrate?.(10) }, 450)
        press.current = p
      }}
      onPointerMove={(e) => { const p = press.current; if (p && !p.fired && Math.hypot(e.clientX - p.x, e.clientY - p.y) > 8) cancel() }}
      onPointerUp={cancel}
      onPointerCancel={cancel}
      onContextMenu={(e) => { if (press.current?.fired) e.preventDefault() }}
      onClickCapture={(e) => {
        if (press.current?.fired) { press.current = null; e.stopPropagation(); e.preventDefault(); return }
        const target = e.target as HTMLElement
        if (target.closest('.check,.sel-box,.row-twisty,.row-act,.inline-title')) return
        if (sel.click(e, id, order)) { e.stopPropagation(); e.preventDefault(); return }
        if (sel.ids.size) {
          // While selecting on a phone, taps add/remove rows; a plain mouse click ends the selection and opens the task.
          if (touch || pointer.current === 'touch') { sel.toggle(id); e.stopPropagation(); e.preventDefault(); return }
          sel.clear()
          return
        }
        if (onRename && pointer.current !== 'touch' && target.closest('.task-title')) {
          e.stopPropagation()
          e.preventDefault()
          clearTimeout(clickTimer.current)
          if (e.detail >= 2) onRename()
          else clickTimer.current = window.setTimeout(onOpen, 220)
        }
      }}
    >
      <input type="checkbox" className="sel-box" checked={on} aria-label={`Select "${title}"`}
        onChange={(e) => ((e.nativeEvent as MouseEvent).shiftKey ? sel.range(order, id) : sel.toggle(id))} />
      {children}
    </div>
  )
}

function dropHint(key: string, label: string): string {
  if (key === 'nodate') return 'clear the due date'
  if (key.startsWith('p') && !key.startsWith('pr')) return `set ${label.toLowerCase()} priority`
  if (key.startsWith('pr')) return `move to ${label}`
  return `reschedule to ${label.toLowerCase() === 'today' || label.toLowerCase() === 'tomorrow' ? label.toLowerCase() : label}`
}

function emptyText(view: SmartView | null): string {
  switch (view) {
    case 'today': return 'Nothing due today. Enjoy it.'
    case 'overdue': return 'Nothing overdue. Nice.'
    case 'upcoming': return 'Nothing due in the next 7 days.'
    case 'nodate': return 'Every task has a date.'
    case 'favorites': return 'No favourite tasks. Star a task to pin it here.'
    case 'assigned': return 'Nobody has assigned you a task.'
    case 'done': return 'No completed tasks yet.'
    default: return 'No tasks here. Add one above.'
  }
}
