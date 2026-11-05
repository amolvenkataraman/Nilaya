// Tasks: smart views + projects in the sidebar, list grouped by due date or a kanban board,
// natural-language quick add, and a detail drawer (?task=<id>). URL holds all state (lib/qs.ts).
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import { AppShell, SideItem, SideSection } from '../../components/AppShell'
import { Icon } from '../../components/Icon'
import { ErrorBox, Menu, MenuItem, SkeletonRows, useHotkey } from '../../components/ui'
import { TaskRow } from '../../components/TaskRow'
import { QuickAddInput } from '../../components/QuickAdd'
import { keys, useLabels, useOverview, useProjects, useSavedViews, useSetDone, useTasks, useUpdateTask, type TaskQuery } from '../../lib/queries'
import { Ring } from '../../components/TaskRow'
import { toast } from '../../components/toast'
import { TaskTable } from './TaskTable'
import { nextTaskState, parseTaskState, serializeTaskState, type Sort, type TaskState, type SmartView } from '../../lib/qs'
import { groupByDay, groupByDue, fmtDate, isSameDay, addDays } from '../../lib/dates'
import { PRIORITIES, type Overview, type Project, type SavedView, type Task } from '../../lib/types'
import { Board } from './Board'
import { TaskDrawer } from './TaskDrawer'
import { ProjectDialog, ProjectMenu, SaveViewDialog } from './ProjectDialog'
import './tasks.css'

const VIEWS: { id: SmartView; label: string; icon: string; count?: (o: Overview) => number }[] = [
  { id: 'inbox', label: 'Inbox', icon: 'inbox', count: (o) => o.inbox },
  { id: 'today', label: 'Today', icon: 'sun', count: (o) => o.today },
  { id: 'upcoming', label: 'Upcoming', icon: 'calendar', count: (o) => o.upcoming },
  { id: 'overdue', label: 'Overdue', icon: 'alert', count: (o) => o.overdue },
  { id: 'nodate', label: 'No date', icon: 'clock', count: (o) => o.no_date },
  { id: 'favorites', label: 'Favourites', icon: 'star', count: (o) => o.favorites },
  { id: 'assigned', label: 'Assigned to me', icon: 'user', count: (o) => o.assigned },
  { id: 'all', label: 'All open tasks', icon: 'layers' },
  { id: 'done', label: 'Completed', icon: 'check' },
]
const SORT_LABELS: Record<Sort, string> = { position: 'Manual', due: 'Due date', priority: 'Priority', created: 'Newest', updated: 'Recently updated', title: 'Title' }

export function listParams(s: TaskState, overview: Overview | undefined, saved: SavedView | undefined): TaskQuery | null {
  const base: TaskQuery = { sort: s.sort, q: s.q || undefined, limit: 500 }
  if (s.project) return { ...base, project: s.project, top_level: true }
  if (s.saved) return saved ? { ...base, ...saved.filters, q: s.q || (saved.filters.q as string | undefined) } : null
  switch (s.view) {
    case 'inbox': return overview ? { ...base, project: overview.inbox_id, top_level: true } : null
    case 'all': return { ...base, done: false }
    case 'done': return { ...base, view: 'done', sort: 'done', limit: 200 }
    default: return { ...base, view: s.view ?? 'today' }
  }
}

export default function TasksPage() {
  const [search, setSearch] = useSearchParams()
  const state = useMemo(() => parseTaskState(search), [search])
  const update = useCallback(
    (change: Partial<TaskState>, replace = false) => setSearch(serializeTaskState(nextTaskState(state, change)), { replace }),
    [state, setSearch],
  )
  const overview = useOverview().data
  const [showArchived, setShowArchived] = useState(() => {
    try { return localStorage.getItem('app.tasks.showArchived') === '1' } catch { return false }
  })
  const toggleArchived = () => setShowArchived((v) => {
    try { localStorage.setItem('app.tasks.showArchived', v ? '0' : '1') } catch { /* ignore */ }
    return !v
  })
  const projects = useProjects(showArchived).data
  const views = useSavedViews().data
  const labels = useLabels().data
  const saved = views?.find((v) => v.id === state.saved)
  const project = projects?.find((p) => p.id === state.project) ?? (state.view === 'inbox' ? projects?.find((p) => p.is_inbox) : undefined)
  // Extra filters/grouping kept in the URL alongside lib/qs state: ?label=1,2&prio=15&group=priority
  const labelFilter = search.get('label') ?? ''
  const prioMin = Number(search.get('prio')) || 0
  const grouping = (['due', 'priority', 'project', 'none'].includes(search.get('group') ?? '') ? search.get('group') : 'auto') as 'auto' | 'due' | 'priority' | 'project' | 'none'
  const setExtra = (k: string, v: string | null) => setSearch((p) => { const n = new URLSearchParams(p); if (v) n.set(k, v); else n.delete(k); return n }, { replace: true })
  const baseParams = listParams(state, overview, saved)
  const params = baseParams && { ...baseParams, label: labelFilter || undefined, priority_min: prioMin || undefined }
  const isBoard = state.layout === 'board' && !!state.project
  const isTable = state.layout === 'table'
  const tasks = useTasks(params ?? {}, !!params && !isBoard)
  const setDone = useSetDone()
  const [projectDialog, setProjectDialog] = useState<Project | 'new' | null>(null)
  const [saveView, setSaveView] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [q, setQ] = useState(state.q)
  const [showDone, setShowDone] = useState(false)
  useEffect(() => setQ(state.q), [state.q])
  useEffect(() => {
    const t = setTimeout(() => q !== state.q && update({ q }, true), 250)
    return () => clearTimeout(t)
  }, [q]) // eslint-disable-line

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
  const items = tasks.data?.items ?? []
  const isProjectList = !!state.project || state.view === 'inbox'
  const open = items.filter((t) => !t.done)
  const done = items.filter((t) => t.done)
  const groups = useMemo(() => {
    if (state.view === 'done') {
      return groupByDay(items, (t) => t.done_at).map((g) => ({
        key: g.key,
        label: g.date ? (isSameDay(g.date, new Date()) ? 'Today' : isSameDay(g.date, addDays(new Date(), -1)) ? 'Yesterday' : fmtDate(g.date, { weekday: 'long', month: 'short', day: 'numeric' })) : 'Undated',
        items: g.items,
      }))
    }
    const base = isProjectList ? open : items
    if (grouping === 'none' || (grouping === 'auto' && isProjectList && state.sort !== 'due')) return [{ key: 'all', label: '', items: base }]
    if (grouping === 'priority') {
      return PRIORITIES.slice().reverse().map((p) => ({ key: 'p' + p.value, label: p.label, items: base.filter((t) => (t.priority >= 20 ? 20 : t.priority >= 15 ? 15 : t.priority >= 10 ? 10 : 5) === p.value) })).filter((g) => g.items.length)
    }
    if (grouping === 'project') {
      const m = new Map<string, Task[]>()
      for (const t of base) m.set(t.project_id ?? '', [...(m.get(t.project_id ?? '') ?? []), t])
      return [...m.entries()].map(([id, list]) => ({ key: 'pr' + id, label: id ? pathOf.get(id) ?? 'Project' : 'No project', items: list }))
    }
    return groupByDue(base, (t) => t.due)
  }, [items, open, state.view, state.sort, isProjectList, grouping, pathOf])
  const doneCount = done.length
  const pct = items.length ? Math.round((doneCount / items.length) * 100) : 0
  const flat = groups.flatMap((g) => g.items)

  // Keyboard: j/k move, Enter opens, x completes, Esc closes the drawer.
  useHotkey((e) => (e.key === 'j' || e.key === 'k') && !e.metaKey && !e.ctrlKey, (e) => {
    if (!flat.length) return
    e.preventDefault()
    const i = flat.findIndex((t) => t.id === selected)
    const next = e.key === 'j' ? Math.min(i + 1, flat.length - 1) : Math.max(i - 1, 0)
    setSelected(flat[next].id)
    document.querySelector(`[data-task="${flat[next].id}"]`)?.scrollIntoView({ block: 'nearest' })
  })
  useHotkey((e) => e.key === 'Enter' && !!selected, () => update({ task: selected }))
  useHotkey((e) => e.key === 'x' && !!selected, () => {
    const t = flat.find((x) => x.id === selected)
    if (t) setDone.mutate({ task: t, done: !t.done })
  })

  const toggle = (t: Task) => setDone.mutate({ task: t, done: !t.done })
  const updateTask = useUpdateTask()
  // Keep each task's time of day, move the date to today.
  const rescheduleToToday = (list: Task[]) => {
    const today = new Date()
    for (const t of list) {
      if (!t.due) continue
      const d = new Date(t.due)
      d.setFullYear(today.getFullYear(), today.getMonth(), today.getDate())
      if (d < today) d.setHours(23, 59, 0, 0)
      updateTask.mutate({ id: t.id, body: { due: d.toISOString() } })
    }
    toast.show(`Moved ${list.length} task${list.length === 1 ? '' : 's'} to today`)
  }
  const openTask = (t: Task) => { if (t.id.startsWith('temp-')) return; setSelected(t.id); update({ task: t.id }) } // still saving
  const listKey = params ? keys.taskList(params) : undefined
  const totalOpen = isProjectList ? open.length : items.length

  const sidebar = (
    <>
      <SideSection>
        {VIEWS.map((v) => (
          <SideItem
            key={v.id}
            icon={v.icon}
            label={v.label}
            active={state.view === v.id || (v.id === 'inbox' && !!project?.is_inbox)}
            count={overview && v.count ? (v.id === 'overdue' && v.count(overview) ? <span className="danger-count">{v.count(overview)}</span> : v.count(overview)) : undefined}
            onClick={() => (v.id === 'inbox' && overview ? update({ project: overview.inbox_id, task: null }) : update({ view: v.id, task: null }))}
          />
        ))}
      </SideSection>
      <SideSection
        title="Projects"
        action={<button className="btn ghost icon sm" onClick={() => setProjectDialog('new')} aria-label="New project" title="New project"><Icon name="plus" size={14} /></button>}
      >
        {(projects ?? []).filter((p) => !p.is_inbox).length === 0 && <div className="side-empty">No projects yet.</div>}
        {sortTree(projects ?? [], showArchived).map(({ p, depth }) => (
          <div key={p.id} className={'side-proj' + (p.archived ? ' archived' : '')} style={{ paddingLeft: `${depth * 0.875}rem` }}>
            <SideItem colour={p.colour || 'var(--app-muted)'} label={p.archived ? <>{p.name} <span className="chip">Archived</span></> : p.name} count={p.archived ? undefined : p.open_count} active={state.project === p.id} onClick={() => update({ project: p.id, layout: p.default_view === 'board' ? 'board' : 'list', task: null })} />
            <ProjectMenu project={p} onEdit={() => setProjectDialog(p)} onDeleted={() => state.project === p.id && update({ view: 'today' })} />
          </div>
        ))}
      </SideSection>
      <SideSection>
        <SideItem icon="album" label={showArchived ? 'Hide archived projects' : 'Show archived projects'} onClick={toggleArchived} />
      </SideSection>
      {labels && labels.length > 0 && (
        <SideSection title="Labels">
          {labels.map((l) => (
            <SideItem key={l.id} icon="tag" label={l.name} active={labelFilter === String(l.id)} onClick={() => setExtra('label', labelFilter === String(l.id) ? null : String(l.id))} />
          ))}
        </SideSection>
      )}
      <SideSection
        title="Saved views"
        action={<button className="btn ghost icon sm" onClick={() => setSaveView(true)} aria-label="Save current view" title="Save current filters as a view"><Icon name="plus" size={14} /></button>}
      >
        {!views?.length && <div className="side-empty">Save filters with +</div>}
        {views?.map((v) => (
          <SideItem key={v.id} icon="filter" label={v.name} active={state.saved === v.id} onClick={() => update({ saved: v.id, task: null })} />
        ))}
      </SideSection>
    </>
  )

  const topbar = (
    <div className="tasks-top">
      <label className="tasks-search">
        <Icon name="search" size={14} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter tasks" aria-label="Filter tasks" />
        {q && <button className="btn ghost icon sm" onClick={() => setQ('')} aria-label="Clear filter"><Icon name="x" size={12} /></button>}
      </label>
    </div>
  )

  return (
    <AppShell app="tasks" pageTitle={title} topbar={topbar} sidebar={sidebar} fullHeight>
      <div className={'tasks-main' + (isBoard ? ' board-mode' : '')}>
        <header className="tasks-head">
          <div className="grow">
            <h1 className="row">
              {project && !project.is_inbox && <span className="dot lg" style={{ background: project.colour || 'var(--app-muted)' }} />}
              <span className="truncate">{title}</span>
              {!isBoard && tasks.data && <span className="tasks-count">{totalOpen}</span>}
            </h1>
            {isProjectList && tasks.data && items.length > 0 && (
              <p className="muted small row tasks-progress" title={`${pct}% complete`}><Ring value={pct} size={14} />{open.length} open · {doneCount} done</p>
            )}
            {project?.description && <p className="muted small truncate">{project.description}</p>}
          </div>
          <div className="seg" role="group" aria-label="Layout">
            <button aria-pressed={state.layout === 'list' || (state.layout === 'board' && !state.project)} onClick={() => update({ layout: 'list' })}><Icon name="list" size={14} />List</button>
            {state.project && <button aria-pressed={isBoard} onClick={() => update({ layout: 'board' })}><Icon name="board" size={14} />Board</button>}
            <button aria-pressed={isTable} onClick={() => update({ layout: 'table' })}><Icon name="layers" size={14} />Table</button>
          </div>
          {!isBoard && (
            <Menu align="end" label="Filter" trigger={(p) => (
              <button {...p} className={'btn sm' + (labelFilter || prioMin ? ' filter-on' : '')}><Icon name="filter" size={14} />Filter{labelFilter || prioMin ? ` · ${(labelFilter ? labelFilter.split(',').length : 0) + (prioMin ? 1 : 0)}` : ''}</button>
            )}>
              {(close) => (
                <>
                  <div className="menu-label">Priority at least</div>
                  {[0, 10, 15, 20].map((v) => (
                    <MenuItem key={v} active={prioMin === v} end={prioMin === v ? '✓' : undefined} onClick={() => (close(), setExtra('prio', v ? String(v) : null))}>{v ? PRIORITIES.find((p) => p.value === v)?.label : 'Any priority'}</MenuItem>
                  ))}
                  {labels && labels.length > 0 && <div className="menu-label">Labels (all of)</div>}
                  {labels?.map((l) => {
                    const on = labelFilter.split(',').includes(String(l.id))
                    return (
                      <MenuItem key={l.id} icon="tag" active={on} end={on ? '✓' : undefined} onClick={() => {
                        const ids = labelFilter ? labelFilter.split(',').filter(Boolean) : []
                        setExtra('label', (on ? ids.filter((x) => x !== String(l.id)) : [...ids, String(l.id)]).join(',') || null)
                      }}>{l.name}</MenuItem>
                    )
                  })}
                  {(labelFilter || prioMin) ? <><div className="menu-sep" /><MenuItem icon="x" onClick={() => (close(), setSearch((p) => { const n = new URLSearchParams(p); n.delete('label'); n.delete('prio'); return n }))}>Clear filters</MenuItem></> : null}
                </>
              )}
            </Menu>
          )}
          {!isBoard && !isTable && state.view !== 'done' && (
            <Menu align="end" label="Group" trigger={(p) => (
              <button {...p} className="btn sm"><Icon name="layers" size={14} />{{ auto: 'Group', due: 'By due', priority: 'By priority', project: 'By project', none: 'No groups' }[grouping]}</button>
            )}>
              {(close) => ([['auto', 'Automatic'], ['due', 'Due date'], ['priority', 'Priority'], ['project', 'Project'], ['none', 'None']] as const).map(([k, l]) => (
                <MenuItem key={k} active={grouping === k} end={grouping === k ? '✓' : undefined} onClick={() => (close(), setExtra('group', k === 'auto' ? null : k))}>{l}</MenuItem>
              ))}
            </Menu>
          )}
          {!isBoard && state.view !== 'done' && (
            <Menu align="end" label="Sort" trigger={(p) => (
              <button {...p} className="btn sm"><Icon name="sort" size={14} />{SORT_LABELS[state.sort]}</button>
            )}>
              {(close) => (Object.keys(SORT_LABELS) as Sort[]).map((s) => (
                <MenuItem key={s} active={s === state.sort} end={s === state.sort ? '✓' : undefined} onClick={() => (close(), update({ sort: s }, true))}>{SORT_LABELS[s]}</MenuItem>
              ))}
            </Menu>
          )}
        </header>

        {isBoard && state.project ? (
          <Board projectId={state.project} labels={labels} q={state.q} onOpen={openTask} />
        ) : isTable ? (
          tasks.isPending ? <SkeletonRows rows={8} /> : <TaskTable tasks={state.view === 'done' ? items : [...open, ...(isProjectList ? done : [])]} labels={labels} pathOf={pathOf} onOpen={openTask} onToggle={toggle} selected={state.task} />
        ) : (
          <div className="tasks-list">
            {state.view !== 'done' && (
              <div className="tasks-quick">
                <QuickAddInput
                  key={state.project ?? state.view ?? ''}
                  projectId={state.project ?? (state.view === 'inbox' ? overview?.inbox_id : null)}
                  defaultToday={state.view === 'today'}
                  listKey={listKey}
                  placeholder={state.view === 'today' ? 'Add a task for today…  e.g. "Call mom 5pm !3"' : undefined}
                />
              </div>
            )}
            {!params || tasks.isPending ? (
              <SkeletonRows rows={7} avatar />
            ) : tasks.error && !tasks.data ? (
              <ErrorBox error={tasks.error} retry={() => tasks.refetch()} />
            ) : flat.length === 0 && !done.length ? (
              <div className="empty tasks-empty">{state.q ? `No tasks match "${state.q}".` : emptyText(state.view)}</div>
            ) : (
              groups.map((g) => (
                <section key={g.key} className="task-section" aria-label={g.label || title}>
                  {g.label && (
                    <h2 className={'task-section-head' + (g.key === 'overdue' ? ' danger' : '')}>
                      {g.label}<span>{g.items.length}</span>
                      {g.key === 'overdue' && <button className="btn ghost sm section-act" onClick={() => rescheduleToToday(g.items)}>Reschedule to today</button>}
                    </h2>
                  )}
                  {g.items.map((t) => (
                    <TaskRow
                      key={t.id}
                      task={t}
                      project={t.project_id ? byId.get(t.project_id) : undefined}
                      showProject={!isProjectList}
                      projectPath={t.project_id ? pathOf.get(t.project_id) : undefined}
                      labels={labels}
                      selected={t.id === state.task || t.id === selected}
                      onToggle={() => toggle(t)}
                      onOpen={() => openTask(t)}
                    />
                  ))}
                </section>
              ))
            )}
            {isProjectList && done.length > 0 && (
              <section className="task-section">
                <button className="task-section-head toggle" onClick={() => setShowDone((s) => !s)} aria-expanded={showDone}>
                  <Icon name={showDone ? 'chevronDown' : 'chevronRight'} size={14} />Completed<span>{done.length}</span>
                </button>
                {showDone && done.map((t) => (
                  <TaskRow key={t.id} task={t} labels={labels} showProject={false} onToggle={() => toggle(t)} onOpen={() => openTask(t)} selected={t.id === state.task} />
                ))}
              </section>
            )}
            {tasks.data && tasks.data.total > items.length && (
              <p className="muted xsmall" style={{ padding: '0.75rem' }}>Showing {items.length} of {tasks.data.total}. Narrow the list with a filter.</p>
            )}
          </div>
        )}
      </div>
      <TaskDrawer id={state.task} onClose={() => update({ task: null })} onOpen={(id) => update({ task: id })} />
      <ProjectDialog open={projectDialog !== null} project={projectDialog === 'new' ? null : projectDialog} onClose={() => setProjectDialog(null)} onCreated={(p) => update({ project: p.id })} />
      <SaveViewDialog open={saveView} params={params} onClose={() => setSaveView(false)} onSaved={(v) => update({ saved: v.id })} />
    </AppShell>
  )
}

function emptyText(view: SmartView | null): string {
  switch (view) {
    case 'today': return 'Nothing due today. Enjoy it.'
    case 'overdue': return 'Nothing overdue.'
    case 'upcoming': return 'Nothing due in the next 7 days.'
    case 'favorites': return 'No favourite tasks. Star a task to pin it here.'
    case 'assigned': return 'Nobody has assigned you a task.'
    case 'done': return 'No completed tasks yet.'
    default: return 'No tasks here. Add one above.'
  }
}

/** Projects in tree order (children under parents), without the Inbox. */
function sortTree(projects: Project[], showArchived = false): { p: Project; depth: number }[] {
  const list = projects.filter((p) => !p.is_inbox && (showArchived || !p.archived))
  const ids = new Set(list.map((p) => p.id))
  const kids = new Map<string | null, Project[]>()
  for (const p of list) {
    const parent = p.parent_id && ids.has(p.parent_id) ? p.parent_id : null
    kids.set(parent, [...(kids.get(parent) ?? []), p])
  }
  const out: { p: Project; depth: number }[] = []
  const walk = (parent: string | null, depth: number) => {
    for (const p of (kids.get(parent) ?? []).sort((a, b) => a.position - b.position || a.name.localeCompare(b.name))) {
      out.push({ p, depth })
      if (depth < 4) walk(p.id, depth + 1)
    }
  }
  walk(null, 0)
  return out
}
