// A board column's chrome: its head (grip to reorder, name with double-click rename, count or WIP limit,
// the column menu with its confirm and WIP dialog), "Add task" at its foot, and the "Add column" column.
import { useState, type DragEvent } from 'react'
import { Icon } from '../../components/Icon'
import { Button, Confirm, Dialog, Field, fieldClass, Input, Menu, MenuItem, MenuSeparator } from '../../components/ui'
import { cn } from '../../lib/cn'
import { useCreateTask } from '../../lib/queries'
import { previewQuick } from '../../lib/quick'
import type { Bucket, Task } from '../../lib/types'
import { useDeleteBucket, useSaveBucket } from './api'
import { between } from './order'

/** A column's box (cards, add column). */
export const column = 'flex max-h-full flex-[0_0_18rem] flex-col rounded-md border max-md:basis-[85vw]'

export function ColumnHead({
  bucket,
  total,
  open,
  projectId,
  writable,
  cols,
  onGrab,
  onRelease,
}: {
  bucket: Bucket
  total: number
  open: number
  projectId: string
  writable: boolean
  cols: Bucket[]
  onGrab: (e: DragEvent) => void
  onRelease: () => void
}) {
  const save = useSaveBucket(projectId)
  const remove = useDeleteBucket()
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(bucket.name)
  const [confirm, setConfirm] = useState(false)
  const [wip, setWip] = useState<string | null>(null)
  const over = bucket.limit > 0 && !bucket.is_done && open > bucket.limit
  const i = cols.findIndex((b) => b.id === bucket.id)
  const saveWip = () => {
    if (wip != null) save.mutate({ id: bucket.id, body: { limit: Math.max(0, Math.min(999, Number.parseInt(wip || '0', 10) || 0)) } })
    setWip(null)
  }
  const moveTo = (position: number) => save.mutate({ id: bucket.id, body: { position } })
  return (
    <div className="group/head flex h-10 flex-none items-center gap-1.5 pr-1 pl-3">
      {writable && (
        <span
          className="-ml-1.5 inline-flex cursor-grab text-muted opacity-50 group-hover/head:opacity-100"
          draggable
          onDragStart={onGrab}
          onDragEnd={onRelease}
          title="Drag to reorder"
          aria-hidden="true"
        >
          <Icon name="grip" size={14} />
        </span>
      )}
      {editing ? (
        <input
          className={fieldClass.input({ size: 'sm', className: 'text-sm' })}
          autoFocus
          value={name}
          maxLength={64}
          aria-label="Column name"
          onChange={(e) => setName(e.target.value)}
          onBlur={() => {
            setEditing(false)
            if (name.trim() && name.trim() !== bucket.name) save.mutate({ id: bucket.id, body: { name: name.trim() } })
            else setName(bucket.name)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
            if (e.key === 'Escape') {
              e.stopPropagation()
              setName(bucket.name)
              setEditing(false)
            }
          }}
        />
      ) : (
        <h3
          className="flex min-w-0 items-center gap-1 truncate text-sm"
          onDoubleClick={() => writable && setEditing(true)}
          title={writable ? 'Double-click to rename' : undefined}
        >
          {bucket.is_done && <Icon name="check" size={13} className="text-success" title="Tasks moved here are marked done" />}
          {bucket.name}
        </h3>
      )}
      <span
        className={cn('text-xs tabular-nums', over ? 'font-semibold text-danger' : 'text-muted')}
        title={bucket.limit ? `WIP limit ${bucket.limit}` : undefined}
      >
        {bucket.limit > 0 && !bucket.is_done ? `${open} / ${bucket.limit}` : total.toLocaleString()}
      </span>
      <span className="flex-1" />
      {writable && (
        <Menu
          align="end"
          label="Column actions"
          trigger={(p) => (
            <Button {...p} variant="ghost" size="sm" icon aria-label={`${bucket.name} column actions`}>
              <Icon name="more" size={14} />
            </Button>
          )}
        >
          {(close) => {
            const act = (fn: () => void) => () => {
              close()
              fn()
            }
            return (
              <>
                <MenuItem icon="edit" onClick={act(() => setEditing(true))}>
                  Rename
                </MenuItem>
                <MenuItem icon="filter" onClick={act(() => setWip(String(bucket.limit || 0)))}>
                  {bucket.limit ? `WIP limit: ${bucket.limit}…` : 'Set WIP limit…'}
                </MenuItem>
                {!bucket.is_done && (
                  <MenuItem icon="check" onClick={act(() => save.mutate({ id: bucket.id, body: { is_done: true } }))}>
                    Use as "done" column
                  </MenuItem>
                )}
                <MenuSeparator />
                {i > 0 && (
                  <MenuItem icon="chevronLeft" onClick={act(() => moveTo(between(cols[i - 2]?.position, cols[i - 1].position)))}>
                    Move left
                  </MenuItem>
                )}
                {i < cols.length - 1 && (
                  <MenuItem icon="chevronRight" onClick={act(() => moveTo(between(cols[i + 1].position, cols[i + 2]?.position)))}>
                    Move right
                  </MenuItem>
                )}
                {cols.length > 1 && (
                  <>
                    <MenuSeparator />
                    <MenuItem icon="trash" danger onClick={act(() => setConfirm(true))}>
                      Delete column…
                    </MenuItem>
                  </>
                )}
              </>
            )
          }}
        </Menu>
      )}
      <Confirm
        open={confirm}
        title={`Delete "${bucket.name}"?`}
        body="Its tasks move to another column."
        onConfirm={() => remove.mutate(bucket.id)}
        onClose={() => setConfirm(false)}
      />
      <Dialog
        open={wip != null}
        onClose={() => setWip(null)}
        title={`WIP limit for "${bucket.name}"`}
        width="22rem"
        footer={
          <>
            <span className="flex-1" />
            <Button onClick={() => setWip(null)}>Cancel</Button>
            <Button variant="primary" onClick={saveWip}>
              Save
            </Button>
          </>
        }
      >
        <form
          onSubmit={(e) => {
            e.preventDefault()
            saveWip()
          }}
        >
          <Field label="Maximum open tasks (0 = no limit)">
            <Input type="number" min={0} max={999} autoFocus value={wip ?? ''} onChange={(e) => setWip(e.target.value)} />
          </Field>
        </form>
      </Dialog>
    </div>
  )
}

const addButton =
  'mx-2 mt-1.5 mb-2 flex h-8 flex-none items-center gap-1.5 rounded-sm border-0 bg-transparent px-2 text-sm text-muted hover:bg-hover hover:text-fg'

export function AddCard({
  projectId,
  bucket,
  listKey,
  last,
}: {
  projectId: string
  bucket: Bucket
  listKey: readonly unknown[]
  last?: Task
}) {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const create = useCreateTask()
  if (!open)
    return (
      <button type="button" className={addButton} onClick={() => setOpen(true)}>
        <Icon name="plus" size={14} />
        Add task
      </button>
    )
  const submit = () => {
    const t = title.trim()
    if (!t) return setOpen(false)
    // Natural language ("Call mom fri !3") straight into this column.
    const position = between(last?.position)
    const clean = previewQuick(t).title || t
    create.mutate({
      quick: t,
      body: { title: clean, project_id: projectId, bucket_id: bucket.id },
      listKey,
      optimistic: { title: clean, project_id: projectId, bucket_id: bucket.id, position },
    })
    setTitle('')
  }
  return (
    <form
      className="px-2 pt-1.5 pb-2"
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
    >
      <Input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder='Task, e.g. "Call mom fri !3"'
        maxLength={256}
        onBlur={() => !title.trim() && setOpen(false)}
        onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
        aria-label={`New task in ${bucket.name}`}
      />
    </form>
  )
}

export function AddColumn({ onAdd }: { onAdd: (name: string) => void }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  return (
    <div className={cn(column, 'border-dashed border-border bg-transparent')}>
      {open ? (
        <form
          className="p-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (name.trim()) onAdd(name.trim())
            setName('')
            setOpen(false)
          }}
        >
          <Input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Column name"
            aria-label="Column name"
            maxLength={64}
            onBlur={() => !name && setOpen(false)}
          />
        </form>
      ) : (
        <button type="button" className={addButton} onClick={() => setOpen(true)}>
          <Icon name="plus" size={14} />
          Add column
        </button>
      )}
    </div>
  )
}
