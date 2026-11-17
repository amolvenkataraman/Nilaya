// One task in a list: round check, title, and a quiet meta line (due, project, labels, counts).
// The class names task-row, task-title, check, done and selected stay as hooks the Tasks page styles and queries.
import { memo, type CSSProperties, type DragEvent, type ReactNode } from 'react'
import { cn } from '../lib/cn'
import { Icon } from './Icon'
import { dayDiff, dueLabel, fmtNumericDay, fmtStamp, isEndOfDay } from '../lib/dates'
import type { Label, Project, Task } from '../lib/types'

export function TaskCheck({ task, onToggle, size }: { task: Task; onToggle: () => void; size?: 'lg' }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={task.done}
      aria-label={task.done ? `Mark "${task.title}" as not done` : `Complete "${task.title}"`}
      className={cn(
        'check inline-grid flex-none place-items-center rounded-full border-[1.5px] border-[color-mix(in_srgb,var(--c)_75%,transparent)] bg-transparent p-0 text-transparent transition-colors',
        'hover:bg-[color-mix(in_srgb,var(--c)_14%,transparent)] hover:text-[color-mix(in_srgb,var(--c)_80%,transparent)]',
        'aria-checked:border-(--c) aria-checked:bg-(--c) aria-checked:text-surface [&_svg]:size-2.5',
        size === 'lg' ? 'size-5' : 'size-4',
        // One colour class only: two would both set --c and the stylesheet, not this order, would pick.
        task.priority >= 20 ? '[--c:var(--app-danger)]' : task.priority >= 15 ? '[--c:var(--app-warning)]' : '[--c:var(--app-muted)]',
      )}
      onClick={(e) => {
        e.stopPropagation()
        onToggle()
      }}
      disabled={task.id.startsWith('temp-')}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={3.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="m5 12.5 4.5 4.5L19 7.5" />
      </svg>
    </button>
  )
}

const META = 'inline-flex max-w-56 items-center gap-1 overflow-hidden text-ellipsis whitespace-nowrap'
const DUE_TONE: Record<string, string> = { overdue: 'text-danger', today: 'font-medium text-accent', soon: 'text-warning' }

export const fmtMinutes = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}` : `${m}m`)

/** Tiny progress ring (percent done). */
export function Ring({ value, size = 12 }: { value: number; size?: number }) {
  const r = 5
  const c = 2 * Math.PI * r
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" aria-hidden="true" className="ring flex-none">
      <circle cx="6" cy="6" r={r} fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" />
      <circle
        cx="6"
        cy="6"
        r={r}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeDasharray={`${(value / 100) * c} ${c}`}
        transform="rotate(-90 6 6)"
        strokeLinecap="round"
      />
    </svg>
  )
}

/** Hover card text: everything about the task at a glance. */
export function hoverText(t: Task, labels: Label[], project?: string): string {
  const lines = [t.title]
  if (t.description) lines.push(t.description.slice(0, 280) + (t.description.length > 280 ? '…' : ''))
  lines.push('')
  if (project) lines.push(`Project: ${project}`)
  if (t.done && t.done_at) lines.push(`Completed: ${fmtStamp(t.done_at)}`)
  if (t.due) lines.push(`Due: ${fmtStamp(t.due)}`)
  if (t.start) lines.push(`Start: ${fmtStamp(t.start)}`)
  lines.push(`Priority: ${t.priority_label}`)
  if (t.repeat_mode)
    lines.push(
      `Repeats: ${t.repeat_mode === 2 ? 'monthly' : t.repeat_mode === 3 ? 'after completion' : t.repeat_every ? `every ${Math.round(t.repeat_every / 86400)} day(s)` : 'yes'}`,
    )
  if (t.reminders.length) lines.push(`Reminders: ${t.reminders.length}`)
  if (t.percent) lines.push(`Progress: ${t.percent}%`)
  if (t.time_spent) lines.push(`Time spent: ${fmtMinutes(t.time_spent)}`)
  if (t.assignees.length) lines.push(`Assignees: ${t.assignees.map((a) => a.name || a.username).join(', ')}`)
  if (labels.length) lines.push(`Labels: ${labels.map((l) => l.name).join(', ')}`)
  if (t.subtasks) lines.push(`Subtasks: ${t.subtasks_done ?? 0}/${t.subtasks}`)
  if (t.comments) lines.push(`Comments: ${t.comments}`)
  lines.push(`Created ${fmtNumericDay(t.created_on)} by ${t.owner.name || t.owner.username} · updated ${fmtNumericDay(t.updated_on)}`)
  return lines.join('\n')
}

export function dueTone(iso: string | null, done: boolean, now = new Date()): '' | 'overdue' | 'today' | 'soon' {
  if (!iso || done) return ''
  const d = new Date(iso)
  const diff = dayDiff(now, d)
  if (d < now && (diff < 0 || !isEndOfDay(d))) return 'overdue'
  if (diff === 0) return 'today'
  if (diff === 1) return 'soon'
  return ''
}

/** Memoized: a row re-renders only when its own props change (callers pass stable props where it matters). */
export const TaskRow = memo(function TaskRow({
  task,
  project,
  projectPath,
  labels,
  onToggle,
  onOpen,
  selected,
  showProject = true,
  extra,
  draggable,
  onDragStart,
  onDragEnd,
  titleSlot,
}: {
  task: Task
  project?: Project
  /** "Work › Website" for nested projects. */
  projectPath?: string
  labels?: Label[]
  onToggle: () => void
  onOpen: () => void
  selected?: boolean
  showProject?: boolean
  extra?: ReactNode
  draggable?: boolean
  onDragStart?: (e: DragEvent) => void
  onDragEnd?: (e: DragEvent) => void
  /** Replaces the title button (e.g. an inline rename input). */
  titleSlot?: ReactNode
}) {
  const tone = dueTone(task.due, task.done)
  const taskLabels = labels?.filter((l) => task.labels.includes(l.id)) ?? []
  const meta: ReactNode[] = []
  if (task.done && task.done_at)
    meta.push(
      <span key="done" className={META}>
        <Icon name="check" size={12} />
        Completed {dueLabel(task.done_at).replace(/^(\w)/, (c) => c.toLowerCase())}
      </span>,
    )
  else if (task.due)
    meta.push(
      <span key="due" className={cn(META, DUE_TONE[tone])}>
        <Icon name={task.repeat_mode ? 'repeat' : 'calendar'} size={12} />
        {dueLabel(task.due)}
      </span>,
    )
  if (task.start && new Date(task.start) > new Date() && !task.done)
    meta.push(
      <span key="start" className={META}>
        <Icon name="clock" size={12} />
        Starts {dueLabel(task.start).replace(/^(\w)/, (c) => c.toLowerCase())}
      </span>,
    )
  if (showProject && project && !project.is_inbox)
    meta.push(
      <span key="proj" className={META}>
        <span className="size-1.75 flex-none rounded-full" style={{ background: project.colour || 'var(--app-muted)' }} />
        {projectPath ?? project.name}
      </span>,
    )
  for (const l of taskLabels.slice(0, 3))
    meta.push(
      <span key={'l' + l.id} className={META} style={l.colour ? { color: l.colour } : undefined}>
        <Icon name="tag" size={11} />
        {l.name}
      </span>,
    )
  if (taskLabels.length > 3)
    meta.push(
      <span key="lmore" className={META}>
        +{taskLabels.length - 3}
      </span>,
    )
  if (task.subtasks)
    meta.push(
      <span key="sub" className={META}>
        <Icon name="subtask" size={12} />
        {task.subtasks_done ?? 0}/{task.subtasks}
      </span>,
    )
  if (task.comments)
    meta.push(
      <span key="com" className={META}>
        <Icon name="comment" size={12} />
        {task.comments}
      </span>,
    )
  if (task.reminders.length && !task.done)
    meta.push(
      <span
        key="rem"
        className={META}
        title={`${task.reminders.length} reminder${task.reminders.length === 1 ? '' : 's'}${task.reminders[0]?.fire_at ? ` · next ${dueLabel(task.reminders.find((r) => !r.sent)?.fire_at ?? task.reminders[0].fire_at!)}` : ''}`}
      >
        <Icon name="bell" size={12} />
        {task.reminders.length > 1 ? task.reminders.length : ''}
      </span>,
    )
  if (task.percent > 0 && !task.done)
    meta.push(
      <span key="pct" className={META} title={`${task.percent}% done`}>
        <Ring value={task.percent} />
        {task.percent}%
      </span>,
    )
  if (task.time_spent > 0)
    meta.push(
      <span key="time" className={META} title="Time spent">
        <Icon name="clock" size={12} />
        {fmtMinutes(task.time_spent)}
      </span>,
    )
  if (task.assignees.length)
    meta.push(
      <span key="as" className={META}>
        <Icon name="user" size={12} />
        {task.assignees.map((a) => a.name || a.username).join(', ')}
      </span>,
    )

  return (
    <div
      style={task.colour ? ({ '--task-colour': task.colour } as CSSProperties) : undefined}
      className={cn(
        'task-row relative flex min-h-9 cursor-default items-start gap-2.5 rounded-sm px-3 py-1.75 [&>.check]:mt-0.5',
        selected ? 'selected bg-accent-soft' : 'hover:bg-hover',
        task.colour && 'shadow-[inset_3px_0_0_var(--task-colour)]',
        task.done && 'done animate-[task-done_0.35s_ease]',
        task.id.startsWith('temp-') && 'opacity-60',
      )}
      onClick={onOpen}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      data-task={task.id}
    >
      <TaskCheck task={task} onToggle={onToggle} />
      <div className="grid min-w-0 flex-1 gap-px">
        {titleSlot ?? (
          <button
            type="button"
            className={cn(
              'task-title cursor-pointer border-0 bg-transparent p-0 text-left text-sm leading-[1.35rem] [overflow-wrap:anywhere]',
              task.done ? 'text-muted line-through decoration-[color-mix(in_srgb,var(--app-muted)_60%,transparent)]' : 'text-fg',
            )}
            onClick={(e) => (e.stopPropagation(), onOpen())}
            // The hover text is built when the pointer arrives, not for every row on every render.
            onPointerEnter={(e) => {
              e.currentTarget.title = hoverText(task, taskLabels, projectPath ?? project?.name)
            }}
          >
            {task.title}
            {task.description && <Icon name="list" size={12} className="ml-1.5 inline align-[-1px] text-muted" title="Has a description" />}
          </button>
        )}
        {meta.length > 0 && <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">{meta}</div>}
      </div>
      {task.priority >= 15 && !task.done && (
        <span className={cn('mt-0.75 inline-flex', task.priority >= 20 ? 'text-danger' : 'text-warning')} title={task.priority_label}>
          <Icon name="flag" size={13} />
        </span>
      )}
      {task.favorite && <Icon name="star" size={13} className="mt-0.75 flex-none fill-current text-warning" />}
      {extra}
    </div>
  )
})
