import { useState } from 'react'
import { Icon } from './Icon'
import { Dialog } from './ui'
import { previewQuick } from '../lib/quick'
import { useCreateTask, useProjects } from '../lib/queries'
import { toast } from './toast'
import { PRIORITIES, type Task } from '../lib/types'

const PRIO_FROM_BANG = [5, 10, 15, 20, 20]

/** Natural-language task input ("Pay rent tomorrow 5pm *bills +Home !3"), with token chips while typing. */
export function QuickAddInput({ projectId, parentId, listKey, optimistic, autoFocus, placeholder, onCreated, compact, defaultToday }: {
  projectId?: string | null
  parentId?: string | null
  listKey?: readonly unknown[]
  optimistic?: Partial<Task>
  autoFocus?: boolean
  placeholder?: string
  onCreated?: (t: Task) => void
  compact?: boolean
  /** Lists of today's tasks: a task typed without a date is due today. */
  defaultToday?: boolean
}) {
  const [text, setText] = useState('')
  const create = useCreateTask()
  const p = text.trim() ? previewQuick(text) : null
  const submit = () => {
    const value = text.trim()
    if (!value) return
    const pv = previewQuick(value)
    const addToday = defaultToday && !pv.when
    setText('')
    const eod = new Date()
    eod.setHours(23, 59, 0, 0)
    create.mutate(
      {
        quick: addToday ? `${value} today` : value,
        body: { title: pv.title, project_id: projectId ?? null, parent_id: parentId ?? null },
        listKey,
        optimistic: { title: pv.title || value, priority: pv.priority ? PRIO_FROM_BANG[pv.priority - 1] : 10, project_id: projectId ?? null, parent_id: parentId ?? null, due: addToday ? eod.toISOString() : null, ...optimistic },
      },
      { onSuccess: (t) => onCreated?.(t) },
    )
  }
  return (
    <div className={'quick-add' + (compact ? ' compact' : '')}>
      <form
        className="quick-add-row"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <Icon name="plus" className="quick-add-icon" />
        <input
          className="quick-add-input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={placeholder ?? 'Add a task…  try "Pay rent tomorrow 5pm !3"'}
          aria-label="Add a task"
          autoFocus={autoFocus}
          maxLength={500}
          enterKeyHint="done"
        />
        {text && <button className="btn primary sm" type="submit">Add</button>}
      </form>
      {p && (p.when || p.labels.length || p.project || p.priority || p.repeat) ? (
        <div className="quick-chips" aria-live="polite">
          {p.when && <span className="chip accent"><Icon name="calendar" size={12} />{p.when}</span>}
          {p.repeat && <span className="chip"><Icon name="repeat" size={12} />{p.repeat}</span>}
          {p.project && <span className="chip"><Icon name="folder" size={12} />{p.project}</span>}
          {p.labels.map((l) => <span key={l} className="chip"><Icon name="tag" size={12} />{l}</span>)}
          {p.priority && <span className="chip warning"><Icon name="flag" size={12} />{PRIORITIES.find((x) => x.value === PRIO_FROM_BANG[p.priority! - 1])?.label}</span>}
        </div>
      ) : null}
    </div>
  )
}

export function QuickAddDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const projects = useProjects().data
  const [project, setProject] = useState<string>('')
  return (
    <Dialog open={open} onClose={onClose} title="New task" width="34rem">
      <QuickAddInput
        autoFocus
        projectId={project || null}
        onCreated={(t) => {
          toast.show(`Added "${t.title}"`)
          onClose()
        }}
      />
      <div className="row">
        <label className="label" htmlFor="qa-project">Project</label>
        <select id="qa-project" className="select" style={{ width: 'auto', minWidth: '10rem' }} value={project} onChange={(e) => setProject(e.target.value)}>
          <option value="">Inbox</option>
          {projects?.filter((p) => !p.is_inbox).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <span className="spacer" />
      </div>
      <p className="help">
        <span className="kbd">*label</span> <span className="kbd">+Project</span> <span className="kbd">!1–4</span> priority, dates like
        "tomorrow 5pm", "fri", "every week".
      </p>
    </Dialog>
  )
}
