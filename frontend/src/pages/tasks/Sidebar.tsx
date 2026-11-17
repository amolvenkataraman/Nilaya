// Tasks sidebar: smart views with counts, the project tree (collapse, favourites first, drag to reorder
// or nest, drop tasks onto a project to move them), labels and saved views (rename, update, reorder, delete).
import { useState, type DragEvent, type ReactNode } from 'react'
import { SideItem, SideSection } from '../../components/AppShell'
import { Icon } from '../../components/Icon'
import { Button, Confirm, Menu, MenuItem, MenuSeparator } from '../../components/ui'
import { cn } from '../../lib/cn'
import type { SmartView } from '../../lib/qs'
import { usePref } from '../../lib/storage'
import type { Label, Overview, Project, SavedView } from '../../lib/types'
import { useDeleteView, useSaveProject, useSaveView } from './api'
import { allowDrop, beginDrag } from './dnd'
import { LabelMenu, sideMore } from './Labels'
import { between } from './order'
import { ProjectMenu } from './ProjectDialog'
import { isProjectAdmin } from './task'

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
/** A sidebar row with a "…" menu, which takes the count's place while hovered (always on touch screens).
 *  `side-item` and `side-count` are AppShell's SideItem classes. */
const sideRow = 'group/side relative flex items-center [&_.side-item]:pr-8! hover:[&_.side-count]:invisible touch:[&_.side-count]:invisible'
const dropZone = 'rounded-sm transition-[background-color,box-shadow] duration-100'
const dropOver = 'bg-accent-soft shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--app-accent)_45%,transparent)]'
const sideEmpty = 'px-2 py-1 text-xs text-muted'
const twisty = '-mr-1 inline-flex h-6 w-4 flex-none items-center justify-center rounded-[3px] border-0 bg-transparent p-0 text-muted'

/** Children of `parent` in sidebar order: favourites first, then position, then name. */
export function childrenOf(projects: Project[], parent: string | null, showArchived: boolean): Project[] {
  const list = projects.filter((p) => !p.is_inbox && (showArchived || !p.archived))
  const ids = new Set(list.map((p) => p.id))
  return list
    .filter((p) => (p.parent_id && ids.has(p.parent_id) ? p.parent_id : null) === parent)
    .sort((a, b) => Number(b.favorite) - Number(a.favorite) || a.position - b.position || a.name.localeCompare(b.name))
}

/** The PATCH for dropping project `moving` before/after/inside `target`, or null (no-op / own subtree). */
export function treeDrop(
  projects: Project[],
  moving: Project,
  target: Project,
  where: 'before' | 'after' | 'inside',
  showArchived: boolean,
) {
  for (let n: Project | undefined = target, i = 0; n && i < 50; n = projects.find((p) => p.id === n?.parent_id), i++)
    if (n.id === moving.id) return null
  if (where === 'inside') {
    const sibs = childrenOf(projects, target.id, showArchived).filter((p) => p.id !== moving.id)
    return { parent_id: target.id, position: (sibs.at(-1)?.position ?? 0) + 1 }
  }
  const parent = target.parent_id && projects.some((p) => p.id === target.parent_id) ? target.parent_id : null
  const sibs = childrenOf(projects, parent, showArchived).filter((p) => p.id !== moving.id)
  const i = sibs.findIndex((p) => p.id === target.id)
  const [a, b] = where === 'before' ? [sibs[i - 1], sibs[i]] : [sibs[i], sibs[i + 1]]
  return { parent_id: parent, position: between(a?.position, b?.position) }
}

type DropHandlers = {
  onDragOver?: (e: DragEvent<HTMLElement>) => void
  onDragLeave?: (e: DragEvent<HTMLElement>) => void
  onDrop?: (e: DragEvent<HTMLElement>) => void
}

function AddButton({ label, title, onClick }: { label: string; title: string; onClick: () => void }) {
  return (
    <Button variant="ghost" size="sm" icon onClick={onClick} aria-label={label} title={title}>
      <Icon name="plus" size={14} />
    </Button>
  )
}

export function TasksSidebar({
  overview,
  projects,
  labels,
  views,
  showArchived,
  toggleArchived,
  active,
  labelFilter,
  taskDrop,
  taskOver,
  onView,
  onProject,
  onLabel,
  onSaved,
  onNewProject,
  onEditProject,
  onAddSub,
  onShare,
  onProjectDeleted,
  onNewLabel,
  onEditLabel,
  onLabelDeleted,
  onSaveView,
  onRenameView,
  onUpdateView,
  onViewDeleted,
}: {
  overview?: Overview
  projects?: Project[]
  labels?: Label[]
  views?: SavedView[]
  showArchived: boolean
  toggleArchived: () => void
  active: { view: SmartView | null; project: string | null; saved: string | null; inbox: boolean }
  labelFilter: string
  /** Drop handlers for dragged tasks (from the page), keyed by project. */
  taskDrop: (p: Project | undefined) => DropHandlers
  taskOver: string | null
  onView: (v: SmartView) => void
  onProject: (p: Project) => void
  onLabel: (l: Label) => void
  onSaved: (v: SavedView) => void
  onNewProject: () => void
  onEditProject: (p: Project) => void
  onAddSub: (p: Project) => void
  onShare: (p: Project) => void
  onProjectDeleted: (p: Project) => void
  onNewLabel: () => void
  onEditLabel: (l: Label) => void
  onLabelDeleted: (l: Label) => void
  onSaveView: () => void
  onRenameView: (v: SavedView) => void
  onUpdateView?: (v: SavedView) => void
  onViewDeleted: (v: SavedView) => void
}) {
  const [collapsedList, setCollapsed] = usePref<string[]>(COLLAPSED_KEY, [])
  const collapsed = new Set(collapsedList)
  const [pdrag, setPdrag] = useState<{ id: string; over: string | null; where: 'before' | 'after' | 'inside' } | null>(null)
  const saveProject = useSaveProject()
  const all = projects ?? []
  const inbox = all.find((p) => p.is_inbox)
  const toggle = (id: string) => setCollapsed((list) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]))

  const projDrag = (p: Project) =>
    isProjectAdmin(p)
      ? {
          draggable: true,
          onDragStart: (e: DragEvent) => beginDrag(e, 'project', p.id, () => setPdrag({ id: p.id, over: null, where: 'inside' })),
          onDragEnd: () => setPdrag(null),
        }
      : {}
  const projTarget = (p: Project): DropHandlers => {
    if (!pdrag) return taskDrop(p)
    return {
      onDragOver: (e) => {
        if (p.id === pdrag.id) return
        allowDrop(e)
        const r = e.currentTarget.getBoundingClientRect()
        const f = (e.clientY - r.top) / r.height
        const where = f < 0.3 ? 'before' : f > 0.7 ? 'after' : 'inside'
        if (pdrag.over !== p.id || pdrag.where !== where) setPdrag({ ...pdrag, over: p.id, where })
      },
      onDrop: (e) => {
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

  const tree = (parent: string | null, depth: number): ReactNode[] =>
    childrenOf(all, parent, showArchived).flatMap((p) => {
      const kids = childrenOf(all, p.id, showArchived)
      const open = !collapsed.has(p.id)
      const where = pdrag?.over === p.id ? pdrag.where : null
      return [
        <div
          key={p.id}
          className={cn(
            sideRow,
            dropZone,
            p.archived && '[&_.side-item]:opacity-60',
            (taskOver === `side:${p.id}` || where === 'inside') && dropOver,
            where === 'before' && 'shadow-[inset_0_2px_0_var(--app-accent)]',
            where === 'after' && 'shadow-[inset_0_-2px_0_var(--app-accent)]',
            pdrag?.id === p.id && 'opacity-50',
          )}
          style={{ paddingLeft: `${depth * 0.875}rem` }}
          data-pid={p.id}
          {...projDrag(p)}
          {...projTarget(p)}
        >
          {kids.length ? (
            <button
              type="button"
              className={cn(twisty, 'hover:bg-hover hover:text-fg')}
              onClick={() => toggle(p.id)}
              aria-label={open ? `Collapse ${p.name}` : `Expand ${p.name}`}
              aria-expanded={open}
            >
              <Icon name={open ? 'chevronDown' : 'chevronRight'} size={12} />
            </button>
          ) : (
            <span className={twisty} />
          )}
          <SideItem
            colour={p.colour || 'var(--app-muted)'}
            label={
              <>
                {p.name}
                {p.favorite && (
                  <Icon name="star" size={11} className="ml-1.25 inline align-[-1px] fill-current text-warning" title="Favourite" />
                )}
                {p.shared && <Icon name="users" size={12} className="ml-1.25 inline align-[-1px] text-muted" title="Shared" />}
                {p.archived && (
                  <>
                    {' '}
                    <span className="ml-1 inline-flex h-4 items-center rounded-full border border-border bg-surface-2 px-1.75 text-3xs font-medium whitespace-nowrap text-muted">
                      Archived
                    </span>
                  </>
                )}
              </>
            }
            count={p.archived ? undefined : p.open_count}
            active={active.project === p.id}
            onClick={() => onProject(p)}
          />
          <ProjectMenu
            project={p}
            onEdit={() => onEditProject(p)}
            onShare={() => onShare(p)}
            onAddSub={() => onAddSub(p)}
            onDeleted={() => onProjectDeleted(p)}
          />
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
              count={
                n ? (
                  v.id === 'overdue' ? (
                    <span className="font-semibold text-danger">{n}</span>
                  ) : v.hint ? (
                    <span title={v.hint}>{n}</span>
                  ) : (
                    n
                  )
                ) : undefined
              }
              onClick={() => onView(v.id)}
            />
          )
          return v.id === 'inbox' ? (
            <div key={v.id} className={cn(dropZone, taskOver === `side:${inbox?.id}` && dropOver)} {...taskDrop(inbox)}>
              {item}
            </div>
          ) : (
            item
          )
        })}
      </SideSection>
      <SideSection title="Projects" action={<AddButton label="New project" title="New project" onClick={onNewProject} />}>
        {all.filter((p) => !p.is_inbox).length === 0 && <div className={sideEmpty}>No projects yet.</div>}
        {tree(null, 0)}
        <button
          type="button"
          className="border-0 bg-transparent py-1 pr-2 pl-6 text-left text-xs text-muted hover:text-fg"
          onClick={toggleArchived}
        >
          {showArchived ? 'Hide archived' : 'Show archived'}
        </button>
      </SideSection>
      <SideSection title="Labels" action={<AddButton label="New label" title="New label" onClick={onNewLabel} />}>
        {!labels?.length && <div className={sideEmpty}>Type *label in quick add.</div>}
        {labels?.map((l) => (
          <div key={l.id} className={sideRow}>
            <SideItem
              colour={l.colour || 'var(--app-muted)'}
              label={l.name}
              active={labelFilter.split(',').includes(String(l.id))}
              onClick={() => onLabel(l)}
            />
            <LabelMenu label={l} onEdit={() => onEditLabel(l)} onDeleted={() => onLabelDeleted(l)} />
          </div>
        ))}
      </SideSection>
      <SideSection
        title="Saved views"
        action={<AddButton label="Save current view" title="Save the current list and filters as a view" onClick={onSaveView} />}
      >
        {!views?.length && <div className={sideEmpty}>Filter a list, then save it with +.</div>}
        {views?.map((v, i) => (
          <div key={v.id} className={sideRow}>
            <SideItem icon="filter" label={v.name} active={active.saved === v.id} onClick={() => onSaved(v)} />
            <ViewMenu
              view={v}
              prev={views[i - 1]}
              next={views[i + 1]}
              after={views[i + 2]}
              before={views[i - 2]}
              onRename={() => onRenameView(v)}
              onUpdate={onUpdateView && active.saved === v.id ? () => onUpdateView(v) : undefined}
              onDeleted={() => onViewDeleted(v)}
            />
          </div>
        ))}
      </SideSection>
    </>
  )
}

/** Saved view options: rename, save the current filters into it, move up/down, delete. */
export function ViewMenu({
  view,
  prev,
  next,
  before,
  after,
  onRename,
  onUpdate,
  onDeleted,
  header,
}: {
  view: SavedView
  prev?: SavedView
  next?: SavedView
  before?: SavedView
  after?: SavedView
  onRename: () => void
  onUpdate?: () => void
  onDeleted?: () => void
  header?: boolean
}) {
  const save = useSaveView()
  const remove = useDeleteView()
  const [confirm, setConfirm] = useState(false)
  const moveTo = (position: number) => save.mutate({ id: view.id, body: { position } })
  return (
    <>
      <Menu
        align="end"
        label={`${view.name} options`}
        trigger={(p) =>
          header ? (
            <Button {...p} variant="ghost" size="sm" icon aria-label="View options" title="View options">
              <Icon name="more" size={16} />
            </Button>
          ) : (
            <Button {...p} variant="ghost" size="sm" icon className={sideMore} aria-label={`${view.name} options`}>
              <Icon name="more" size={14} />
            </Button>
          )
        }
      >
        {(close) => {
          const act = (fn: () => void) => () => {
            close()
            fn()
          }
          return (
            <>
              <MenuItem icon="edit" onClick={act(onRename)}>
                Rename…
              </MenuItem>
              {onUpdate && (
                <MenuItem icon="filter" onClick={act(onUpdate)}>
                  Save current filters to this view
                </MenuItem>
              )}
              {prev && (
                <MenuItem icon="arrowUp" onClick={act(() => moveTo(between(before?.position, prev.position)))}>
                  Move up
                </MenuItem>
              )}
              {next && (
                <MenuItem icon="arrowDown" onClick={act(() => moveTo(between(next.position, after?.position)))}>
                  Move down
                </MenuItem>
              )}
              <MenuSeparator />
              <MenuItem icon="trash" danger onClick={act(() => setConfirm(true))}>
                Delete view
              </MenuItem>
            </>
          )
        }}
      </Menu>
      <Confirm
        open={confirm}
        title={`Delete "${view.name}"?`}
        body="Only the saved filters are deleted; the tasks stay."
        onConfirm={() => remove.mutate(view.id, { onSuccess: onDeleted })}
        onClose={() => setConfirm(false)}
      />
    </>
  )
}
