// Floating bar for the selected tasks: complete, due date, priority, label, move, delete.
// Every action is one optimistic cache pass plus one POST /tasks/bulk (bulk.ts useBulkOps). When every
// loaded row is picked and the list has more, it offers "Select all N": then actions go by the list's filter.
import { useEffect, useState } from 'react'
import { Icon } from '../../components/Icon'
import { Button, Confirm, fieldClass, Menu, MenuItem, MenuLabel, MenuSeparator, Popover, type TriggerProps } from '../../components/ui'
import { cn } from '../../lib/cn'
import { addDays, parseDayKey, startOfDay } from '../../lib/dates'
import { plural } from '../../lib/format'
import type { Label, Project, Task } from '../../lib/types'
import { type BulkTarget, targetCount, useBulkOps } from './bulk'
import { Dot } from './chip'
import { useDeleteWithUndo } from './deleteUndo'
import { PRIORITY_OPTIONS, prioTone } from './priority'
import { canEditIn, projectName } from './task'

/** Put on <body> while the bar shows, so toasts rise above it (the toast stack is outside this page). */
const LIFT_TOASTS = '[&_.toasts]:bottom-19!'
const sep = <span className="mx-1 h-5 w-px flex-none bg-border" />
/** A bar action: a ghost button whose label phones drop (the icon stays, as a square button). */
const act = 'gap-1.5! text-fg! [&>svg]:text-muted max-md:w-8 max-md:justify-center max-md:px-0!'
const choice = 'flex items-center gap-2'

function Action({ icon, label, ...p }: TriggerProps & { icon: string; label: string }) {
  return (
    <Button variant="ghost" size="sm" className={act} {...p}>
      <Icon name={icon} size={14} />
      <span className="max-md:hidden">{label}</span>
    </Button>
  )
}

export function BulkBar({
  tasks,
  target,
  projects,
  labels,
  onClear,
  matchTotal,
  onMatch,
  onUnmatch,
}: {
  tasks: Task[]
  target: BulkTarget
  projects?: Project[]
  labels?: Label[]
  onClear: () => void
  /** Offer "Select all N" (every loaded row is picked and more match). */
  matchTotal?: number
  onMatch?: () => void
  onUnmatch?: () => void
}) {
  const ops = useBulkOps()
  const deleteLater = useDeleteWithUndo()
  const [day, setDay] = useState('')
  const [confirm, setConfirm] = useState(false)
  useEffect(() => {
    document.body.classList.add(LIFT_TOASTS)
    return () => document.body.classList.remove(LIFT_TOASTS)
  }, [])
  if (!tasks.length) return null
  const n = targetCount(target)
  const byFilter = !Array.isArray(target)
  const today = startOfDay(new Date())
  const due = (d: Date | null) => ops.setDue(target, tasks, d)
  const targets = (projects ?? []).filter((p) => canEditIn(p) && !p.archived).sort((a, b) => Number(b.is_inbox) - Number(a.is_inbox))
  const allDone = tasks.every((t) => t.done)
  const match = 'whitespace-nowrap text-accent! max-md:px-2!'

  return (
    <div
      className={cn(
        'fixed bottom-[calc(1.25rem+env(safe-area-inset-bottom,0px))] left-1/2 z-55 flex h-11 max-w-[calc(100vw-1.5rem)] -translate-x-1/2 items-center gap-0.5 rounded-md bg-surface pr-1.5 pl-3.5 text-sm shadow-pop max-md:pl-3',
        'transition-[opacity,translate] duration-160 ease-out starting:translate-y-1.5 starting:opacity-0',
      )}
      role="toolbar"
      aria-label={`${plural(n, 'task')} selected`}
    >
      <span className="mr-1 font-semibold whitespace-nowrap tabular-nums">{n.toLocaleString()} selected</span>
      {matchTotal != null && onMatch && (
        <Button variant="ghost" size="sm" className={match} onClick={onMatch} title="Select every task in this list, loaded or not">
          Select all {matchTotal.toLocaleString()}
        </Button>
      )}
      {byFilter && onUnmatch && (
        <Button variant="ghost" size="sm" className={match} onClick={onUnmatch} title="Back to the loaded rows only">
          Only {tasks.length.toLocaleString()} loaded
        </Button>
      )}
      {sep}
      <Action
        icon="check"
        label={allDone ? 'Reopen' : 'Complete'}
        onClick={() => {
          ops.setDone(target, !allDone)
          onClear()
        }}
        title={allDone ? 'Mark as not done' : 'Complete'}
      />
      <Popover label="Set due date" trigger={(p) => <Action {...p} icon="calendar" label="Due" title="Due date" />}>
        {(close) => (
          <>
            <form
              className="flex gap-1.5 px-1 pt-1 pb-1.5"
              onSubmit={(e) => {
                e.preventDefault()
                if (day) {
                  due(parseDayKey(day))
                  close()
                }
              }}
            >
              <input
                type="date"
                className={cn(fieldClass.input, 'h-7! min-w-0 flex-1 text-xs!')}
                value={day}
                onChange={(e) => setDay(e.target.value)}
                aria-label="Due date"
              />
              <Button type="submit" size="sm" variant="primary" disabled={!day}>
                Set
              </Button>
            </form>
            {(
              [
                ['sun', 'Today', today],
                ['arrowRight', 'Tomorrow', addDays(today, 1)],
                ['calendar', 'Next week', addDays(today, 7)],
              ] as const
            ).map(([icon, label, d]) => (
              <MenuItem
                key={label}
                icon={icon}
                onClick={() => {
                  close()
                  due(d)
                }}
              >
                {label}
              </MenuItem>
            ))}
            <MenuSeparator />
            <MenuItem
              icon="x"
              onClick={() => {
                close()
                due(null)
              }}
            >
              Clear due date
            </MenuItem>
          </>
        )}
      </Popover>
      <Menu label="Set priority" trigger={(p) => <Action {...p} icon="flag" label="Priority" title="Priority" />}>
        {(close) =>
          [...PRIORITY_OPTIONS].reverse().map((p) => (
            <MenuItem
              key={p.value}
              end={tasks.every((t) => t.priority === p.value) ? '✓' : undefined}
              onClick={() => {
                close()
                ops.setPriority(target, p.value)
              }}
            >
              <span className={cn(choice, prioTone(p.value))}>
                <Icon name="flag" size={13} />
                {p.label}
              </span>
            </MenuItem>
          ))
        }
      </Menu>
      <Menu label="Labels" trigger={(p) => <Action {...p} icon="tag" label="Label" title="Label" />}>
        {() =>
          labels?.length ? (
            labels.map((l) => {
              const all = tasks.every((t) => t.labels.includes(l.id))
              const some = !all && tasks.some((t) => t.labels.includes(l.id))
              return (
                <MenuItem key={l.id} end={all ? '✓' : some ? '–' : undefined} onClick={() => ops.toggleLabel(target, tasks, l.id)}>
                  <span className={choice}>
                    <Dot colour={l.colour} />
                    {l.name}
                  </span>
                </MenuItem>
              )
            })
          ) : (
            <MenuLabel>No labels yet. Add one from the sidebar.</MenuLabel>
          )
        }
      </Menu>
      <Menu label="Move to project" width="15rem" trigger={(p) => <Action {...p} icon="folder" label="Move" title="Move to project" />}>
        {(close) => (
          <>
            <MenuLabel>Move to</MenuLabel>
            {targets.map((p) => (
              <MenuItem
                key={p.id}
                onClick={() => {
                  close()
                  ops.move(target, p)
                  onClear()
                }}
                end={tasks.every((t) => t.project_id === p.id) ? '✓' : undefined}
              >
                <span className={choice}>
                  {p.is_inbox ? <Icon name="inbox" size={13} /> : <Dot colour={p.colour} />}
                  <span className="truncate">{projectName(p)}</span>
                </span>
              </MenuItem>
            ))}
          </>
        )}
      </Menu>
      <Button
        variant="ghost"
        size="sm"
        className={act}
        onClick={() => {
          if (byFilter) return setConfirm(true)
          deleteLater(tasks)
          onClear()
        }}
        title={byFilter ? 'Delete every matching task' : 'Delete (undo for 6 s)'}
      >
        <Icon name="trash" size={14} />
        <span className="max-md:hidden">Delete</span>
      </Button>
      {sep}
      <Button
        variant="ghost"
        size="sm"
        icon
        className="text-fg! max-md:w-8 [&>svg]:text-muted"
        onClick={onClear}
        aria-label="Clear selection"
        title="Clear selection (Esc)"
      >
        <Icon name="x" size={14} />
      </Button>
      <Confirm
        open={confirm}
        title={`Delete ${plural(n, 'task')}?`}
        body="Every task matching this list is deleted, with its subtasks. This can't be undone."
        onConfirm={() => {
          ops.remove(target)
          onClear()
        }}
        onClose={() => setConfirm(false)}
      />
    </div>
  )
}
