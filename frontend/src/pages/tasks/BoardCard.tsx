// One board card: labels, the check and title (hover for every detail), a "Move to" menu for keyboard and
// touch users, and a meta line (priority, due or done, start, subtasks, comments, repeat, reminder,
// progress, time spent, assignees).
import type { CSSProperties, DragEvent, MouseEvent } from 'react'
import { Icon } from '../../components/Icon'
import { dueTone, fmtMinutes, hoverText, Ring, TaskCheck } from '../../components/TaskRow'
import { Avatar, Button, Menu, MenuItem, MenuLabel } from '../../components/ui'
import { cn } from '../../lib/cn'
import { dueLabel, fmtStamp } from '../../lib/dates'
import type { Bucket, Label, Task } from '../../lib/types'
import { labelChip, labelStyle } from './Labels'
import { repeatText } from './recurrence'
import { isTempId } from './task'

const metaLine =
  'flex flex-wrap gap-x-3 gap-y-1 pl-6 text-xs text-muted [&>span]:inline-flex [&>span]:max-w-56 [&>span]:items-center [&>span]:gap-1 [&>span]:overflow-hidden [&>span]:text-ellipsis [&>span]:whitespace-nowrap'
const TONE = { overdue: 'text-danger', today: 'text-accent font-medium', soon: 'text-warning', '': '' }

export function Card({
  task,
  labels,
  buckets,
  dragging,
  picked,
  draggable,
  onOpen,
  onToggle,
  onMove,
  onDragStart,
  onDragEnd,
}: {
  task: Task
  labels?: Label[]
  buckets: Bucket[]
  dragging: boolean
  picked: boolean
  draggable: boolean
  onOpen: (e: MouseEvent) => void
  onToggle: () => void
  onMove: (b: Bucket) => void
  onDragStart: (e: DragEvent) => void
  onDragEnd: () => void
}) {
  const tone = dueTone(task.due, task.done)
  const taskLabels = labels?.filter((l) => task.labels.includes(l.id)) ?? []
  const future = task.start && !task.done && new Date(task.start) > new Date() ? task.start : null
  const rem = task.reminders.some((r) => !r.sent)
  const who = task.assignees
  const hasMeta =
    task.due ||
    task.done_at ||
    future ||
    task.subtasks ||
    task.comments ||
    task.priority >= 15 ||
    task.repeat_mode ||
    rem ||
    task.percent ||
    task.time_spent ||
    task.assignees.length
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the title button is the keyboard control; the card is a bigger pointer target
    // biome-ignore lint/a11y/useKeyWithClickEvents: the title button is the keyboard control; the card is a bigger pointer target
    <div
      className={cn(
        'group/card grid cursor-grab gap-1.5 rounded-sm border py-2 pr-1.5 pl-2.5 transition-[box-shadow,border-color] duration-120',
        picked
          ? 'border-accent bg-[color-mix(in_srgb,var(--app-accent-soft)_60%,var(--app-surface))]'
          : 'border-border bg-surface hover:border-[color-mix(in_srgb,var(--app-muted)_40%,var(--app-border))]',
        task.colour
          ? 'shadow-[inset_3px_0_0_var(--task-colour),0_1px_1px_rgba(16,24,40,.04)]'
          : 'shadow-[0_1px_1px_rgba(16,24,40,.04)] hover:shadow-[0_2px_6px_rgba(16,24,40,.07)]',
        dragging && 'opacity-40',
      )}
      style={task.colour ? ({ '--task-colour': task.colour } as CSSProperties) : undefined}
      data-card={task.id}
      data-task={task.id}
      draggable={draggable && !isTempId(task.id)}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onOpen}
    >
      {taskLabels.length > 0 && (
        <div className="flex flex-wrap gap-1 pl-6">
          {taskLabels.slice(0, 4).map((l) => (
            <span key={l.id} className={labelChip} style={labelStyle(l.colour)}>
              {l.name}
            </span>
          ))}
          {taskLabels.length > 4 && <span className={labelChip}>+{taskLabels.length - 4}</span>}
        </div>
      )}
      <div className="flex items-start gap-2 [&_.check]:mt-0.5">
        <TaskCheck task={task} onToggle={onToggle} />
        <button
          type="button"
          className={cn(
            'min-w-0 flex-1 cursor-pointer border-0 bg-transparent p-0 text-left text-sm leading-[1.35] wrap-anywhere',
            task.done && 'text-muted line-through',
          )}
          title={hoverText(task, taskLabels)}
          onClick={(e) => {
            e.stopPropagation()
            onOpen(e)
          }}
        >
          {task.title}
          {task.description && <Icon name="list" size={12} className="ml-1.25 align-[-1px] text-muted" title="Has a description" />}
        </button>
        {/* Menu items are portaled, but React events still bubble to the card: don't let them open it. */}
        {/* biome-ignore lint/a11y/noStaticElementInteractions: only stops the click reaching the card */}
        {/* biome-ignore lint/a11y/useKeyWithClickEvents: only stops the click reaching the card */}
        <span onClick={(e) => e.stopPropagation()}>
          <Menu
            align="end"
            label="Card actions"
            trigger={(p) => (
              <Button
                {...p}
                variant="ghost"
                size="sm"
                icon
                className="-my-1 opacity-0 group-hover/card:opacity-100 focus-visible:opacity-100 aria-expanded:opacity-100 touch:opacity-100"
                aria-label={`Actions for "${task.title}"`}
                onClick={(e) => {
                  e.stopPropagation()
                  p.onClick?.(e)
                }}
              >
                <Icon name="more" size={14} />
              </Button>
            )}
          >
            {(close) => (
              <>
                <MenuLabel>Move to</MenuLabel>
                {buckets.map((b) => (
                  <MenuItem
                    key={b.id}
                    icon={b.id === task.bucket_id ? 'check' : 'arrowRight'}
                    onClick={() => {
                      close()
                      if (b.id !== task.bucket_id) onMove(b)
                    }}
                  >
                    {b.name}
                  </MenuItem>
                ))}
              </>
            )}
          </Menu>
        </span>
      </div>
      {hasMeta ? (
        <div className={metaLine}>
          {task.priority >= 15 && (
            <span className={task.priority >= 20 ? 'text-danger' : 'text-warning'}>
              <Icon name="flag" size={12} />
              {task.priority_label}
            </span>
          )}
          {task.done && task.done_at ? (
            <span>
              <Icon name="check" size={12} />
              {dueLabel(task.done_at)}
            </span>
          ) : (
            task.due && (
              <span className={TONE[tone]}>
                <Icon name="calendar" size={12} />
                {dueLabel(task.due)}
              </span>
            )
          )}
          {future && (
            <span title={`Starts ${fmtStamp(future)}`}>
              <Icon name="play" size={12} />
              {dueLabel(future)}
            </span>
          )}
          {!!task.subtasks && (
            <span>
              <Icon name="subtask" size={12} />
              {task.subtasks_done}/{task.subtasks}
            </span>
          )}
          {!!task.comments && (
            <span>
              <Icon name="comment" size={12} />
              {task.comments}
            </span>
          )}
          {task.repeat_mode > 0 && (
            <span title={repeatText(task.repeat_mode, task.repeat_every)}>
              <Icon name="repeat" size={12} />
            </span>
          )}
          {rem && (
            <span title="Reminder set">
              <Icon name="bell" size={12} />
            </span>
          )}
          {task.percent > 0 && (
            <span title={`${task.percent}% done`}>
              <Ring value={task.percent} />
              {task.percent}%
            </span>
          )}
          {task.time_spent > 0 && (
            <span title="Time spent">
              <Icon name="clock" size={12} />
              {fmtMinutes(task.time_spent)}
            </span>
          )}
          {who.length > 0 && (
            <span className="ml-auto gap-0.5!" title={who.map((a) => a.name || a.username).join(', ')}>
              {who.slice(0, 2).map((a) => (
                <Avatar key={a.username} name={a.name || a.username} size={1.125} />
              ))}
              {who.length > 2 && <span className="text-muted">+{who.length - 2}</span>}
            </span>
          )}
        </div>
      ) : null}
    </div>
  )
}
