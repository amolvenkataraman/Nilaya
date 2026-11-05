// Kanban board for one project: buckets as columns, drag and drop (HTML5 DnD) between and within
// columns, plus a "Move to" menu on each card for keyboard and touch users.
import { useMemo, useRef, useState, type CSSProperties, type DragEvent } from 'react'
import { Icon } from '../../components/Icon'
import { Avatar, Confirm, Dialog, ErrorBox, Menu, MenuItem } from '../../components/ui'
import { Ring, TaskCheck, dueTone, fmtMinutes, hoverText } from '../../components/TaskRow'
import { toast } from '../../components/toast'
import { keys, useBuckets, useCreateTask, useMoveTask, useSetDone, useTasks } from '../../lib/queries'
import { fmtStamp, dueLabel } from '../../lib/dates'
import type { Bucket, Label, Task } from '../../lib/types'
import { useDeleteBucket, useReorderTasks, useSaveBucket } from './api'
import { previewQuick } from '../../lib/quick'
import type { Selection } from './selection'
import { boardParams, repeatText } from './util'

/** The board's task query (shared with the page, which reads the same cache for the bulk bar). */
/** WIP counts open top-level tasks, as the server does. */
const openCount = (items: Task[]) => items.filter((t) => !t.done && !t.parent_id).length
const atLimit = (b: Bucket, items: Task[]) => b.limit > 0 && !b.is_done && openCount(items) >= b.limit
/** A position between two neighbours (for buckets moved left/right or dropped). */
const between = (a?: number, b?: number) => (a == null ? (b == null ? 1 : b - 1) : b == null ? a + 1 : (a + b) / 2)

const byPosition = (a: Task, b: Task) => a.position - b.position || a.created_on.localeCompare(b.created_on)

/** Position between two neighbours (or past the end); pure, so the drop is predictable. */
export function positionBetween(prev?: Task, next?: Task): number {
  if (prev && next) return next.position > prev.position ? (prev.position + next.position) / 2 : prev.position + 0.5
  if (prev) return prev.position + 1
  if (next) return next.position - 1
  return 1
}

export function Board({ projectId, labels, q, onOpen, writable, hidden, sel, selected }: {
  projectId: string; labels?: Label[]; q: string; onOpen: (t: Task) => void; writable: boolean; hidden: Set<string>; sel: Selection; selected: string | null
}) {
  const buckets = useBuckets(projectId)
  const params = boardParams(projectId, q)
  const tasks = useTasks(params)
  const move = useMoveTask()
  const setDone = useSetDone()
  const saveBucket = useSaveBucket(projectId)
  const reorder = useReorderTasks(projectId)
  const [drag, setDrag] = useState<{ id: string; over: number | null; index: number } | null>(null)
  const [colDrag, setColDrag] = useState<{ id: number; over: number | null; before: boolean } | null>(null)
  const colRefs = useRef(new Map<number, HTMLDivElement>())

  const cols = useMemo(() => {
    const list = [...(buckets.data ?? [])].sort((a, b) => a.position - b.position)
    const first = list.find((b) => !b.is_done) ?? list[0]
    const map = new Map<number, Task[]>(list.map((b) => [b.id, []]))
    for (const t of tasks.data?.items ?? []) {
      if (hidden.has(t.id)) continue
      const id = t.bucket_id && map.has(t.bucket_id) ? t.bucket_id : first?.id
      if (id != null) map.get(id)!.push(t)
    }
    return list.map((b) => ({ bucket: b, items: map.get(b.id)!.sort(byPosition) }))
  }, [buckets.data, tasks.data, hidden])
  const order = cols.flatMap((c) => c.items.map((t) => t.id))

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
    if (task.bucket_id !== bucket.id && atLimit(bucket, col?.items ?? [])) return toast.error(`"${bucket.name}" is at its limit of ${bucket.limit}.`)
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
          className={'board-col' + (drag?.over === bucket.id ? ' drop' : '') + (colDrag?.over === bucket.id ? (colDrag.before ? ' col-before' : ' col-after') : '') + (colDrag?.id === bucket.id ? ' dragging' : '')}
          onDragOver={(e: DragEvent) => {
            if (colDrag) {
              e.preventDefault()
              const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
              const before = e.clientX < r.left + r.width / 2
              const overId = bucket.id === colDrag.id ? null : bucket.id
              if (colDrag.over !== overId || colDrag.before !== before) setColDrag({ ...colDrag, over: overId, before })
              return
            }
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
            if (colDrag) {
              if (colDrag.over != null) {
                const rest = cols.map((c) => c.bucket).filter((b) => b.id !== colDrag.id)
                const i = rest.findIndex((b) => b.id === colDrag.over)
                const [a, b] = colDrag.before ? [rest[i - 1], rest[i]] : [rest[i], rest[i + 1]]
                saveBucket.mutate({ id: colDrag.id, body: { position: between(a?.position, b?.position) } })
              }
              setColDrag(null)
              return
            }
            const id = e.dataTransfer.getData('text/x-task') || drag?.id
            if (id) dropAt(id, bucket, indexAt(bucket.id, e.clientY))
            setDrag(null)
          }}
        >
          <ColumnHead bucket={bucket} items={items} projectId={projectId} writable={writable} cols={cols.map((c) => c.bucket)}
            onGrab={(e) => { e.dataTransfer.setData('text/x-bucket', String(bucket.id)); e.dataTransfer.effectAllowed = 'move'; setTimeout(() => setColDrag({ id: bucket.id, over: null, before: true }), 0) }}
            onRelease={() => setColDrag(null)} />
          <div className="board-cards" ref={(el) => { if (el) colRefs.current.set(bucket.id, el); else colRefs.current.delete(bucket.id) }}>
            {items.map((t, i) => (
              <div key={t.id}>
                {drag?.over === bucket.id && drag.index === i && drag.id !== t.id && <div className="drop-line" />}
                <Card
                  task={t}
                  labels={labels}
                  buckets={cols.map((c) => c.bucket)}
                  dragging={drag?.id === t.id}
                  picked={sel.has(t.id) || t.id === selected}
                  draggable={writable}
                  onOpen={(e) => { if (sel.click(e, t.id, order)) return; sel.clear(); onOpen(t) }}
                  onToggle={() => setDone.mutate({ task: t, done: !t.done })}
                  onMove={(b) => {
                    const col = cols.find((c) => c.bucket.id === b.id)
                    if (atLimit(b, col?.items ?? [])) return toast.error(`"${b.name}" is at its limit of ${b.limit}.`)
                    move.mutate({ id: t.id, bucket_id: b.id, position: positionBetween(col?.items.at(-1)) })
                  }}
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
          {writable && <AddCard projectId={projectId} bucket={bucket} listKey={keys.taskList(params)} last={items.at(-1)} />}
        </div>
      ))}
      {writable && <AddColumn onAdd={(name) => saveBucket.mutate({ body: { name, position: between(cols.at(-1)?.bucket.position) } })} />}
    </div>
  )
}

function Card({ task, labels, buckets, dragging, picked, draggable, onOpen, onToggle, onMove, onDragStart, onDragEnd }: {
  task: Task; labels?: Label[]; buckets: Bucket[]; dragging: boolean; picked: boolean; draggable: boolean; onOpen: (e: React.MouseEvent) => void; onToggle: () => void
  onMove: (b: Bucket) => void; onDragStart: (e: DragEvent) => void; onDragEnd: () => void
}) {
  const tone = dueTone(task.due, task.done)
  const taskLabels = labels?.filter((l) => task.labels.includes(l.id)) ?? []
  const future = task.start && !task.done && new Date(task.start) > new Date()
  const rem = task.reminders.some((r) => !r.sent)
  // An optimistic PATCH briefly stores assignees as usernames.
  const who = task.assignees.map((a) => (typeof a === 'string' ? { username: a as string, name: a as string } : a))
  const hasMeta = task.due || task.done_at || future || task.subtasks || task.comments || task.priority >= 15 || task.repeat_mode || rem || task.percent || task.time_spent || task.assignees.length
  return (
    <div
      className={'board-card' + (task.done ? ' done' : '') + (dragging ? ' dragging' : '') + (picked ? ' picked' : '') + (task.colour ? ' coloured' : '')}
      style={task.colour ? ({ '--task-colour': task.colour } as CSSProperties) : undefined}
      data-card={task.id}
      data-task={task.id}
      draggable={draggable && !task.id.startsWith('temp-')}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onOpen}
    >
      {taskLabels.length > 0 && <div className="board-card-labels">{taskLabels.slice(0, 4).map((l) => <span key={l.id} className="label-chip" style={{ '--lc': l.colour || undefined } as CSSProperties}>{l.name}</span>)}{taskLabels.length > 4 && <span className="label-chip">+{taskLabels.length - 4}</span>}</div>}
      <div className="board-card-top">
        <TaskCheck task={task} onToggle={onToggle} />
        <button type="button" className="board-card-title" title={hoverText(task, taskLabels)} onClick={(e) => (e.stopPropagation(), onOpen(e))}>
          {task.title}{task.description && <Icon name="list" size={12} className="task-desc-icon" title="Has a description" />}
        </button>
        {/* Menu items are portaled, but React events still bubble to the card: don't let them open it. */}
        <span className="card-menu" onClick={(e) => e.stopPropagation()}>
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
        </span>
      </div>
      {hasMeta ? (
        <div className="task-meta board-card-meta">
          {task.priority >= 15 && <span className={'task-flag ' + (task.priority >= 20 ? 'urgent' : 'high')}><Icon name="flag" size={12} />{task.priority_label}</span>}
          {task.done && task.done_at ? <span className="meta-count"><Icon name="check" size={12} />{dueLabel(task.done_at)}</span>
            : task.due && <span className={'meta-due ' + tone}><Icon name="calendar" size={12} />{dueLabel(task.due)}</span>}
          {future && <span className="meta-count" title={`Starts ${fmtStamp(task.start!)}`}><Icon name="play" size={12} />{dueLabel(task.start!)}</span>}
          {!!task.subtasks && <span className="meta-count"><Icon name="subtask" size={12} />{task.subtasks_done}/{task.subtasks}</span>}
          {!!task.comments && <span className="meta-count"><Icon name="comment" size={12} />{task.comments}</span>}
          {task.repeat_mode > 0 && <span className="meta-count" title={repeatText(task.repeat_mode, task.repeat_every)}><Icon name="repeat" size={12} /></span>}
          {rem && <span className="meta-count" title="Reminder set"><Icon name="bell" size={12} /></span>}
          {task.percent > 0 && <span className="meta-count" title={`${task.percent}% done`}><Ring value={task.percent} />{task.percent}%</span>}
          {task.time_spent > 0 && <span className="meta-count" title="Time spent"><Icon name="clock" size={12} />{fmtMinutes(task.time_spent)}</span>}
          {who.length > 0 && <span className="board-avatars" title={who.map((a) => a.name || a.username).join(', ')}>{who.slice(0, 2).map((a) => <Avatar key={a.username} name={a.name || a.username} size={1.125} />)}{task.assignees.length > 2 && <span className="muted">+{task.assignees.length - 2}</span>}</span>}
        </div>
      ) : null}
    </div>
  )
}

function ColumnHead({ bucket, items, projectId, writable, cols, onGrab, onRelease }: {
  bucket: Bucket; items: Task[]; projectId: string; writable: boolean; cols: Bucket[]; onGrab: (e: DragEvent) => void; onRelease: () => void
}) {
  const save = useSaveBucket(projectId)
  const remove = useDeleteBucket()
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(bucket.name)
  const [confirm, setConfirm] = useState(false)
  const [wip, setWip] = useState<string | null>(null)
  const open = openCount(items)
  const over = bucket.limit > 0 && !bucket.is_done && open > bucket.limit
  const i = cols.findIndex((b) => b.id === bucket.id)
  const saveWip = () => { if (wip != null) save.mutate({ id: bucket.id, body: { limit: Math.max(0, Math.min(999, parseInt(wip || '0', 10) || 0)) } }); setWip(null) }
  return (
    <div className="board-col-head">
      {writable && <span className="col-grip" draggable onDragStart={onGrab} onDragEnd={onRelease} title="Drag to reorder" aria-hidden="true"><Icon name="grip" size={14} /></span>}
      {editing ? (
        <input
          className="input"
          autoFocus
          value={name}
          maxLength={64}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => { setEditing(false); if (name.trim() && name.trim() !== bucket.name) save.mutate({ id: bucket.id, body: { name: name.trim() } }); else setName(bucket.name) }}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') { e.stopPropagation(); setName(bucket.name); setEditing(false) } }}
        />
      ) : (
        <h3 className="truncate" onDoubleClick={() => writable && setEditing(true)} title={writable ? 'Double-click to rename' : undefined}>
          {bucket.is_done && <Icon name="check" size={13} title="Tasks moved here are marked done" />}{bucket.name}
        </h3>
      )}
      <span className={'board-count' + (over ? ' over' : '')} title={bucket.limit ? `WIP limit ${bucket.limit}` : undefined}>{bucket.limit > 0 && !bucket.is_done ? `${open} / ${bucket.limit}` : items.length}</span>
      <span className="spacer" />
      {writable && (
        <Menu align="end" label="Column actions" trigger={(p) => <button {...p} className="btn ghost icon sm" aria-label={`${bucket.name} column actions`}><Icon name="more" size={14} /></button>}>
          {(close) => (
            <>
              <MenuItem icon="edit" onClick={() => (close(), setEditing(true))}>Rename</MenuItem>
              <MenuItem icon="filter" onClick={() => (close(), setWip(String(bucket.limit || 0)))}>{bucket.limit ? `WIP limit: ${bucket.limit}…` : 'Set WIP limit…'}</MenuItem>
              {!bucket.is_done && <MenuItem icon="check" onClick={() => (close(), save.mutate({ id: bucket.id, body: { is_done: true } }))}>Use as "done" column</MenuItem>}
              <div className="menu-sep" />
              {i > 0 && <MenuItem icon="chevronLeft" onClick={() => (close(), save.mutate({ id: bucket.id, body: { position: between(cols[i - 2]?.position, cols[i - 1].position) } }))}>Move left</MenuItem>}
              {i < cols.length - 1 && <MenuItem icon="chevronRight" onClick={() => (close(), save.mutate({ id: bucket.id, body: { position: between(cols[i + 1].position, cols[i + 2]?.position) } }))}>Move right</MenuItem>}
              {cols.length > 1 && <><div className="menu-sep" /><MenuItem icon="trash" danger onClick={() => (close(), setConfirm(true))}>Delete column…</MenuItem></>}
            </>
          )}
        </Menu>
      )}
      <Confirm open={confirm} title={`Delete "${bucket.name}"?`} body="Its tasks move to another column." onConfirm={() => remove.mutate(bucket.id)} onClose={() => setConfirm(false)} />
      <Dialog open={wip != null} onClose={() => setWip(null)} title={`WIP limit for "${bucket.name}"`} width="22rem"
        footer={<><span className="spacer" /><button className="btn" onClick={() => setWip(null)}>Cancel</button><button className="btn primary" onClick={saveWip}>Save</button></>}>
        <form onSubmit={(e) => (e.preventDefault(), saveWip())}>
          <label className="field"><span>Maximum open tasks (0 = no limit)</span><input className="input" type="number" min={0} max={999} autoFocus value={wip ?? ''} onChange={(e) => setWip(e.target.value)} /></label>
        </form>
      </Dialog>
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
