import { useState } from 'react'
import { cn } from '../lib/cn'
import { Icon } from './Icon'
import { Button, Chip, Dialog, Field, Kbd, Select } from './ui'
import { previewQuick } from '../lib/quick'
import { useCreateTask, useProjects } from '../lib/queries'
import { toast } from './toast'
import { PRIORITIES, type Task } from '../lib/types'

const PRIO_FROM_BANG = [5, 10, 15, 20, 20]

/** Natural-language task input ("Pay rent tomorrow 5pm *bills +Home !3"), with token chips while typing. */
export function QuickAddInput({
  projectId,
  parentId,
  listKey,
  optimistic,
  autoFocus,
  placeholder,
  onCreated,
  compact,
  defaultToday,
}: {
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
        optimistic: {
          title: pv.title || value,
          priority: pv.priority ? PRIO_FROM_BANG[pv.priority - 1] : 10,
          project_id: projectId ?? null,
          parent_id: parentId ?? null,
          due: addToday ? eod.toISOString() : null,
          ...optimistic,
        },
      },
      { onSuccess: (t) => onCreated?.(t) },
    )
  }
  return (
    <div className="grid gap-1.5">
      <form
        className={cn(
          'flex items-center gap-2 rounded-sm border pr-1.5 pl-3 transition-[border-color,box-shadow,background-color]',
          'focus-within:border-accent focus-within:shadow-[0_0_0_3px_color-mix(in_srgb,var(--app-accent)_16%,transparent)]',
          compact ? 'h-8.5 border-transparent bg-transparent hover:bg-hover focus-within:bg-surface' : 'h-9.5 border-border bg-surface',
        )}
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <Icon name="plus" className="flex-none text-accent" />
        <input
          className="h-full min-w-0 flex-1 border-0 bg-transparent p-0 text-sm outline-none placeholder:text-[color-mix(in_srgb,var(--app-muted)_85%,transparent)]"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={placeholder ?? 'Add a task…  try "Pay rent tomorrow 5pm !3"'}
          aria-label="Add a task"
          autoFocus={autoFocus}
          maxLength={500}
          enterKeyHint="done"
        />
        {text && (
          <Button variant="primary" size="sm" type="submit">
            Add
          </Button>
        )}
      </form>
      {p && (p.when || p.labels.length || p.project || p.priority || p.repeat) ? (
        <div className="flex flex-wrap gap-1 px-1" aria-live="polite">
          {p.when && (
            <Chip tone="accent">
              <Icon name="calendar" size={12} />
              {p.when}
            </Chip>
          )}
          {p.repeat && (
            <Chip>
              <Icon name="repeat" size={12} />
              {p.repeat}
            </Chip>
          )}
          {p.project && (
            <Chip>
              <Icon name="folder" size={12} />
              {p.project}
            </Chip>
          )}
          {p.labels.map((l) => (
            <Chip key={l}>
              <Icon name="tag" size={12} />
              {l}
            </Chip>
          ))}
          {p.priority && (
            <Chip tone="warning">
              <Icon name="flag" size={12} />
              {PRIORITIES.find((x) => x.value === PRIO_FROM_BANG[p.priority! - 1])?.label}
            </Chip>
          )}
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
      <Field label="Project" className="justify-self-start">
        <Select className="min-w-40" value={project} onChange={(e) => setProject(e.target.value)}>
          <option value="">Inbox</option>
          {projects
            ?.filter((p) => !p.is_inbox)
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
        </Select>
      </Field>
      <p className="text-xs text-muted">
        <Kbd>*label</Kbd> <Kbd>+Project</Kbd> <Kbd>!1–4</Kbd> priority, dates like "tomorrow 5pm", "fri", "every week".
      </p>
    </Dialog>
  )
}
