// Tasks sidebar: smart views with counts, the project tree (collapse, favourites first, drag to reorder
// or nest, drop tasks onto a project to move them), labels and saved views (rename, update, reorder, delete).
import { useState, type DragEvent, type ReactNode } from 'react'
import { SideItem, SideSection } from '../../components/AppShell'
import { Icon } from '../../components/Icon'
import { Confirm, Menu, MenuItem } from '../../components/ui'
import type { Label, Overview, Project, SavedView } from '../../lib/types'
import type { SmartView } from '../../lib/qs'
import { LabelMenu } from './Labels'
import { ProjectMenu } from './ProjectDialog'
import { useDeleteView, useSaveProject, useSaveView } from './api'

export const VIEWS: { id: SmartView; label: string; icon: string; count?: (o: Overview) => number; hint?: string }[] = [
  { id: 'inbox', label: 'Inbox', icon: 'inbox', count: (o) => o.inbox },
  { id: 'today', label: 'Today', icon: 'sun', count: (o) => o.today },
  { id: 'upcoming', label: 'Upcoming', icon: 'calendar', count: (o) => o.upcoming },
  { id: 'overdue', label: 'Overdue', icon: 'alert', count: (o) => o.overdue },
  { id: 'nodate', label: 'No date', icon: 'clock', count: (o) => o.no_date },
  { id: 'favorites', label: 'Favourites', icon: 'star', count: (o) => o.favorites },
  { id: 'assigned', label: 'Assigned to me', icon: 'user', count: (o) => o.assigned },
  { id: 'all', label: 'All open tasks', icon: 'layers' },
  { id: 'done', label: 'Completed', icon: 'check', count: (o) => o.done_this_week, hint: 'completed in the last 7 days' },
]

const COLLAPSED_KEY = 'app.tasks.collapsedProjects'
const readSet = (k: string) => { try { return new Set<string>(JSON.parse(localStorage.getItem(k) || '[]')) } catch { return new Set<string>() } }

/** Children of `parent` in sidebar order: favourites first, then position, then name. */
export function childrenOf(projects: Project[], parent: string | null, showArchived: boolean): Project[] {
  const list = projects.filter((p) => !p.is_inbox && (showArchived || !p.archived))
  const ids = new Set(list.map((p) => p.id))
  return list.filter((p) => (p.parent_id && ids.has(p.parent_id) ? p.parent_id : null) === parent)
    .sort((a, b) => Number(b.favorite) - Number(a.favorite) || a.position - b.position || a.name.localeCompare(b.name))
}

/** The PATCH for dropping project `moving` before/after/inside `target`, or null (no-op / own subtree). */
export function treeDrop(projects: Project[], moving: Project, target: Project, where: 'before' | 'after' | 'inside', showArchived: boolean) {
  for (let n: Project | undefined = target, i = 0; n && i < 50; n = projects.find((p) => p.id === n!.parent_id), i++) if (n.id === moving.id) return null
  if (where === 'inside') {
    const sibs = childrenOf(projects, target.id, showArchived).filter((p) => p.id !== moving.id)
    return { parent_id: target.id, position: (sibs.at(-1)?.position ?? 0) + 1 }
  }
  const parent = target.parent_id && projects.some((p) => p.id === target.parent_id) ? target.parent_id : null
  const sibs = childrenOf(projects, parent, showArchived).filter((p) => p.id !== moving.id)
  const i = sibs.findIndex((p) => p.id === target.id)
  const [a, b] = where === 'before' ? [sibs[i - 1], sibs[i]] : [sibs[i], sibs[i + 1]]
  const position = a && b ? (a.position + b.position) / 2 : a ? a.position + 1 : b ? b.position - 1 : 1
  return { parent_id: parent, position }
}

export function TasksSidebar({ overview, projects, labels, views, showArchived, toggleArchived, active, labelFilter, taskDrop, taskOver,
  onView, onProject, onLabel, onSaved, onNewProject, onEditProject, onAddSub, onShare, onProjectDeleted, onNewLabel, onEditLabel, onLabelDeleted,
  onSaveView, onRenameView, onUpdateView, onViewDeleted }: {
  overview?: Overview; projects?: Project[]; labels?: Label[]; views?: SavedView[]; showArchived: boolean; toggleArchived: () => void
  active: { view: SmartView | null; project: string | null; saved: string | null; inbox: boolean }
  labelFilter: string
  /** Drop handlers for dragged tasks (from the page), keyed by project. */
  taskDrop: (p: Project | undefined) => Record<string, unknown>
  taskOver: string | null
  onView: (v: SmartView) => void; onProject: (p: Project) => void; onLabel: (l: Label) => void; onSaved: (v: SavedView) => void
  onNewProject: () => void; onEditProject: (p: Project) => void; onAddSub: (p: Project) => void; onShare: (p: Project) => void; onProjectDeleted: (p: Project) => void
  onNewLabel: () => void; onEditLabel: (l: Label) => void; onLabelDeleted: (l: Label) => void
  onSaveView: () => void; onRenameView: (v: SavedView) => void; onUpdateView?: (v: SavedView) => void; onViewDeleted: (v: SavedView) => void
}) {
  const [collapsed, setCollapsed] = useState(() => readSet(COLLAPSED_KEY))
  const [pdrag, setPdrag] = useState<{ id: string; over: string | null; where: 'before' | 'after' | 'inside' } | null>(null)
  const saveProject = useSaveProject()
  const all = projects ?? []
  const inbox = all.find((p) => p.is_inbox)
  const toggle = (id: string) => setCollapsed((s) => {
    const n = new Set(s)
    if (n.has(id)) n.delete(id); else n.add(id)
    try { localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...n])) } catch { /* ignore */ }
    return n
  })

  const projDrag = (p: Project) => p.role >= 2 ? {
    draggable: true,
    onDragStart: (e: DragEvent) => { e.dataTransfer.setData('text/x-project', p.id); e.dataTransfer.effectAllowed = 'move'; setTimeout(() => setPdrag({ id: p.id, over: null, where: 'inside' }), 0) },
    onDragEnd: () => setPdrag(null),
  } : {}
  const projTarget = (p: Project) => {
    if (!pdrag) return taskDrop(p)
    return {
      onDragOver: (e: DragEvent<HTMLElement>) => {
        if (p.id === pdrag.id) return
        e.preventDefault()
        const r = e.currentTarget.getBoundingClientRect()
        const f = (e.clientY - r.top) / r.height
        const where = f < 0.3 ? 'before' : f > 0.7 ? 'after' : 'inside'
        if (pdrag.over !== p.id || pdrag.where !== where) setPdrag({ ...pdrag, over: p.id, where })
      },
      onDrop: (e: DragEvent) => {
        e.preventDefault()
        const moving = all.find((x) => x.id === pdrag.id)
        const patch = moving && pdrag.over === p.id ? treeDrop(all, moving, p, pdrag.where, showArchived) : null
        if (moving && patch) {
          saveProject.mutate({ id: moving.id, body: patch })
          if (pdrag.where === 'inside' && collapsed.has(p.id)) toggle(p.id)
        }
        setPdrag(null)
      },
    }
  }

  const tree = (parent: string | null, depth: number): ReactNode[] => childrenOf(all, parent, showArchived).flatMap((p) => {
    const kids = childrenOf(all, p.id, showArchived)
    const open = !collapsed.has(p.id)
    const mark = pdrag?.over === p.id ? ' tree-' + pdrag.where : ''
    return [
      <div key={p.id} className={'side-proj side-drop' + (p.archived ? ' archived' : '') + (taskOver === 'side:' + p.id ? ' over' : '') + mark + (pdrag?.id === p.id ? ' dragging' : '')}
        style={{ paddingLeft: `${depth * 0.875}rem` }} data-pid={p.id} {...projDrag(p)} {...projTarget(p)}>
        {kids.length ? (
          <button className="side-twisty" onClick={() => toggle(p.id)} aria-label={open ? `Collapse ${p.name}` : `Expand ${p.name}`} aria-expanded={open}>
            <Icon name={open ? 'chevronDown' : 'chevronRight'} size={12} />
          </button>
        ) : <span className="side-twisty" />}
        <SideItem
          colour={p.colour || 'var(--app-muted)'}
          label={<>{p.name}{p.favorite && <Icon name="star" size={11} className="side-fav" title="Favourite" />}{p.shared && <Icon name="users" size={12} className="side-shared" title="Shared" />}{p.archived && <> <span className="chip">Archived</span></>}</>}
          count={p.archived ? undefined : p.open_count}
          active={active.project === p.id}
          onClick={() => onProject(p)}
        />
        <ProjectMenu project={p} onEdit={() => onEditProject(p)} onShare={() => onShare(p)} onAddSub={() => onAddSub(p)} onDeleted={() => onProjectDeleted(p)} />
      </div>,
      ...(open && depth < 6 ? tree(p.id, depth + 1) : []),
    ]
  })

  return (
    <>
      <SideSection>
        {VIEWS.map((v) => {
          const n = overview && v.count ? v.count(overview) : 0
          const item = (
            <SideItem
              key={v.id}
              icon={v.icon}
              label={v.label}
              active={active.view === v.id || (v.id === 'inbox' && active.inbox)}
              count={n ? (v.id === 'overdue' ? <span className="danger-count">{n}</span> : v.hint ? <span title={v.hint}>{n}</span> : n) : undefined}
              onClick={() => onView(v.id)}
            />
          )
          return v.id === 'inbox' ? <div key={v.id} className={'side-drop' + (taskOver === 'side:' + inbox?.id ? ' over' : '')} {...taskDrop(inbox)}>{item}</div> : item
        })}
      </SideSection>
      <SideSection
        title="Projects"
        action={<button className="btn ghost icon sm" onClick={onNewProject} aria-label="New project" title="New project"><Icon name="plus" size={14} /></button>}
      >
        {all.filter((p) => !p.is_inbox).length === 0 && <div className="side-empty">No projects yet.</div>}
        {tree(null, 0)}
        <button className="side-more-link" onClick={toggleArchived}>{showArchived ? 'Hide archived' : 'Show archived'}</button>
      </SideSection>
      <SideSection
        title="Labels"
        action={<button className="btn ghost icon sm" onClick={onNewLabel} aria-label="New label" title="New label"><Icon name="plus" size={14} /></button>}
      >
        {!labels?.length && <div className="side-empty">Type *label in quick add.</div>}
        {labels?.map((l) => (
          <div key={l.id} className="side-proj">
            <SideItem colour={l.colour || 'var(--app-muted)'} label={l.name} active={labelFilter.split(',').includes(String(l.id))} onClick={() => onLabel(l)} />
            <LabelMenu label={l} onEdit={() => onEditLabel(l)} onDeleted={() => onLabelDeleted(l)} />
          </div>
        ))}
      </SideSection>
      <SideSection
        title="Saved views"
        action={<button className="btn ghost icon sm" onClick={onSaveView} aria-label="Save current view" title="Save the current list and filters as a view"><Icon name="plus" size={14} /></button>}
      >
        {!views?.length && <div className="side-empty">Filter a list, then save it with +.</div>}
        {views?.map((v, i) => (
          <div key={v.id} className="side-proj">
            <SideItem icon="filter" label={v.name} active={active.saved === v.id} onClick={() => onSaved(v)} />
            <ViewMenu view={v} prev={views[i - 1]} next={views[i + 1]} after={views[i + 2]} before={views[i - 2]} onRename={() => onRenameView(v)} onUpdate={onUpdateView && active.saved === v.id ? () => onUpdateView(v) : undefined} onDeleted={() => onViewDeleted(v)} />
          </div>
        ))}
      </SideSection>
    </>
  )
}

/** Saved view options: rename, save the current filters into it, move up/down, delete. */
export function ViewMenu({ view, prev, next, before, after, onRename, onUpdate, onDeleted, header }: {
  view: SavedView; prev?: SavedView; next?: SavedView; before?: SavedView; after?: SavedView
  onRename: () => void; onUpdate?: () => void; onDeleted?: () => void; header?: boolean
}) {
  const save = useSaveView()
  const remove = useDeleteView()
  const [confirm, setConfirm] = useState(false)
  const mid = (a?: number, b?: number) => (a == null ? (b ?? 0) - 1 : b == null ? a + 1 : (a + b) / 2)
  return (
    <>
      <Menu align="end" label={`${view.name} options`} trigger={(p) => header
        ? <button {...p} className="btn ghost icon sm" aria-label="View options" title="View options"><Icon name="more" size={16} /></button>
        : <button {...p} className="btn ghost icon sm side-more" aria-label={`${view.name} options`}><Icon name="more" size={14} /></button>}>
        {(close) => (
          <>
            <MenuItem icon="edit" onClick={() => (close(), onRename())}>Rename…</MenuItem>
            {onUpdate && <MenuItem icon="filter" onClick={() => (close(), onUpdate())}>Save current filters to this view</MenuItem>}
            {prev && <MenuItem icon="arrowUp" onClick={() => (close(), save.mutate({ id: view.id, body: { position: mid(before?.position, prev.position) } }))}>Move up</MenuItem>}
            {next && <MenuItem icon="arrowDown" onClick={() => (close(), save.mutate({ id: view.id, body: { position: mid(next.position, after?.position) } }))}>Move down</MenuItem>}
            <div className="menu-sep" />
            <MenuItem icon="trash" danger onClick={() => (close(), setConfirm(true))}>Delete view</MenuItem>
          </>
        )}
      </Menu>
      <Confirm open={confirm} title={`Delete "${view.name}"?`} body="Only the saved filters are deleted; the tasks stay." onConfirm={() => remove.mutate(view.id, { onSuccess: onDeleted })} onClose={() => setConfirm(false)} />
    </>
  )
}
