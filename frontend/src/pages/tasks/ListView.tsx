// The list layout: sections (collapsible, sticky heads, drop targets with a hint), nested subtasks with an
// inline "add subtask" field, the drop line while reordering, the "Completed" section or its toggle, and
// the empty and loading states. Rows are windowed per section (virtual.ts): only those near the viewport
// are in the DOM.
import { useMemo, useRef, type ReactNode, type RefObject } from 'react'
import { Icon } from '../../components/Icon'
import { QuickAddInput } from '../../components/QuickAdd'
import { Button, ErrorBox, SkeletonRows } from '../../components/ui'
import { cn } from '../../lib/cn'
import type { SmartView } from '../../lib/qs'
import type { Task } from '../../lib/types'
import { dropHint, type Section } from './grouping'
import type { ListDrag, useListDrop } from './useListDrop'
import { useWindowed } from './virtual'

export type VItem =
  | { kind: 'row'; key: string; t: Task; depth: number; nKids: number; root: boolean; showProject: boolean }
  | { kind: 'sub'; key: string; t: Task; depth: number }
  | { kind: 'line'; key: string }

const EMPTY: Partial<Record<SmartView, string>> = {
  today: 'Nothing due today. Enjoy it.',
  overdue: 'Nothing overdue. Nice.',
  upcoming: 'Nothing due in the next 7 days.',
  nodate: 'Every task has a date.',
  favorites: 'No favourite tasks. Star a task to pin it here.',
  assigned: 'Nobody has assigned you a task.',
  done: 'No completed tasks yet.',
}

/** A section's rows, windowed: only those near the viewport are in the DOM (keys keep measured heights). */
function WindowRows({ items, render }: { items: VItem[]; render: (it: VItem) => ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const keys = useMemo(() => items.map((i) => i.key), [items])
  const w = useWindowed(keys, ref, 52, 1)
  return (
    <div ref={ref} className="grid gap-px">
      {w.padTop > 0 && <div style={{ height: w.padTop }} aria-hidden="true" />}
      {items.slice(w.start, w.end).map((it) => (
        <div key={it.key} ref={w.measure(it.key)} className="vrow min-w-0">
          {render(it)}
        </div>
      ))}
      {w.padBottom > 0 && <div style={{ height: w.padBottom }} aria-hidden="true" />}
    </div>
  )
}

const sectionHead = 'sticky top-0 z-1 mb-1 flex gap-1.5 border-b border-border bg-bg px-3 py-1.5 text-sm font-semibold'
const headCount = 'text-xs font-normal text-muted'

export function ListView({
  title,
  view,
  query,
  q,
  groups,
  kids,
  collapsedSections,
  toggleSection,
  collapsedTasks,
  addingSub,
  stopAddingSub,
  listKey,
  projectList,
  grouping,
  completed,
  selecting,
  drop,
  renderRow,
  moreRef,
  doneMoreRef,
  hint,
  onReschedule,
  onShowCompleted,
}: {
  title: string
  view: SmartView | null
  query: { pending: boolean; error: unknown; loaded: boolean; more: boolean; fetchingMore: boolean; retry: () => void }
  q: string
  groups: Section[]
  kids: Map<string, Task[]>
  collapsedSections: Set<string>
  toggleSection: (key: string) => void
  collapsedTasks: Set<string>
  addingSub: string | null
  stopAddingSub: () => void
  listKey?: readonly unknown[]
  projectList: boolean
  grouping: string
  /** The Completed section when shown (rows, total, loading), or the toggle's count when not. */
  completed: { shown: true; rows: Task[]; total?: number | null; pending: boolean; fetchingMore: boolean } | { shown: false; count: number }
  selecting: boolean
  drop: ReturnType<typeof useListDrop>
  renderRow: (it: Extract<VItem, { kind: 'row' }>) => ReactNode
  moreRef: RefObject<HTMLDivElement | null>
  doneMoreRef: RefObject<HTMLDivElement | null>
  hint: boolean
  onReschedule: (tasks: Task[]) => void
  onShowCompleted: () => void
}) {
  const doneView = view === 'done'
  const drag: ListDrag | null = drop.drag

  /** A root row and its visible subtasks (plus an open "add subtask" input), flattened for the window. */
  const flatRows = (t: Task, depth: number, showProject: boolean, out: VItem[]) => {
    const children = kids.get(t.id) ?? []
    out.push({ kind: 'row', key: t.id, t, depth, nKids: children.length, root: depth === 0, showProject })
    if (addingSub === t.id) out.push({ kind: 'sub', key: `sub${t.id}`, t, depth })
    if (!collapsedTasks.has(t.id)) for (const c of children) flatRows(c, depth + 1, showProject, out)
  }
  const sectionItems = (g: Section): VItem[] => {
    const out: VItem[] = []
    if (doneView) {
      for (const t of g.items) out.push({ kind: 'row', key: t.id, t, depth: 0, nKids: 0, root: true, showProject: true })
      return out
    }
    const reordering = drag?.over === g.key && drag.index !== undefined
    let k = 0 // index among root rows that aren't being dragged, for the drop line
    for (const t of g.items) {
      if (reordering && !drag.ids.includes(t.id) && k++ === drag.index) out.push({ kind: 'line', key: 'dl' })
      flatRows(t, 0, !projectList, out)
    }
    if (reordering && drag.index === k) out.push({ kind: 'line', key: 'dl' })
    return out
  }
  const doneRows = completed.shown ? completed.rows : null
  const doneItems = useMemo(
    (): VItem[] => (doneRows ?? []).map((t) => ({ kind: 'row', key: t.id, t, depth: 0, nKids: 0, root: false, showProject: !projectList })),
    [doneRows, projectList],
  )
  const render = (it: VItem): ReactNode => {
    if (it.kind === 'line') return <div className="mx-3 h-0.5 rounded-[2px] bg-accent" />
    if (it.kind === 'row') return renderRow(it)
    return (
      // biome-ignore lint/a11y/noStaticElementInteractions: Escape and leaving the field end subtask entry
      <div
        className="mt-0.5 mr-2 mb-1"
        style={{ marginLeft: `${(it.depth + 1) * 1.5 + 0.5}rem` }}
        onKeyDown={(e) => {
          if (e.key !== 'Escape') return
          e.stopPropagation()
          stopAddingSub()
        }}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node) && !e.currentTarget.querySelector('input')?.value) stopAddingSub()
        }}
      >
        <QuickAddInput
          compact
          autoFocus
          parentId={it.t.id}
          projectId={it.t.project_id}
          listKey={listKey}
          optimistic={{ parent_id: it.t.id, project_id: it.t.project_id }}
          placeholder="Subtask, then Enter (Esc to finish)"
        />
      </div>
    )
  }

  const empty = groups.every((g) => !g.items.length) && !(completed.shown && completed.rows.length) && !groups.some((g) => g.keep)
  return (
    <div
      className={cn('group/list grid gap-1', selecting && '[&_.task-row]:select-none', drag && '[&_.task-row:hover]:bg-transparent!')}
      data-selecting={selecting ? '' : undefined}
    >
      {query.pending ? (
        <SkeletonRows rows={7} avatar />
      ) : query.error && !query.loaded ? (
        <ErrorBox error={query.error} retry={query.retry} />
      ) : empty ? (
        <div className="px-4 py-12 text-center text-sm text-muted">
          {q ? `No tasks match "${q}".` : (EMPTY[view ?? 'today'] ?? 'No tasks here. Add one above.')}
        </div>
      ) : (
        groups
          .filter((g) => g.items.length || g.keep)
          .map((g, i) => {
            const reordering = drag?.over === g.key && drag.index !== undefined
            const dropping = drag?.over === g.key && !reordering
            const collapsed = collapsedSections.has(g.key)
            return (
              <section
                key={g.key}
                className={cn(
                  'grid gap-px',
                  i > 0 && 'mt-3',
                  dropping &&
                    'rounded-sm bg-[color-mix(in_srgb,var(--app-accent-soft)_70%,transparent)] shadow-[0_0_0_1px_color-mix(in_srgb,var(--app-accent)_40%,transparent)]',
                )}
                aria-label={g.label || title}
                {...drop.sectionDrop(g.key, g.items)}
              >
                {g.label && (
                  <h2 className={cn(sectionHead, 'items-baseline', dropping && 'bg-transparent', g.key === 'overdue' && 'text-danger')}>
                    <button
                      type="button"
                      className="inline-flex items-baseline gap-1.5 border-0 bg-transparent p-0 text-inherit"
                      aria-expanded={!collapsed}
                      onClick={() => toggleSection(g.key)}
                    >
                      <Icon name={collapsed ? 'chevronRight' : 'chevronDown'} size={12} className="self-center text-muted" />
                      {g.label}
                      <span className={headCount}>
                        {g.items.length}
                        {query.more && grouping !== 'none' ? '+' : ''}
                      </span>
                    </button>
                    {g.key === 'overdue' && g.items.length > 0 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="ml-auto text-danger!"
                        onClick={() => onReschedule(g.items)}
                        title="Move all overdue tasks to today"
                      >
                        Reschedule to today
                      </Button>
                    )}
                    {dropping && <span className="ml-auto text-xs font-medium text-accent">Drop to {dropHint(g.key, g.label)}</span>}
                  </h2>
                )}
                {!collapsed && <WindowRows items={sectionItems(g)} render={render} />}
                {!collapsed && g.keep && !g.items.length && (
                  <div className="px-3 pt-1.5 pb-2 pl-9.5 text-xs text-muted">Nothing scheduled</div>
                )}
              </section>
            )
          })
      )}
      <div ref={moreRef} aria-hidden="true" />
      {query.fetchingMore && <SkeletonRows rows={3} avatar />}
      {completed.shown && query.loaded && (
        <section className="mt-3 grid gap-px">
          <h2 className={cn(sectionHead, 'items-baseline')}>
            <Icon name="check" size={12} className="self-center text-success" />
            Completed<span className={headCount}>{completed.total?.toLocaleString() ?? '…'}</span>
          </h2>
          {completed.pending ? (
            <SkeletonRows rows={2} />
          ) : completed.rows.length ? (
            <WindowRows items={doneItems} render={render} />
          ) : (
            <div className="px-3 pt-1.5 pb-2 pl-9.5 text-xs text-muted">No completed tasks</div>
          )}
          <div ref={doneMoreRef} aria-hidden="true" />
          {completed.fetchingMore && <SkeletonRows rows={2} />}
        </section>
      )}
      {!completed.shown && projectList && query.loaded && completed.count > 0 && (
        <button
          type="button"
          className={cn(sectionHead, 'w-full items-center border-x-0 border-t-0 text-left text-muted hover:text-fg')}
          onClick={onShowCompleted}
        >
          <Icon name="chevronRight" size={14} />
          Completed<span className={headCount}>{completed.count.toLocaleString()}</span>
        </button>
      )}
      {hint && (
        <p className="px-3 pt-3 text-xs text-muted">
          Drag tasks to reorder them, or onto a project in the sidebar to move them. Double-click a title to rename.
        </p>
      )}
    </div>
  )
}
