// Tasks: smart views, projects (tree), labels and saved views in the sidebar; list (grouped, nested
// subtasks, inline rename and subtask add), board, table, calendar and timeline layouts; natural-language
// quick add; a detail drawer (?task=<id>); bulk actions; the classic keyboard shortcuts and focus mode.
// The URL holds the state (useTasksUrl); this file wires the pieces together.
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { AppShell } from '../../components/AppShell'
import { QuickAddInput } from '../../components/QuickAdd'
import { toast } from '../../components/toast'
import { Confirm, QueryView, SkeletonRows, useMediaQuery } from '../../components/ui'
import { startOfDay } from '../../lib/dates'
import { plural } from '../../lib/format'
import { keys, useLabels, useMe, useOverview, useProjects, useSavedViews, useSetDone, useUpdateTask } from '../../lib/queries'
import type { Sort } from '../../lib/qs'
import { usePref } from '../../lib/storage'
import { cachedTask, fitsList } from '../../lib/taskLists'
import type { Label, Project, SavedView, Task } from '../../lib/types'
import { bulkFilter, useBulkOps, type BulkTarget } from './bulk'
import { BulkBar } from './BulkBar'
import { useDeleteWithUndo, useHiddenTasks } from './deleteUndo'
import { groupTasks, nestTasks } from './grouping'
import { LabelDialog } from './Labels'
import { ListRow, type RowActions } from './ListRow'
import { ListView, type VItem } from './ListView'
import { useSaveView } from './api'
import { ProjectDialog, ProjectMenu, SaveViewDialog, viewFilters } from './ProjectDialog'
import { ShareDialog } from './ProjectShare'
import { useSelection } from './selection'
import { ShortcutsDialog } from './Shortcuts'
import { TasksSidebar, VIEWS, ViewMenu } from './Sidebar'
import { canEditIn, canEditTask, isTempId, projectName } from './task'
import { TaskDrawer } from './TaskDrawer'
import { TaskSearch } from './TaskSearch'
import { TasksHeader } from './TasksHeader'
import { filterChips, TasksToolbar } from './TasksToolbar'
import { TaskTable } from './TaskTable'
import { useListData } from './useListData'
import { useListDrop } from './useListDrop'
import { useTaskCommands } from './useTaskCommands'
import { useTasksUrl } from './useTasksUrl'
import { useLoadMore } from './virtual'
import { applyPatch, meAsUser } from '../../lib/taskPatch'

// Layouts other than the list load on demand.
const Board = lazy(() => import('./Board').then((m) => ({ default: m.Board })))
const Timeline = lazy(() => import('./Timeline').then((m) => ({ default: m.Timeline })))
const Calendar = lazy(() => import('./Calendar').then((m) => ({ default: m.Calendar })))

/** Rows whose subtasks are folded, remembered on this device (the newest 500). */
const COLLAPSED_TASKS = 'app.tasks.collapsedTasks'
/** Classes put on <body> while focus mode is on: the sidebar is AppShell's, outside this page's tree. */
const FOCUS_BODY = '[&_.app-sidebar]:hidden!'

/** The one dialog open at a time (the drawer and confirms aside). */
type DialogState =
  | { kind: 'project'; project: Project | null; parent?: string | null }
  | { kind: 'label'; label: Label | null }
  | { kind: 'share'; project: Project }
  | { kind: 'view'; view: SavedView | null }
  | { kind: 'help' }
  | { kind: 'deleteMatching' }
  | null

export default function TasksPage() {
  const qc = useQueryClient()
  const overview = useOverview().data
  const [showArchived, setShowArchived] = usePref<boolean>('app.tasks.showArchived', false)
  const projects = useProjects(showArchived).data
  const views = useSavedViews().data
  const labels = useLabels().data
  const me = useMe().data
  const hidden = useHiddenTasks()
  const url = useTasksUrl(projects, overview)
  const { state, layout, update } = url
  const isList = layout === 'list'
  const isTable = layout === 'table'
  const isBoard = layout === 'board'
  const rowsLayout = isList || isTable

  const saved = views?.find((v) => v.id === state.saved)
  const project = projects?.find((p) => p.id === state.project) ?? (state.view === 'inbox' ? projects?.find((p) => p.is_inbox) : undefined)
  const projectList = !!state.project || state.view === 'inbox'
  const doneView = state.view === 'done'
  const data = useListData({
    state,
    layout,
    filters: { label: url.labelFilter, prio: url.prioMin, assignee: url.assignee },
    sortChosen: url.sortChosen,
    showCompleted: url.showCompleted,
    overview,
    saved,
    hidden,
  })
  const { params, tasks, items, open, doneList, total, doneTotal, tlItems } = data
  const showDone = url.showCompleted && !doneView

  const setDone = useSetDone()
  const updateTask = useUpdateTask()
  const ops = useBulkOps()
  const deleteLater = useDeleteWithUndo()
  const [dialog, setDialog] = useState<DialogState>(null)
  const closeDialog = () => setDialog(null)
  const [selected, setSelected] = useState<string | null>(null) // keyboard cursor
  const [editing, setEditing] = useState<string | null>(null)
  const [addingSub, setAddingSub] = useState<string | null>(null)
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(() => new Set())
  const [collapsedTasks, setCollapsedTasks] = usePref<string[]>(COLLAPSED_TASKS, [])
  const collapsedSet = useMemo(() => new Set(collapsedTasks), [collapsedTasks])
  const [focus, setFocus] = useState(false)
  const sel = useSelection()
  // "Select all N matching": the selection as it was when chosen; any other change drops back to ids.
  const [matching, setMatching] = useState<Set<string> | null>(null)
  const touch = useMediaQuery('(hover: none)')
  /** The board's cards in column order, as it last drew them (selection, keyboard and bulk bar use it). */
  const boardOrder = useRef<() => Task[]>(() => [])

  // A new list (or filter, or layout) starts with nothing selected, no open sections collapsed, no focus mode.
  const listId = `${state.project}|${state.view}|${state.saved}`
  const { clear: clearSel } = sel
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the list, its filters or the layout change
  useEffect(() => clearSel(), [listId, state.q, url.labelFilter, url.prioMin, url.assignee, layout, clearSel])
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the list changes
  useEffect(() => {
    setCollapsedSections(new Set())
    setSelected(null)
  }, [listId])
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the list or layout changes
  useEffect(() => {
    if (!isList) setFocus(false)
  }, [isList, listId])
  useEffect(() => {
    document.body.classList.toggle(FOCUS_BODY, focus)
    return () => document.body.classList.remove(FOCUS_BODY)
  }, [focus])

  const title = state.project
    ? (project?.name ?? 'Project')
    : state.saved
      ? (saved?.name ?? 'Saved view')
      : (VIEWS.find((v) => v.id === state.view)?.label ?? 'Tasks')
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
  const nested = useMemo(() => nestTasks(projectList ? open : items), [projectList, open, items])
  const groups = useMemo(
    () =>
      groupTasks({
        view: state.view,
        items,
        roots: nested.roots,
        grouping: url.grouping,
        projectList,
        sort: state.sort,
        projectLabel: (id) => (byId.get(id)?.is_inbox ? 'Inbox' : (pathOf.get(id) ?? 'Project')),
      }),
    [items, nested, state.view, state.sort, projectList, url.grouping, pathOf, byId],
  )

  /** Row order on screen, for Shift-click ranges, Ctrl+A and j/k. */
  const order = useMemo(() => {
    const visible = (list: Task[]): Task[] =>
      list.flatMap((t) => [t, ...(collapsedSet.has(t.id) ? [] : visible(nested.kids.get(t.id) ?? []))])
    const flat = groups.filter((g) => !collapsedSections.has(g.key)).flatMap((g) => (doneView ? g.items : visible(g.items)))
    return [...flat, ...(showDone ? doneList : [])].map((t) => t.id)
  }, [groups, collapsedSections, collapsedSet, nested, doneView, showDone, doneList])
  const tableTasks = useMemo(
    () => (doneView ? items : [...open, ...(showDone ? doneList : [])]),
    [doneView, items, open, showDone, doneList],
  )
  const navOrder = (): string[] =>
    isTable
      ? tableTasks.map((t) => t.id)
      : isBoard
        ? boardOrder.current().map((t) => t.id)
        : layout === 'timeline'
          ? tlItems.filter((t) => t.due || t.start).map((t) => t.id)
          : order
  const taskById = useMemo(() => new Map([...items, ...doneList, ...tlItems].map((t) => [t.id, t])), [items, doneList, tlItems])
  const findTask = (id: string | null): Task | undefined => (id ? (taskById.get(id) ?? cachedTask(qc, id)) : undefined)
  const pool = isBoard ? boardOrder.current() : isTable ? tableTasks : [...items, ...doneList]
  const picked = sel.ids.size ? pool.filter((t) => sel.ids.has(t.id)) : []
  // "Select all N matching" is offered once every loaded row of the list is selected and more exist.
  const canMatch = rowsLayout && !!params && total > items.length && sel.ids.size > 0 && items.every((t) => sel.ids.has(t.id))
  const matchingOn = !!matching && matching === sel.ids && canMatch
  const bulkTarget = (ids: string[]): BulkTarget => (matchingOn && params ? { filter: bulkFilter(params), total } : ids)

  const toggle = (t: Task) => setDone.mutate({ task: t, done: !t.done })
  // Keep each task's time of day, move the date to today (an earlier time today becomes "today", 23:59).
  // One bulk request per distinct new due time (not one per task).
  const rescheduleToToday = (list: Task[]) => {
    const now = new Date()
    const byDue = new Map<string, string[]>()
    for (const t of list) {
      if (!t.due) continue
      const d = new Date(t.due)
      d.setFullYear(now.getFullYear(), now.getMonth(), now.getDate())
      if (d < now) d.setHours(23, 59, 0, 0)
      byDue.set(d.toISOString(), [...(byDue.get(d.toISOString()) ?? []), t.id])
    }
    for (const [due, ids] of byDue) ops.update(ids, { due })
    toast.show(`Moved ${plural(list.length, 'task')} to today`)
  }
  const openTask = (t: Task) => {
    if (isTempId(t.id)) return
    setSelected(t.id)
    update({ task: t.id })
  }
  const listKey = params ? keys.taskPages(params) : undefined

  // ---------------------------------------------------------------- quick add: context and "Added to …"
  const quickCreated = (t: Task) => {
    const body: { favorite?: boolean; assignees?: string[]; labels?: number[] } = {}
    if (state.view === 'favorites') body.favorite = true
    if (state.view === 'assigned' && me) body.assignees = [me.username]
    const extraLabels = url.labelIds.map(Number).filter((id) => !t.labels.includes(id))
    if (extraLabels.length) body.labels = [...t.labels, ...extraLabels]
    if (Object.keys(body).length) updateTask.mutate({ id: t.id, body })
    const after = applyPatch(t, body, me ? [meAsUser(me)] : [])
    const fits = params && !isBoard && layout !== 'calendar' ? fitsList(after, params, me?.username) : true
    if (fits === false) {
      const p = t.project_id ? byId.get(t.project_id) : undefined
      toast.show(`Added "${t.title}" to ${p ? projectName(p) : 'a project'}`, {
        action: { label: 'Open', run: () => update({ task: t.id }) },
      })
    }
  }

  // ---------------------------------------------------------------- drag and drop (list rows)
  const canReorder =
    projectList &&
    state.sort === 'position' &&
    groups.length === 1 &&
    groups[0]?.key === 'all' &&
    !state.q &&
    !url.labelFilter &&
    !url.prioMin &&
    !url.assignee &&
    (project?.role ?? 2) >= 1
  const drop = useListDrop({
    reorderProject: state.project ?? (state.view === 'inbox' ? (overview?.inbox_id ?? '') : ''),
    canReorder,
    groups,
    order,
    sel,
    taskById,
    byId,
    ops,
    doneView,
    today: startOfDay(new Date()),
  })

  // ---------------------------------------------------------------- keyboard (classic keys)
  useTaskCommands({
    url,
    sel,
    selected,
    setSelected,
    navOrder,
    findTask,
    setEditing,
    ops,
    bulkTarget,
    matchingOn,
    deleteLater,
    setDone,
    focus,
    setFocus,
    openHelp: () => setDialog({ kind: 'help' }),
    confirmDeleteMatching: () => setDialog({ kind: 'deleteMatching' }),
  })

  // ---------------------------------------------------------------- list rows
  const toggleCollapsedTask = (id: string) =>
    setCollapsedTasks((list) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id].slice(-500)))
  // Rows are memoized (ListRow); their handlers go through this ref, so they always see the latest page state.
  const rowActs = useRef<RowActions>(null as unknown as RowActions)
  rowActs.current = {
    sel,
    order,
    toggle,
    open: openTask,
    rename: (id) => setEditing(id),
    startDrag: drop.startDrag,
    endDrag: drop.endDrag,
    finishEdit: (t, v) => {
      setEditing(null)
      if (v && v !== t.title) updateTask.mutate({ id: t.id, body: { title: v } })
    },
    addSub: (t, collapsed) => {
      setAddingSub(t.id)
      if (collapsed) toggleCollapsedTask(t.id)
    },
    toggleCollapsed: toggleCollapsedTask,
  }
  const firstRoot = focus ? groups.find((g) => g.items.length && !collapsedSections.has(g.key))?.items[0]?.id : undefined
  const renderRow = (it: Extract<VItem, { kind: 'row' }>): ReactNode => {
    const t = it.t
    const editable = canEditTask(t, me, projects) && !isTempId(t.id)
    return (
      <ListRow
        key={t.id}
        t={t}
        depth={it.depth}
        nKids={it.nKids}
        root={it.root}
        showProject={it.showProject}
        collapsed={collapsedSet.has(t.id)}
        project={t.project_id ? byId.get(t.project_id) : undefined}
        projectPath={t.project_id ? pathOf.get(t.project_id) : undefined}
        labels={labels}
        picked={sel.ids.has(t.id)}
        selected={sel.ids.has(t.id) || t.id === state.task || t.id === selected}
        canRename={editable && !doneView}
        canDrag={!touch && editable && !doneView && editing !== t.id}
        canAddSub={editable && !t.done && !doneView}
        editing={editing === t.id}
        touch={touch}
        nextUp={it.root && t.id === firstRoot}
        acts={rowActs}
      />
    )
  }
  // Load the next page when the end of the list comes near.
  const moreRef = useRef<HTMLDivElement>(null)
  const doneMoreRef = useRef<HTMLDivElement>(null)
  const { done } = data
  useLoadMore(moreRef, rowsLayout && !!tasks.hasNextPage && !tasks.isFetchingNextPage, () => tasks.fetchNextPage(), [items.length])
  useLoadMore(doneMoreRef, rowsLayout && !tasks.hasNextPage && !!done.hasNextPage && !done.isFetchingNextPage, () => done.fetchNextPage(), [
    doneList.length,
  ])

  const filtersActive = !!(url.labelFilter || url.prioMin || url.assignee || state.q)
  const savedDirty =
    !!saved && (!!url.labelFilter || !!url.prioMin || !!url.assignee || url.sortChosen || (!!state.q && state.q !== saved.filters.q))
  const saveView = useUpdateSavedView(params, url.reset)
  const updateSaved = (v: SavedView) => saveView.mutate(v)
  const doneTodayN = overview?.done_today ?? 0 // "X of Y done today" (from the overview, no extra request)
  const totalOpen = doneView ? 0 : total
  // A project's done count: the done query's total when it's loaded, else the project's own count (unfiltered).
  const projectDone = doneTotal ?? (filtersActive ? null : (project?.done_count ?? null))
  const projectPct = projectDone != null && total + projectDone ? Math.round((projectDone / (total + projectDone)) * 100) : 0
  const writable = canEditIn(project)
  const progress: [number, string, string?] | undefined =
    projectList && !isBoard && layout !== 'calendar' && tasks.data && projectDone != null && total + projectDone > 0
      ? [projectPct, `${total.toLocaleString()} open · ${projectDone.toLocaleString()} done`, `${projectPct}% complete`]
      : state.view === 'today' && !state.q && tasks.data && overview && doneTodayN + totalOpen > 0
        ? [Math.round((doneTodayN / (doneTodayN + totalOpen)) * 100), `${doneTodayN} of ${doneTodayN + totalOpen} done today`]
        : undefined
  const chips = filterChips(url, labels, me?.username)

  const sidebar = (
    <TasksSidebar
      overview={overview}
      projects={projects}
      labels={labels}
      views={views}
      showArchived={showArchived}
      toggleArchived={() => setShowArchived((v) => !v)}
      active={{ view: state.view, project: state.project, saved: state.saved, inbox: !!project?.is_inbox }}
      labelFilter={url.labelFilter}
      taskDrop={drop.projectDrop}
      taskOver={drop.drag?.over ?? null}
      onView={url.goView}
      onProject={(p) => update({ project: p.id, task: null })}
      // Like the classic label page: every open task with that label (click again to clear).
      onLabel={(l) => (url.labelFilter === String(l.id) ? url.setKeys({ label: null }) : url.reset({ view: 'all', label: String(l.id) }))}
      onSaved={(v) => update({ saved: v.id, task: null })}
      onNewProject={() => setDialog({ kind: 'project', project: null })}
      onEditProject={(p) => setDialog({ kind: 'project', project: p })}
      onAddSub={(p) => setDialog({ kind: 'project', project: null, parent: p.id })}
      onShare={(p) => setDialog({ kind: 'share', project: p })}
      onProjectDeleted={(p) => state.project === p.id && update({ view: 'today' })}
      onNewLabel={() => setDialog({ kind: 'label', label: null })}
      onEditLabel={(l) => setDialog({ kind: 'label', label: l })}
      onLabelDeleted={(l) =>
        url.labelIds.includes(String(l.id)) && url.setKeys({ label: url.labelIds.filter((x) => x !== String(l.id)).join(',') || null })
      }
      onSaveView={() => setDialog({ kind: 'view', view: null })}
      onRenameView={(v) => setDialog({ kind: 'view', view: v })}
      onUpdateView={savedDirty ? updateSaved : undefined}
      onViewDeleted={(v) => state.saved === v.id && update({ view: 'today' })}
    />
  )

  const navFirst = useRef<string | undefined>(undefined)
  navFirst.current = navOrder()[0]
  const commitSearch = useCallback((q: string) => update({ q }, true), [update])
  const searchEnter = useCallback(() => {
    if (navFirst.current) setSelected(navFirst.current)
  }, [])
  const topbar = (
    <div className="flex w-full items-center gap-2">
      <TaskSearch value={state.q} onCommit={commitSearch} onEnter={searchEnter} />
    </div>
  )

  const savedIndex = saved && views ? views.findIndex((v) => v.id === saved.id) : -1
  const share = (p: Project) => setDialog({ kind: 'share', project: p })
  const wide = layout === 'timeline' || layout === 'calendar' || isTable
  const sharing = dialog?.kind === 'share' ? dialog.project : null
  const tableLoading = !params || tasks.isPending
  return (
    <AppShell app="tasks" pageTitle={title} topbar={topbar} sidebar={sidebar} fullHeight>
      <div
        className={
          isBoard
            ? 'mx-auto flex h-full max-w-none flex-col px-6 pt-4 pb-3 max-md:px-3 max-md:pt-3'
            : focus
              ? 'mx-auto max-w-176 px-6 pt-8 pb-12 max-md:px-3 max-md:pb-8'
              : `mx-auto ${wide ? 'max-w-none' : 'max-w-224'} px-6 pt-4 pb-12 max-md:px-3 max-md:pt-3 max-md:pb-8`
        }
      >
        <TasksHeader
          title={title}
          project={project}
          savedView={!!saved}
          count={rowsLayout && tasks.data ? total : undefined}
          progress={progress}
          focus={focus}
          onFocus={isList ? () => setFocus((f) => !f) : undefined}
          onShare={() => project && share(project)}
          menu={
            project ? (
              <ProjectMenu
                project={project}
                trigger="header"
                onEdit={() => setDialog({ kind: 'project', project })}
                onShare={() => share(project)}
                onAddSub={() => setDialog({ kind: 'project', project: null, parent: project.id })}
                onDeleted={() => update({ view: 'today' })}
              />
            ) : saved && views ? (
              <ViewMenu
                header
                view={saved}
                prev={views[savedIndex - 1]}
                next={views[savedIndex + 1]}
                before={views[savedIndex - 2]}
                after={views[savedIndex + 2]}
                onRename={() => setDialog({ kind: 'view', view: saved })}
                onUpdate={savedDirty ? () => updateSaved(saved) : undefined}
                onDeleted={() => update({ view: 'today' })}
              />
            ) : undefined
          }
          onHelp={() => setDialog({ kind: 'help' })}
        />

        {!focus && (
          <TasksToolbar
            url={url}
            layout={layout}
            isProject={!!state.project}
            projectList={projectList}
            labels={labels}
            me={me?.username}
            sort={params?.sort as Sort | undefined}
            chips={chips}
            canSaveView={filtersActive && !state.saved}
            canUpdateView={savedDirty && !!saved}
            updatePending={saveView.isPending}
            onSaveView={() => setDialog({ kind: 'view', view: null })}
            onUpdateView={() => saved && updateSaved(saved)}
          />
        )}

        {!doneView && (rowsLayout || layout === 'timeline' || (isBoard && writable)) && (
          // `tasks-quick` is the hook the "q" shortcut focuses.
          <div className="tasks-quick mb-2">
            <QuickAddInput
              key={(state.project ?? state.view ?? state.saved ?? '') + layout}
              projectId={state.project ?? (state.view === 'inbox' ? overview?.inbox_id : null)}
              defaultToday={state.view === 'today'}
              listKey={isBoard ? undefined : listKey} // a board add lands in its first column's list via the settle
              onCreated={quickCreated}
              placeholder={
                state.view === 'today'
                  ? 'Add a task for today…  e.g. "Call mom 5pm !3"'
                  : 'Add a task…  try "Pay rent tomorrow 5pm *bills +Home !3 every month"'
              }
            />
          </div>
        )}

        <Suspense fallback={<SkeletonRows rows={8} />}>
          {isBoard && state.project ? (
            <Board
              projectId={state.project}
              labels={labels}
              q={state.q}
              onOpen={openTask}
              writable={writable}
              hidden={hidden}
              sel={sel}
              selected={state.task ?? selected}
              orderRef={boardOrder}
            />
          ) : layout === 'calendar' ? (
            !params ? (
              <SkeletonRows rows={8} />
            ) : (
              <Calendar
                base={params}
                labels={labels}
                projectId={state.project ?? (state.view === 'inbox' ? (overview?.inbox_id ?? null) : null)}
                hidden={hidden}
                onOpen={openTask}
                selected={state.task}
              />
            )
          ) : layout === 'timeline' ? (
            !params ? (
              <SkeletonRows rows={8} />
            ) : (
              <QueryView query={data.timeline} skeleton={<SkeletonRows rows={8} />}>
                {() => <Timeline tasks={tlItems} onOpen={openTask} selected={state.task ?? selected} />}
              </QueryView>
            )
          ) : isTable ? (
            tableLoading ? (
              <SkeletonRows rows={8} />
            ) : (
              <QueryView query={tasks} skeleton={<SkeletonRows rows={8} />}>
                {() => (
                  <>
                    <TaskTable
                      tasks={tableTasks}
                      total={total + (showDone ? (doneTotal ?? 0) : 0)}
                      more={!!tasks.hasNextPage || !!done.hasNextPage}
                      labels={labels}
                      pathOf={pathOf}
                      onOpen={openTask}
                      onToggle={toggle}
                      selected={state.task ?? selected}
                      sel={sel}
                      sort={doneView ? undefined : (params?.sort as Sort | undefined)}
                      onSort={doneView ? undefined : url.setSort}
                    />
                    <div ref={moreRef} aria-hidden="true" />
                    {(tasks.isFetchingNextPage || done.isFetchingNextPage) && <SkeletonRows rows={3} />}
                    <div ref={doneMoreRef} aria-hidden="true" />
                  </>
                )}
              </QueryView>
            )
          ) : (
            <ListView
              title={title}
              view={state.view}
              query={{
                pending: !params || tasks.isPending,
                error: tasks.error,
                loaded: !!tasks.data,
                more: !!tasks.hasNextPage,
                fetchingMore: tasks.isFetchingNextPage,
                retry: () => tasks.refetch(),
              }}
              q={state.q}
              groups={groups}
              kids={nested.kids}
              collapsedSections={collapsedSections}
              toggleSection={(key) =>
                setCollapsedSections((s) => {
                  const n = new Set(s)
                  if (n.has(key)) n.delete(key)
                  else n.add(key)
                  return n
                })
              }
              collapsedTasks={collapsedSet}
              addingSub={addingSub}
              stopAddingSub={() => setAddingSub(null)}
              listKey={listKey}
              projectList={projectList}
              grouping={url.grouping}
              completed={
                showDone
                  ? {
                      shown: true,
                      rows: doneList,
                      total: doneTotal,
                      pending: done.isPending && !!data.doneParams,
                      fetchingMore: done.isFetchingNextPage,
                    }
                  : { shown: false, count: url.showCompleted ? 0 : (projectDone ?? 0) }
              }
              selecting={sel.ids.size > 0}
              drop={drop}
              renderRow={renderRow}
              moreRef={moreRef}
              doneMoreRef={doneMoreRef}
              hint={canReorder && open.length > 1 && !touch}
              onReschedule={rescheduleToToday}
              onShowCompleted={() => url.setKeys({ done: '1' })}
            />
          )}
        </Suspense>
      </div>
      {(rowsLayout || isBoard) && picked.length > 0 && !focus && (
        <BulkBar
          tasks={picked}
          target={bulkTarget(picked.map((t) => t.id))}
          projects={projects}
          labels={labels}
          onClear={() => {
            sel.clear()
            setMatching(null)
          }}
          matchTotal={canMatch && !matchingOn ? total : undefined}
          onMatch={() => setMatching(sel.ids)}
          onUnmatch={matchingOn ? () => setMatching(null) : undefined}
        />
      )}
      <Confirm
        open={dialog?.kind === 'deleteMatching'}
        title={`Delete ${plural(total, 'task')}?`}
        body="Every task matching this list is deleted, with its subtasks. This can't be undone."
        confirmLabel="Delete"
        onConfirm={() => {
          ops.remove(bulkTarget([]))
          sel.clear()
          setMatching(null)
        }}
        onClose={closeDialog}
      />
      <TaskDrawer id={state.task} onClose={() => update({ task: null })} onOpen={(id) => update({ task: id })} />
      <ProjectDialog
        open={dialog?.kind === 'project'}
        project={dialog?.kind === 'project' ? dialog.project : null}
        parentId={dialog?.kind === 'project' ? dialog.parent : undefined}
        projects={projects}
        onClose={closeDialog}
        onCreated={(p) => update({ project: p.id, task: null })}
      />
      <LabelDialog open={dialog?.kind === 'label'} label={dialog?.kind === 'label' ? dialog.label : null} onClose={closeDialog} />
      <ShareDialog
        project={sharing && (byId.get(sharing.id) ?? sharing)}
        onClose={closeDialog}
        onLeft={() => state.project === sharing?.id && update({ view: 'today' })}
      />
      <SaveViewDialog
        open={dialog?.kind === 'view'}
        view={dialog?.kind === 'view' ? dialog.view : undefined}
        params={params}
        position={(views?.at(-1)?.position ?? 0) + 1}
        onClose={closeDialog}
        onSaved={(v) => dialog?.kind === 'view' && !dialog.view && update({ saved: v.id, task: null })}
      />
      <ShortcutsDialog open={dialog?.kind === 'help'} onClose={closeDialog} />
    </AppShell>
  )
}

/** "Update view": store the list's current filters in the saved view, then show it as saved. */
function useUpdateSavedView(params: ReturnType<typeof useListData>['params'], reset: (p: Record<string, string>) => void) {
  const save = useSaveView()
  return {
    isPending: save.isPending,
    mutate: (v: SavedView) =>
      save.mutate(
        { id: v.id, body: { filters: viewFilters(params) } },
        {
          onSuccess: () => {
            toast.show('View updated')
            reset({ saved: v.id })
          },
        },
      ),
  }
}
