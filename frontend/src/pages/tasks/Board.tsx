// Kanban board for one project: buckets as columns, drag and drop (HTML5 DnD) between and within
// columns, plus a "Move to" menu on each card for keyboard and touch users.
import { useMemo, useRef, useState, type DragEvent } from 'react'
import { Icon } from '../../components/Icon'
import { Confirm, ErrorBox, Menu, MenuItem } from '../../components/ui'
import { TaskCheck, dueTone } from '../../components/TaskRow'
import { keys, useBuckets, useCreateTask, useMoveTask, useSetDone, useTasks } from '../../lib/queries'
import { dueLabel } from '../../lib/dates'
import type { Bucket, Label, Task } from '../../lib/types'
import { useDeleteBucket, useReorderTasks, useSaveBucket } from './api'
import { previewQuick } from '../../lib/quick'

const byPosition = (a: Task, b: Task) => a.position - b.position || a.created_on.localeCompare(b.created_on)

/** Position between two neighbours (or past the end); pure, so the drop is predictable. */
export function positionBetween(prev?: Task, next?: Task): number {
  if (prev && next) return next.position > prev.position ? (prev.position + next.position) / 2 : prev.position + 0.5
  if (prev) return prev.position + 1
  if (next) return next.position - 1
  return 1
}

export function Board({ projectId, labels, q, onOpen }: { projectId: string; labels?: Label[]; q: string; onOpen: (t: Task) => void }) {
  const buckets = useBuckets(projectId)
  const params = { project: projectId, top_level: true, sort: 'position', limit: 500, q: q || undefined }
  const tasks = useTasks(params)
  const move = useMoveTask()
  const setDone = useSetDone()
  const saveBucket = useSaveBucket(projectId)
  const reorder = useReorderTasks(projectId)
  const [drag, setDrag] = useState<{ id: string; over: number | null; index: number } | null>(null)
  const colRefs = useRef(new Map<number, HTMLDivElement>())

  const cols = useMemo(() => {
    const list = [...(buckets.data ?? [])].sort((a, b) => a.position - b.position)
    const first = list.find((b) => !b.is_done) ?? list[0]
    const map = new Map<number, Task[]>(list.map((b) => [b.id, []]))
    for (const t of tasks.data?.items ?? []) {
      const id = t.bucket_id && map.has(t.bucket_id) ? t.bucket_id : first?.id
      if (id != null) map.get(id)!.push(t)
    }
    return list.map((b) => ({ bucket: b, items: map.get(b.id)!.sort(byPosition) }))
  }, [buckets.data, tasks.data])

  const indexAt = (bucketId: number, clientY: number) => {
    const el = colRefs.current.get(bucketId)
    if (!el) return 0
    const cards = Array.from(el.querySelectorAll<HTMLElement>('[data-card]')).filter((c) => c.dataset.card !== drag?.id)
    const i = cards.findIndex((c) => {
      const r = c.getBoundingClientRect()
      return clientY < r.top + r.height / 2
    })
    return i < 0 ? cards.length : i
  }

  const dropAt = (taskId: string, bucket: Bucket, index: number) => {
    const col = cols.find((c) => c.bucket.id === bucket.id)
    const list = (col?.items ?? []).filter((t) => t.id !== taskId)
    const task = tasks.data?.items.find((t) => t.id === taskId)
    if (!task) return
    if (task.bucket_id === bucket.id && col?.items.findIndex((t) => t.id === taskId) === index) return // dropped where it was
    // Then renumber the column 0..n on the server so positions never tie.
    const ids = [...list.slice(0, index).map((t) => t.id), taskId, ...list.slice(index).map((t) => t.id)]
    if (task.bucket_id === bucket.id) return reorder.mutate(ids)
    move.mutate({ id: taskId, bucket_id: bucket.id, position: positionBetween(list[index - 1], list[index]) }, { onSuccess: () => reorder.mutate(ids) })
  }

  if ((buckets.error && !buckets.data) || (tasks.error && !tasks.data)) return <ErrorBox error={buckets.error ?? tasks.error} />
  if (buckets.isPending || tasks.isPending) {
    return (
      <div className="board">
        {[0, 1, 2].map((i) => (
          <div key={i} className="board-col"><div className="board-col-head"><span className="sk" style={{ width: '40%', height: '0.875rem' }} /></div>
            {[0, 1, 2].slice(0, 3 - i).map((j) => <span key={j} className="sk" style={{ height: '3.5rem', margin: '0 0.5rem 0.5rem', display: 'block' }} />)}
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="board" role="list" aria-label="Board">
      {cols.map(({ bucket, items }) => (
        <div
          key={bucket.id}
          role="listitem"
          className={'board-col' + (drag?.over === bucket.id ? ' drop' : '')}
          onDragOver={(e: DragEvent) => {
            if (!drag) return
            e.preventDefault()
            e.dataTransfer.dropEffect = 'move'
            const index = indexAt(bucket.id, e.clientY)
            if (drag.over !== bucket.id || drag.index !== index) setDrag({ ...drag, over: bucket.id, index })
          }}
          onDragLeave={(e) => {
            if (drag && !(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) setDrag({ ...drag, over: null })
          }}
          onDrop={(e) => {
            e.preventDefault()
            const id = e.dataTransfer.getData('text/x-task') || drag?.id
            if (id) dropAt(id, bucket, indexAt(bucket.id, e.clientY))
            setDrag(null)
          }}
        >
          <ColumnHead bucket={bucket} count={items.filter((t) => !t.done || bucket.is_done).length} projectId={projectId} />
          <div className="board-cards" ref={(el) => { if (el) colRefs.current.set(bucket.id, el); else colRefs.current.delete(bucket.id) }}>
            {items.map((t, i) => (
              <div key={t.id}>
                {drag?.over === bucket.id && drag.index === i && drag.id !== t.id && <div className="drop-line" />}
                <Card
                  task={t}
                  labels={labels}
                  buckets={cols.map((c) => c.bucket)}
                  dragging={drag?.id === t.id}
                  onOpen={() => onOpen(t)}
                  onToggle={() => setDone.mutate({ task: t, done: !t.done })}
                  onMove={(b) => move.mutate({ id: t.id, bucket_id: b.id, position: positionBetween(cols.find((c) => c.bucket.id === b.id)?.items.at(-1)) })}
                  onDragStart={(e) => {
                    e.dataTransfer.setData('text/x-task', t.id)
                    e.dataTransfer.effectAllowed = 'move'
                    setTimeout(() => setDrag({ id: t.id, over: bucket.id, index: i }), 0)
                  }}
                  onDragEnd={() => setDrag(null)}
                />
              </div>
            ))}
            {drag?.over === bucket.id && drag.index >= items.filter((t) => t.id !== drag.id).length && <div className="drop-line" />}
            {items.length === 0 && !drag && <div className="board-empty">No tasks</div>}
          </div>
          <AddCard projectId={projectId} bucket={bucket} listKey={keys.taskList(params)} last={items.at(-1)} />
        </div>
      ))}
      <AddColumn onAdd={(name) => saveBucket.mutate({ body: { name } })} />
    </div>
  )
}

function Card({ task, labels, buckets, dragging, onOpen, onToggle, onMove, onDragStart, onDragEnd }: {
  task: Task; labels?: Label[]; buckets: Bucket[]; dragging: boolean; onOpen: () => void; onToggle: () => void
  onMove: (b: Bucket) => void; onDragStart: (e: DragEvent) => void; onDragEnd: () => void
}) {
  const tone = dueTone(task.due, task.done)
  const taskLabels = labels?.filter((l) => task.labels.includes(l.id)) ?? []
  return (
    <div
      className={'board-card' + (task.done ? ' done' : '') + (dragging ? ' dragging' : '')}
      data-card={task.id}
      data-task={task.id}
      draggable={!task.id.startsWith('temp-')}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onOpen}
    >
      <div className="board-card-top">
        <TaskCheck task={task} onToggle={onToggle} />
        <button type="button" className="board-card-title" onClick={(e) => (e.stopPropagation(), onOpen())}>{task.title}</button>
        <Menu align="end" label="Card actions" trigger={(p) => (
          <button {...p} className="btn ghost icon sm card-more" aria-label={`Actions for "${task.title}"`} onClick={(e) => { e.stopPropagation(); p.onClick() }}><Icon name="more" size={14} /></button>
        )}>
          {(close) => (
            <>
              <div className="menu-label">Move to</div>
              {buckets.map((b) => (
                <MenuItem key={b.id} icon={b.id === task.bucket_id ? 'check' : 'arrowRight'} onClick={() => (close(), b.id !== task.bucket_id && onMove(b))}>{b.name}</MenuItem>
              ))}
            </>
          )}
        </Menu>
      </div>
      {(task.due || taskLabels.length || task.subtasks || task.comments || task.priority >= 15) ? (
        <div className="task-meta board-card-meta">
          {task.priority >= 15 && <span className={'task-flag ' + (task.priority >= 20 ? 'urgent' : 'high')}><Icon name="flag" size={12} />{task.priority_label}</span>}
          {task.due && <span className={'meta-due ' + tone}><Icon name="calendar" size={12} />{dueLabel(task.due)}</span>}
          {taskLabels.map((l) => <span key={l.id} className="meta-label"><Icon name="tag" size={11} />{l.name}</span>)}
          {!!task.subtasks && <span className="meta-count"><Icon name="subtask" size={12} />{task.subtasks_done}/{task.subtasks}</span>}
          {!!task.comments && <span className="meta-count"><Icon name="comment" size={12} />{task.comments}</span>}
        </div>
      ) : null}
    </div>
  )
}

function ColumnHead({ bucket, count, projectId }: { bucket: Bucket; count: number; projectId: string }) {
  const save = useSaveBucket(projectId)
  const remove = useDeleteBucket()
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(bucket.name)
  const [confirm, setConfirm] = useState(false)
  const over = bucket.limit > 0 && count >= bucket.limit
  return (
    <div className="board-col-head">
      {editing ? (
        <input
          className="input"
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => { setEditing(false); if (name.trim() && name !== bucket.name) save.mutate({ id: bucket.id, body: { name: name.trim() } }) }}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') { setName(bucket.name); setEditing(false) } }}
        />
      ) : (
        <h3 className="truncate" onDoubleClick={() => setEditing(true)}>
          {bucket.is_done && <Icon name="check" size={13} />}{bucket.name}
        </h3>
      )}
      <span className={'board-count' + (over ? ' over' : '')}>{count}{bucket.limit > 0 ? `/${bucket.limit}` : ''}</span>
      <span className="spacer" />
      <Menu align="end" label="Column actions" trigger={(p) => <button {...p} className="btn ghost icon sm" aria-label={`${bucket.name} column actions`}><Icon name="more" size={14} /></button>}>
        {(close) => (
          <>
            <MenuItem icon="edit" onClick={() => (close(), setEditing(true))}>Rename</MenuItem>
            {!bucket.is_done && <MenuItem icon="check" onClick={() => (close(), save.mutate({ id: bucket.id, body: { is_done: true } }))}>Use as "done" column</MenuItem>}
            <div className="menu-sep" />
            <MenuItem icon="trash" danger onClick={() => (close(), setConfirm(true))}>Delete column</MenuItem>
          </>
        )}
      </Menu>
      <Confirm open={confirm} title={`Delete "${bucket.name}"?`} body="Its tasks move to another column." onConfirm={() => remove.mutate(bucket.id)} onClose={() => setConfirm(false)} />
    </div>
  )
}

function AddCard({ projectId, bucket, listKey, last }: { projectId: string; bucket: Bucket; listKey: readonly unknown[]; last?: Task }) {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const create = useCreateTask()
  if (!open) return <button className="board-add" onClick={() => setOpen(true)}><Icon name="plus" size={14} />Add task</button>
  const submit = () => {
    const t = title.trim()
    if (!t) return setOpen(false)
    // Natural language ("Call mom fri !3") straight into this column.
    const position = positionBetween(last)
    const clean = previewQuick(t).title || t
    create.mutate({ quick: t, body: { title: clean, project_id: projectId, bucket_id: bucket.id }, listKey, optimistic: { title: clean, project_id: projectId, bucket_id: bucket.id, position } })
    setTitle('')
  }
  return (
    <form className="board-add-form" onSubmit={(e) => (e.preventDefault(), submit())}>
      <input className="input" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder='Task, e.g. "Call mom fri !3"' maxLength={256}
        onBlur={() => !title.trim() && setOpen(false)} onKeyDown={(e) => e.key === 'Escape' && setOpen(false)} aria-label={`New task in ${bucket.name}`} />
    </form>
  )
}

function AddColumn({ onAdd }: { onAdd: (name: string) => void }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  return (
    <div className="board-col add-col">
      {open ? (
        <form onSubmit={(e) => { e.preventDefault(); if (name.trim()) onAdd(name.trim()); setName(''); setOpen(false) }} style={{ padding: '0.5rem' }}>
          <input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Column name" maxLength={64} onBlur={() => !name && setOpen(false)} />
        </form>
      ) : (
        <button className="board-add" onClick={() => setOpen(true)}><Icon name="plus" size={14} />Add column</button>
      )}
    </div>
  )
}
