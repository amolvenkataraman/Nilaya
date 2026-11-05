// One task in a list: round check, title, and a quiet meta line (due, project, labels, counts).
import type { DragEvent, ReactNode } from 'react'
import { Icon } from './Icon'
import { dayDiff, dueLabel, isEndOfDay } from '../lib/dates'
import type { Label, Project, Task } from '../lib/types'

export function TaskCheck({ task, onToggle, size }: { task: Task; onToggle: () => void; size?: 'lg' }) {
  const p = task.priority >= 20 ? 'p20' : task.priority >= 15 ? 'p15' : task.priority >= 10 ? '' : ''
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={task.done}
      aria-label={task.done ? `Mark "${task.title}" as not done` : `Complete "${task.title}"`}
      className={`check ${p}${size === 'lg' ? ' lg' : ''}`}
      onClick={(e) => {
        e.stopPropagation()
        onToggle()
      }}
      disabled={task.id.startsWith('temp-')}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="m5 12.5 4.5 4.5L19 7.5" />
      </svg>
    </button>
  )
}

export const fmtMinutes = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}` : `${m}m`)

/** Tiny progress ring (percent done). */
export function Ring({ value, size = 12 }: { value: number; size?: number }) {
  const r = 5
  const c = 2 * Math.PI * r
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" aria-hidden="true" className="ring">
      <circle cx="6" cy="6" r={r} fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" />
      <circle cx="6" cy="6" r={r} fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray={`${(value / 100) * c} ${c}`} transform="rotate(-90 6 6)" strokeLinecap="round" />
    </svg>
  )
}

/** Hover card text: everything about the task at a glance. */
function hoverText(t: Task, labels: Label[], project?: string): string {
  const lines = [t.title]
  if (t.description) lines.push(t.description.slice(0, 280) + (t.description.length > 280 ? '…' : ''))
  lines.push('')
  if (project) lines.push(`Project: ${project}`)
  if (t.done && t.done_at) lines.push(`Completed: ${new Date(t.done_at).toLocaleString()}`)
  if (t.due) lines.push(`Due: ${new Date(t.due).toLocaleString()}`)
  if (t.start) lines.push(`Start: ${new Date(t.start).toLocaleString()}`)
  lines.push(`Priority: ${t.priority_label}`)
  if (t.repeat_mode) lines.push(`Repeats: ${t.repeat_mode === 2 ? 'monthly' : t.repeat_mode === 3 ? 'after completion' : t.repeat_every ? `every ${Math.round(t.repeat_every / 86400)} day(s)` : 'yes'}`)
  if (t.reminders.length) lines.push(`Reminders: ${t.reminders.length}`)
  if (t.percent) lines.push(`Progress: ${t.percent}%`)
  if (t.time_spent) lines.push(`Time spent: ${fmtMinutes(t.time_spent)}`)
  if (t.assignees.length) lines.push(`Assignees: ${t.assignees.map((a) => a.name || a.username).join(', ')}`)
  if (labels.length) lines.push(`Labels: ${labels.map((l) => l.name).join(', ')}`)
  if (t.subtasks) lines.push(`Subtasks: ${t.subtasks_done ?? 0}/${t.subtasks}`)
  if (t.comments) lines.push(`Comments: ${t.comments}`)
  lines.push(`Created ${new Date(t.created_on).toLocaleDateString()} by ${t.owner.name || t.owner.username} · updated ${new Date(t.updated_on).toLocaleDateString()}`)
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

export function TaskRow({ task, project, projectPath, labels, onToggle, onOpen, selected, showProject = true, extra, draggable, onDragStart, onDragEnd }: {
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
}) {
  const tone = dueTone(task.due, task.done)
  const taskLabels = labels?.filter((l) => task.labels.includes(l.id)) ?? []
  const meta: ReactNode[] = []
  if (task.done && task.done_at) meta.push(<span key="done" className="meta-count"><Icon name="check" size={12} />Completed {dueLabel(task.done_at).replace(/^(\w)/, (c) => c.toLowerCase())}</span>)
  else if (task.due) meta.push(
    <span key="due" className={'meta-due ' + tone}><Icon name={task.repeat_mode ? 'repeat' : 'calendar'} size={12} />{dueLabel(task.due)}</span>,
  )
  if (task.start && new Date(task.start) > new Date() && !task.done) meta.push(<span key="start" className="meta-count"><Icon name="clock" size={12} />Starts {dueLabel(task.start).replace(/^(\w)/, (c) => c.toLowerCase())}</span>)
  if (showProject && project && !project.is_inbox) meta.push(
    <span key="proj" className="meta-proj"><span className="dot" style={{ background: project.colour || 'var(--app-muted)' }} />{projectPath ?? project.name}</span>,
  )
  for (const l of taskLabels.slice(0, 3)) meta.push(<span key={'l' + l.id} className="meta-label" style={l.colour ? ({ color: l.colour } as React.CSSProperties) : undefined}><Icon name="tag" size={11} />{l.name}</span>)
  if (taskLabels.length > 3) meta.push(<span key="lmore" className="meta-count">+{taskLabels.length - 3}</span>)
  if (task.subtasks) meta.push(<span key="sub" className="meta-count"><Icon name="subtask" size={12} />{task.subtasks_done ?? 0}/{task.subtasks}</span>)
  if (task.comments) meta.push(<span key="com" className="meta-count"><Icon name="comment" size={12} />{task.comments}</span>)
  if (task.reminders.length && !task.done) meta.push(
    <span key="rem" className="meta-count" title={`${task.reminders.length} reminder${task.reminders.length === 1 ? '' : 's'}${task.reminders[0]?.fire_at ? ` · next ${dueLabel(task.reminders.find((r) => !r.sent)?.fire_at ?? task.reminders[0].fire_at!)}` : ''}`}><Icon name="bell" size={12} />{task.reminders.length > 1 ? task.reminders.length : ''}</span>,
  )
  if (task.percent > 0 && !task.done) meta.push(
    <span key="pct" className="meta-count" title={`${task.percent}% done`}><Ring value={task.percent} />{task.percent}%</span>,
  )
  if (task.time_spent > 0) meta.push(<span key="time" className="meta-count" title="Time spent"><Icon name="clock" size={12} />{fmtMinutes(task.time_spent)}</span>)
  if (task.assignees.length) meta.push(<span key="as" className="meta-count"><Icon name="user" size={12} />{task.assignees.map((a) => a.name || a.username).join(', ')}</span>)

  return (
    <div
      style={task.colour ? ({ '--task-colour': task.colour } as React.CSSProperties) : undefined}
      className={'task-row' + (task.colour ? ' coloured' : '') + (task.done ? ' done' : '') + (selected ? ' selected' : '') + (task.id.startsWith('temp-') ? ' pending' : '')}
      onClick={onOpen}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      data-task={task.id}
    >
      <TaskCheck task={task} onToggle={onToggle} />
      <div className="task-main">
        <button type="button" className="task-title" onClick={(e) => (e.stopPropagation(), onOpen())} title={hoverText(task, taskLabels, projectPath ?? project?.name)}>
          {task.title}
          {task.description && <Icon name="list" size={12} className="task-desc-icon" title="Has a description" />}
        </button>
        {meta.length > 0 && <div className="task-meta">{meta}</div>}
      </div>
      {task.priority >= 15 && !task.done && (
        <span className={'task-flag ' + (task.priority >= 20 ? 'urgent' : 'high')} title={task.priority_label}>
          <Icon name="flag" size={13} />
        </span>
      )}
      {task.favorite && <Icon name="star" size={13} className="task-star" />}
      {extra}
    </div>
  )
}
