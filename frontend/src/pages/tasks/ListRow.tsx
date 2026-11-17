// One list row: the shared TaskRow wrapped for selection (a checkbox in the gutter, Ctrl/Cmd/Shift-click,
// long-press on touch), a subtask twisty, inline rename (double-click a title) and "add subtask".
// Memoized: typing, selecting another row or a new page of results re-renders only rows whose own props
// changed; handlers go through a ref so they always see the page's latest state.
//
// Unstyled class hooks: `pick` + data-root (drop positions, useListDrop), and `sel-box`, `row-twisty`,
// `row-act`, `inline-title` (clicks on these never open the task). `check` and `task-title` come from TaskRow.
import { memo, useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react'
import { Icon } from '../../components/Icon'
import { TaskRow } from '../../components/TaskRow'
import { Button } from '../../components/ui'
import { cn } from '../../lib/cn'
import { plural } from '../../lib/format'
import type { Label, Project, Task } from '../../lib/types'
import type { Selection } from './selection'

export type RowActions = {
  sel: Selection
  order: string[]
  toggle: (t: Task) => void
  open: (t: Task) => void
  rename: (id: string) => void
  startDrag: (e: DragEvent, t: Task) => void
  endDrag: () => void
  finishEdit: (t: Task, v: string | null) => void
  addSub: (t: Task, collapsed: boolean) => void
  toggleCollapsed: (id: string) => void
}

/** Inline title editor for a list row (Enter saves, Esc cancels, blur saves). */
function InlineTitle({ task, onDone }: { task: Task; onDone: (v: string | null) => void }) {
  const [v, setV] = useState(task.title)
  const done = useRef(false)
  const finish = (save: boolean) => {
    if (done.current) return
    done.current = true
    onDone(save ? v.replace(/\s+/g, ' ').trim() || null : null)
  }
  return (
    <input
      className={cn(
        'inline-title -my-0.5 -ml-1.5 h-6.5 w-[calc(100%+0.375rem)] rounded-sm border border-border bg-surface px-1.5 text-sm text-fg',
        'focus:border-accent focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--app-accent)_18%,transparent)] focus:outline-none',
      )}
      autoFocus
      value={v}
      maxLength={256}
      aria-label="Task title"
      onFocus={(e) => e.target.select()}
      onChange={(e) => setV(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter' || e.key === 'Escape') {
          e.preventDefault()
          finish(e.key === 'Enter')
        }
      }}
    />
  )
}

export const ListRow = memo(function ListRow({
  t,
  depth,
  nKids,
  root,
  showProject,
  collapsed,
  project,
  projectPath,
  labels,
  picked,
  selected,
  canRename,
  canDrag,
  canAddSub,
  editing,
  touch,
  nextUp,
  acts,
}: {
  t: Task
  depth: number
  nKids: number
  root: boolean
  showProject: boolean
  collapsed: boolean
  project?: Project
  projectPath?: string
  labels?: Label[]
  picked: boolean
  selected: boolean
  canRename: boolean
  canDrag: boolean
  canAddSub: boolean
  editing: boolean
  touch: boolean
  /** Focus mode's first task: bigger, with a "Next up" tag. */
  nextUp: boolean
  acts: { current: RowActions }
}) {
  return (
    <Pickable
      id={t.id}
      title={t.title}
      picked={picked}
      acts={acts}
      touch={touch}
      depth={depth}
      root={root}
      nextUp={nextUp && !t.done}
      onRename={canRename ? () => acts.current.rename(t.id) : undefined}
      onOpen={() => acts.current.open(t)}
    >
      {nKids > 0 && (
        <button
          type="button"
          className="row-twisty absolute border-0 bg-transparent p-0 top-2.25 -left-[0.0625rem] z-1 inline-flex h-4.5 w-3 items-center justify-center rounded-[3px] text-muted hover:bg-hover hover:text-fg"
          onClick={(e) => {
            e.stopPropagation()
            acts.current.toggleCollapsed(t.id)
          }}
          aria-expanded={!collapsed}
          aria-label={collapsed ? `Show ${plural(nKids, 'subtask')}` : 'Hide subtasks'}
        >
          <Icon name={collapsed ? 'chevronRight' : 'chevronDown'} size={12} />
        </button>
      )}
      <TaskRow
        task={t}
        project={project}
        showProject={showProject}
        projectPath={projectPath}
        labels={labels}
        selected={selected}
        onToggle={() => acts.current.toggle(t)}
        onOpen={() => acts.current.open(t)}
        draggable={canDrag}
        onDragStart={(e) => acts.current.startDrag(e, t)}
        onDragEnd={() => acts.current.endDrag()}
        titleSlot={editing ? <InlineTitle task={t} onDone={(v) => acts.current.finishEdit(t, v)} /> : undefined}
        extra={
          canAddSub ? (
            <Button
              variant="ghost"
              size="sm"
              icon
              className="row-act -my-0.5 -mr-1 flex-none opacity-0 focus-visible:opacity-100 touch:hidden [.task-row:hover_&]:opacity-100"
              title="Add subtask"
              aria-label={`Add subtask to "${t.title}"`}
              onClick={(e) => {
                e.stopPropagation()
                acts.current.addSub(t, collapsed)
              }}
            >
              <Icon name="plus" size={14} />
            </Button>
          ) : undefined
        }
      />
    </Pickable>
  )
})

/** The selection wrapper. A mouse click on the title opens the task after a beat, so a double-click can
 *  rename it instead. */
function Pickable({
  id,
  title,
  picked,
  acts,
  touch,
  depth,
  root,
  nextUp,
  onRename,
  onOpen,
  children,
}: {
  id: string
  title: string
  picked: boolean
  acts: { current: RowActions }
  touch: boolean
  depth: number
  root: boolean
  nextUp: boolean
  onRename?: () => void
  onOpen: () => void
  children: ReactNode
}) {
  const press = useRef<{ timer: number; x: number; y: number; fired: boolean } | null>(null)
  const pointer = useRef('mouse')
  const clickTimer = useRef(0)
  const cancel = () => {
    if (press.current && !press.current.fired) {
      clearTimeout(press.current.timer)
      press.current = null
    }
  }
  useEffect(() => () => clearTimeout(clickTimer.current), [])
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: a wrapper that turns clicks on the row into selection; the row's own buttons stay the controls
    <div
      className={cn(
        'pick group/pick relative max-md:[-webkit-touch-callout:none] touch:[-webkit-touch-callout:none]',
        // While selecting on a phone the checkbox sits in the row's padding.
        'max-md:group-data-selecting/list:[&>.task-row]:pl-7.5! touch:group-data-selecting/list:[&>.task-row]:pl-7.5!',
        nextUp && [
          '[&>.task-row]:py-3! [&_.task-title]:text-md! [&_.task-title]:font-semibold!',
          "after:absolute after:-top-1.5 after:right-2 after:text-3xs after:font-semibold after:tracking-[0.06em] after:text-accent after:uppercase after:content-['Next_up']",
        ],
      )}
      style={depth ? { marginLeft: `${depth * 1.5}rem` } : undefined}
      data-id={id}
      data-root={root ? '' : undefined}
      onPointerDown={(e) => {
        pointer.current = e.pointerType
        if (e.pointerType !== 'touch' || (e.target as HTMLElement).closest('.check,.sel-box,.row-twisty,.row-act')) return
        const p = { x: e.clientX, y: e.clientY, fired: false, timer: 0 }
        p.timer = window.setTimeout(() => {
          p.fired = true
          acts.current.sel.toggle(id)
          navigator.vibrate?.(10)
        }, 450)
        press.current = p
      }}
      onPointerMove={(e) => {
        const p = press.current
        if (p && !p.fired && Math.hypot(e.clientX - p.x, e.clientY - p.y) > 8) cancel()
      }}
      onPointerUp={cancel}
      onPointerCancel={cancel}
      onContextMenu={(e) => {
        if (press.current?.fired) e.preventDefault()
      }}
      onClickCapture={(e) => {
        if (press.current?.fired) {
          press.current = null
          e.stopPropagation()
          e.preventDefault()
          return
        }
        const target = e.target as HTMLElement
        if (target.closest('.check,.sel-box,.row-twisty,.row-act,.inline-title')) return
        const { sel, order } = acts.current
        if (sel.click(e, id, order)) {
          e.stopPropagation()
          e.preventDefault()
          return
        }
        if (sel.ids.size) {
          // While selecting on a phone, taps add/remove rows; a plain mouse click ends the selection and opens the task.
          if (touch || pointer.current === 'touch') {
            sel.toggle(id)
            e.stopPropagation()
            e.preventDefault()
            return
          }
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
      <input
        type="checkbox"
        className={cn(
          'sel-box absolute top-2.75 -left-5.5 z-1 m-0 size-3.5 flex-none cursor-pointer accent-accent transition-opacity duration-100',
          picked ? 'opacity-100' : 'opacity-0 group-hover/pick:opacity-100 focus-visible:opacity-100 group-data-selecting/list:opacity-100',
          'max-md:hidden touch:hidden max-md:group-data-selecting/list:left-2 max-md:group-data-selecting/list:block touch:group-data-selecting/list:left-2 touch:group-data-selecting/list:block',
        )}
        checked={picked}
        aria-label={`Select "${title}"`}
        onChange={(e) =>
          (e.nativeEvent as MouseEvent).shiftKey ? acts.current.sel.range(acts.current.order, id) : acts.current.sel.toggle(id)
        }
      />
      {children}
    </div>
  )
}
