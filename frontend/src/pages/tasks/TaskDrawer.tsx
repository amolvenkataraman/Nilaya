// Task detail drawer: title, properties, description, subtasks, relations and comments.
// Edits save on blur/change with optimistic updates (lib/queries useUpdateTask / useMoveTask).
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { Icon } from '../../components/Icon'
import { Avatar, Confirm, Drawer, ErrorBox, Menu, MenuItem, SkeletonRows } from '../../components/ui'
import { TaskCheck, TaskRow } from '../../components/TaskRow'
import { QuickAddInput } from '../../components/QuickAdd'
import { toast } from '../../components/toast'
import {
  keys, useComments, useDeleteTask, useLabels, useMe, useMoveTask, useProjects, useSetDone, useTask, useTasks, useUpdateTask,
} from '../../lib/queries'
import { addDays, dueLabel, fromLocalInput, shortStamp, startOfDay, toLocalInput } from '../../lib/dates'
import { PRIORITIES, type TaskDetail } from '../../lib/types'
import { useAddComment, useDeleteComment, useDuplicateTask } from './api'
import './tasks.css'
import { PROJECT_COLOURS } from './ProjectDialog'
import { fmtMinutes } from '../../components/TaskRow'

const REPEAT_TEXT: Record<number, string> = { 1: 'Repeats', 2: 'Repeats monthly', 3: 'Repeats from completion' }
const REPEAT_OPTS: Record<string, [number, number | null]> = {
  'Does not repeat': [0, null], 'Every day': [1, 86400], 'Every week': [1, 604800], 'Every 2 weeks': [1, 1209600], 'Every month': [2, null], 'Every year': [1, 31536000],
}
function repeatKey(mode: number, every: number | null): string {
  const hit = Object.entries(REPEAT_OPTS).find(([, [m, e]]) => m === mode && (e ?? null) === (every ?? null))
  if (hit) return hit[0]
  return mode === 3 ? 'After completion' : 'Custom'
}

export function TaskDrawer({ id, onClose, onOpen }: { id: string | null; onClose: () => void; onOpen: (id: string) => void }) {
  const task = useTask(id && !id.startsWith('temp-') ? id : null)
  return (
    <Drawer open={!!id} onClose={onClose} label="Task details">
      {task.isPending ? (
        <div style={{ padding: '1rem' }}><SkeletonRows rows={6} /></div>
      ) : task.error && !task.data ? (
        <div className="drawer-body"><button className="btn ghost icon sm" onClick={onClose} aria-label="Close"><Icon name="x" /></button><ErrorBox error={task.error} /></div>
      ) : task.data ? (
        <Detail key={task.data.id} task={task.data} onClose={onClose} onOpen={onOpen} />
      ) : null}
    </Drawer>
  )
}

function Detail({ task, onClose, onOpen }: { task: TaskDetail; onClose: () => void; onOpen: (id: string) => void }) {
  const projects = useProjects().data
  const labels = useLabels().data
  const me = useMe().data
  const update = useUpdateTask()
  const move = useMoveTask()
  const setDone = useSetDone()
  const remove = useDeleteTask()
  const duplicate = useDuplicateTask()
  const [title, setTitle] = useState(task.title)
  const [desc, setDesc] = useState(task.description)
  const [confirm, setConfirm] = useState(false)
  const titleRef = useRef<HTMLTextAreaElement>(null)
  useEffect(() => setTitle(task.title), [task.title])
  useEffect(() => setDesc(task.description), [task.description])
  useEffect(() => autosize(titleRef.current), [title])

  const project = projects?.find((p) => p.id === task.project_id)
  const save = (body: Parameters<typeof update.mutate>[0]['body']) => update.mutate({ id: task.id, body })
  const setDue = (iso: string | null) => save({ due: iso })
  const endOf = (d: Date) => { const x = new Date(d); x.setHours(23, 59, 0, 0); return x.toISOString() }
  const today = startOfDay(new Date())

  return (
    <>
      <div className="drawer-head">
        <TaskCheck task={task} size="lg" onToggle={() => setDone.mutate({ task, done: !task.done })} />
        <span className="drawer-crumb truncate">
          {project ? <><span className="dot" style={{ background: project.colour || 'var(--app-muted)' }} />{project.name}</> : 'Task'}
          {task.parent_id && <> <Icon name="chevronRight" size={12} /> <button className="linkish" onClick={() => onOpen(task.parent_id!)}>Parent task</button></>}
        </span>
        <span className="spacer" />
        <button className={'btn ghost icon sm' + (task.favorite ? ' fav-on' : '')} onClick={() => save({ favorite: !task.favorite })} aria-pressed={task.favorite} aria-label={task.favorite ? 'Remove from favourites' : 'Add to favourites'} title="Favourite">
          <Icon name="star" />
        </button>
        <Menu align="end" label="Task actions" trigger={(p) => <button {...p} className="btn ghost icon sm" aria-label="Task actions"><Icon name="more" /></button>}>
          {(close) => (
            <>
              <MenuItem icon="copy" onClick={() => (close(), duplicate.mutate(task.id, { onSuccess: (t) => (toast.show('Duplicated'), onOpen(t.id)) }))}>Duplicate</MenuItem>
              {task.parent_id && <MenuItem icon="arrowUp" onClick={() => (close(), save({ parent_id: null }))}>Make top-level</MenuItem>}
              <MenuItem icon="link" onClick={() => { close(); navigator.clipboard?.writeText(`${location.origin}/app/tasks?view=all&task=${task.id}`).then(() => toast.show('Link copied')) }}>Copy link</MenuItem>
              <div className="menu-sep" />
              <MenuItem icon="trash" danger onClick={() => (close(), setConfirm(true))}>Delete task</MenuItem>
            </>
          )}
        </Menu>
        <button className="btn ghost icon sm" onClick={onClose} aria-label="Close details" title="Close (Esc)"><Icon name="x" /></button>
      </div>

      <div className="drawer-body">
        <textarea
          ref={titleRef}
          className={'detail-title' + (task.done ? ' done' : '')}
          value={title}
          rows={1}
          maxLength={256}
          aria-label="Title"
          onChange={(e) => setTitle(e.target.value.replace(/\n/g, ' '))}
          onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), (e.target as HTMLTextAreaElement).blur())}
          onBlur={() => { const t = title.trim(); if (t && t !== task.title) save({ title: t }); else setTitle(task.title) }}
        />

        <p className="detail-facts muted xsmall">
          {task.done && task.done_at ? <span><Icon name="check" size={11} /> Completed {shortStamp(task.done_at)}</span> : null}
          {!task.done && task.due && new Date(task.due) < new Date() ? <span className="danger-text"><Icon name="alert" size={11} /> Overdue since {shortStamp(task.due)}</span> : null}
          {task.event_id ? <Link to={`/calendar?event=${task.event_id}`}><Icon name="calendar" size={11} /> From a calendar event</Link> : null}
          {me && task.owner.id !== me.id ? <span><Icon name="user" size={11} /> Owned by {task.owner.name || task.owner.username}</span> : null}
        </p>
        <dl className="props">
          <dt><Icon name="folder" size={14} />Project</dt>
          <dd>
            <select className="select ghost-select" value={task.project_id ?? ''} aria-label="Project" onChange={(e) => move.mutate({ id: task.id, project_id: e.target.value })}>
              {projects?.filter((p) => !p.archived).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </dd>

          <dt><Icon name="calendar" size={14} />Due</dt>
          <dd className="due-cell">
            <input type="datetime-local" className="input ghost-input" aria-label="Due date" value={toLocalInput(task.due)} onChange={(e) => setDue(fromLocalInput(e.target.value))} />
            <div className="due-quick">
              <button className="chip" onClick={() => setDue(endOf(today))}>Today</button>
              <button className="chip" onClick={() => setDue(endOf(addDays(today, 1)))}>Tomorrow</button>
              <button className="chip" onClick={() => setDue(endOf(addDays(today, 7)))}>Next week</button>
              {task.due && <button className="chip" onClick={() => setDue(null)}>Clear</button>}
            </div>
            {task.repeat_mode > 0 && <span className="muted xsmall"><Icon name="repeat" size={12} /> {REPEAT_TEXT[task.repeat_mode] ?? 'Repeats'}{task.repeat_every ? ` every ${humanSeconds(task.repeat_every)}` : ''}</span>}
          </dd>

          <dt><Icon name="clock" size={14} />Start</dt>
          <dd>
            <input type="datetime-local" className="input ghost-input" aria-label="Start date" value={toLocalInput(task.start)} onChange={(e) => save({ start: fromLocalInput(e.target.value) })} />
            {task.start && <button className="chip" onClick={() => save({ start: null })}>Clear</button>}
          </dd>

          <dt><Icon name="flag" size={14} />Priority</dt>
          <dd>
            <div className="seg prio-seg" role="radiogroup" aria-label="Priority">
              {PRIORITIES.map((p) => (
                <button key={p.value} role="radio" aria-checked={task.priority === p.value} aria-pressed={task.priority === p.value} className={'prio-' + p.value} onClick={() => save({ priority: p.value })}>{p.label}</button>
              ))}
            </div>
          </dd>

          <dt><Icon name="tag" size={14} />Labels</dt>
          <dd className="label-cell">
            {labels?.length ? labels.map((l) => {
              const on = task.labels.includes(l.id)
              return (
                <button key={l.id} className={'chip' + (on ? ' accent' : '')} aria-pressed={on} onClick={() => save({ labels: on ? task.labels.filter((x) => x !== l.id) : [...task.labels, l.id] })}>
                  {on && <Icon name="check" size={11} />}{l.name}
                </button>
              )
            }) : <span className="muted xsmall">No labels yet. Type *label in quick add to create one.</span>}
          </dd>

          <dt><Icon name="repeat" size={14} />Repeat</dt>
          <dd>
            <select className="select ghost-select" aria-label="Repeat" value={repeatKey(task.repeat_mode, task.repeat_every)}
              onChange={(e) => { const [mode, every] = REPEAT_OPTS[e.target.value] ?? [0, null]; save({ repeat_mode: mode, repeat_every: every }) }}>
              {Object.keys(REPEAT_OPTS).map((k) => <option key={k} value={k}>{k}</option>)}
              {!(repeatKey(task.repeat_mode, task.repeat_every) in REPEAT_OPTS) && <option value={repeatKey(task.repeat_mode, task.repeat_every)}>{repeatKey(task.repeat_mode, task.repeat_every)}</option>}
            </select>
          </dd>

          <dt><Icon name="chart" size={14} />Progress</dt>
          <dd className="progress-cell">
            <input type="range" min={0} max={100} step={5} defaultValue={task.percent} key={task.percent} aria-label="Percent done"
              onPointerUp={(e) => save({ percent: Number((e.target as HTMLInputElement).value) })}
              onKeyUp={(e) => save({ percent: Number((e.target as HTMLInputElement).value) })} />
            <span className="tabular small">{task.percent}%</span>
          </dd>

          <dt><Icon name="clock" size={14} />Time spent</dt>
          <dd className="time-cell">
            <span className="tabular small">{fmtMinutes(task.time_spent)}</span>
            {[15, 30, 60].map((m) => <button key={m} className="chip" onClick={() => save({ time_spent: task.time_spent + m })}>+{m < 60 ? `${m}m` : '1h'}</button>)}
            {task.time_spent > 0 && <button className="chip" onClick={() => save({ time_spent: 0 })}>Reset</button>}
          </dd>

          <dt><Icon name="sparkle" size={14} />Colour</dt>
          <dd className="swatches">
            <button className="swatch none" role="radio" aria-checked={!task.colour} aria-label="No colour" onClick={() => save({ colour: '' })}>{!task.colour && <Icon name="check" size={11} />}</button>
            {PROJECT_COLOURS.map((c) => (
              <button key={c} className="swatch" role="radio" aria-checked={task.colour === c} aria-label={c} style={{ background: c }} onClick={() => save({ colour: c })}>{task.colour === c && <Icon name="check" size={11} />}</button>
            ))}
          </dd>

          {task.assignees.length > 0 && (
            <>
              <dt><Icon name="users" size={14} />Assignees</dt>
              <dd className="label-cell">{task.assignees.map((a) => <span key={a.id} className="chip"><Avatar name={a.name || a.username} size={0.875} />{a.name || a.username}</span>)}</dd>
            </>
          )}

          {task.reminders.length > 0 && (
            <>
              <dt><Icon name="bell" size={14} />Reminders</dt>
              <dd className="muted small">{task.reminders.map((r) => (r.fire_at ? dueLabel(r.fire_at) : 'Pending') + (r.sent ? ' (sent)' : '')).join(', ')}</dd>
            </>
          )}
        </dl>

        <label className="detail-section-label" htmlFor="task-desc">Description</label>
        <textarea
          id="task-desc"
          className="textarea detail-desc"
          value={desc}
          placeholder="Add details…"
          maxLength={10000}
          onChange={(e) => setDesc(e.target.value)}
          onBlur={() => desc !== task.description && save({ description: desc })}
        />

        <Subtasks task={task} onOpen={onOpen} />

        {task.relations.length > 0 && (
          <div className="detail-block">
            <div className="detail-section-label">Related</div>
            {task.relations.map((r) => (
              <button key={r.id} className="relation" onClick={() => onOpen(r.other_id)}>
                <span className="chip">{r.kind.replace(/_/g, ' ')}</span>
                <span className={'truncate' + (r.other_done ? ' muted strike' : '')}>{r.other_name}</span>
              </button>
            ))}
          </div>
        )}

        <Comments taskId={task.id} />

        <p className="detail-foot muted xsmall">
          Created by {task.owner.name || task.owner.username} · {shortStamp(task.created_on)} · updated {shortStamp(task.updated_on)}
        </p>
      </div>
      <Confirm open={confirm} title="Delete this task?" body={`"${task.title}" and its subtasks will be deleted.`} onConfirm={() => remove.mutate(task.id, { onSuccess: () => (toast.show('Task deleted'), onClose()) })} onClose={() => setConfirm(false)} />
    </>
  )
}

function Subtasks({ task, onOpen }: { task: TaskDetail; onOpen: (id: string) => void }) {
  const params = { parent: task.id, sort: 'position', limit: 200 }
  const subs = useTasks(params)
  const setDone = useSetDone()
  const items = subs.data?.items ?? []
  const done = items.filter((t) => t.done).length
  return (
    <div className="detail-block">
      <div className="detail-section-label">
        Subtasks {items.length > 0 && <span className="muted">{done}/{items.length}</span>}
        {items.length > 0 && <span className="sub-progress"><span style={{ width: `${(done / items.length) * 100}%` }} /></span>}
      </div>
      <div className="subtasks">
        {items.map((t) => <TaskRow key={t.id} task={t} showProject={false} onToggle={() => setDone.mutate({ task: t, done: !t.done })} onOpen={() => onOpen(t.id)} />)}
        <QuickAddInput compact parentId={task.id} projectId={task.project_id} listKey={keys.taskList(params)} placeholder="Add subtask" />
      </div>
    </div>
  )
}

function Comments({ taskId }: { taskId: string }) {
  const comments = useComments(taskId)
  const me = useMe().data
  const add = useAddComment(taskId)
  const remove = useDeleteComment(taskId)
  const [body, setBody] = useState('')
  const submit = () => {
    const b = body.trim()
    if (!b) return
    add.mutate(b, { onSuccess: () => setBody('') })
  }
  return (
    <div className="detail-block">
      <div className="detail-section-label">Comments {comments.data?.length ? <span className="muted">{comments.data.length}</span> : null}</div>
      <div className="comments">
        {comments.data?.map((c) => (
          <div key={c.id} className="comment">
            <Avatar name={c.author.name || c.author.username} size={1.5} />
            <div className="comment-main">
              <div className="comment-head">
                <strong>{c.author.name || c.author.username}</strong>
                <span className="muted">{shortStamp(c.created_on)}{c.edited_on ? ' · edited' : ''}</span>
                {me && c.author.id === me.id && (
                  <button className="btn ghost icon sm comment-del" aria-label="Delete comment" onClick={() => remove.mutate(c.id)}><Icon name="trash" size={12} /></button>
                )}
              </div>
              <div className="comment-body pre-wrap">{c.body}</div>
            </div>
          </div>
        ))}
        <form className="comment-form" onSubmit={(e) => (e.preventDefault(), submit())}>
          <textarea
            className="textarea"
            rows={2}
            value={body}
            maxLength={5000}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Write a comment…"
            aria-label="New comment"
            onKeyDown={(e) => (e.metaKey || e.ctrlKey) && e.key === 'Enter' && (e.preventDefault(), submit())}
          />
          {body.trim() && (
            <div className="row"><span className="muted xsmall grow">Ctrl+Enter to send</span><button className="btn primary sm" disabled={add.isPending}>Comment</button></div>
          )}
        </form>
      </div>
    </div>
  )
}

function autosize(el: HTMLTextAreaElement | null) {
  if (!el) return
  el.style.height = 'auto'
  el.style.height = el.scrollHeight + 'px'
}

function humanSeconds(s: number): string {
  const units: [number, string][] = [[31536000, 'year'], [604800, 'week'], [86400, 'day'], [3600, 'hour'], [60, 'minute']]
  for (const [n, u] of units) if (s % n === 0) { const k = s / n; return k === 1 ? u : `${k} ${u}s` }
  return `${s} s`
}
