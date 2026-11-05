// Task detail drawer: title, properties, description, subtasks, relations (add/remove) and comments.
// Edits save on blur/change with optimistic updates (lib/queries useUpdateTask / useMoveTask).
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { Icon } from '../../components/Icon'
import { Avatar, Confirm, Drawer, ErrorBox, Menu, MenuItem, SkeletonRows } from '../../components/ui'
import { TaskCheck, TaskRow } from '../../components/TaskRow'
import { QuickAddInput } from '../../components/QuickAdd'
import { toast } from '../../components/toast'
import {
  keys, useComments, useLabels, useMe, useMoveTask, useProjects, useSetDone, useTask, useTasks, useUpdateTask,
} from '../../lib/queries'
import { fmtStamp, relTime, shortStamp } from '../../lib/dates'
import { PRIORITIES, type Project, type TaskDetail } from '../../lib/types'
import { cachedTask } from '../../lib/taskLists'
import { useAddComment, useDeleteComment, useDeleteWithUndo, useDuplicateTask, useEditComment, useUnassignMe } from './api'
import './tasks.css'
import { PROJECT_COLOURS } from './ProjectDialog'
import { Relations } from './Relations'
import { AssigneesField, DateField, LabelsField, RemindersField, RepeatField, StatusField, TimeSpentField, type FullPatch } from './Fields'
import { canEditTask, isOverdue } from './util'

const PRIOS = [{ value: 0, label: 'None' }, ...PRIORITIES]

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

/** Root → leaf project path ("Work › Website"). */
function pathOf(projects: Project[] | undefined, id: string | null): Project[] {
  const out: Project[] = []
  for (let p = projects?.find((x) => x.id === id), n = 0; p && n < 20; p = projects?.find((x) => x.id === p!.parent_id), n++) out.unshift(p)
  return out
}

function Detail({ task, onClose, onOpen }: { task: TaskDetail; onClose: () => void; onOpen: (id: string) => void }) {
  const qc = useQueryClient()
  const projects = useProjects().data
  const labels = useLabels().data
  const me = useMe().data
  const update = useUpdateTask()
  const move = useMoveTask()
  const setDone = useSetDone()
  const removeLater = useDeleteWithUndo()
  const duplicate = useDuplicateTask()
  const [title, setTitle] = useState(task.title)
  const [desc, setDesc] = useState(task.description)
  const titleRef = useRef<HTMLTextAreaElement>(null)
  useEffect(() => setTitle(task.title), [task.title])
  useEffect(() => setDesc(task.description), [task.description])
  useEffect(() => autosize(titleRef.current), [title])

  const canEdit = canEditTask(task, me, projects)
  // Assignees may comment and take themselves off a task even when it's view-only for them.
  const assignedToMe = !!me && task.assignees.some((a) => (typeof a === 'string' ? a === me.username : a.id === me.id))
  const unassign = useUnassignMe(task.id)
  const path = pathOf(projects, task.project_id)
  // The parent's title from whatever list already has it (no extra request).
  const parent = task.parent_id ? cachedTask(qc, task.parent_id) : undefined
  const save = (body: FullPatch) => update.mutate({ id: task.id, body: body as Parameters<typeof update.mutate>[0]['body'] })
  const remove = () => { removeLater([task]); onClose() }

  return (
    <>
      <div className="drawer-head">
        <TaskCheck task={task} size="lg" onToggle={() => setDone.mutate({ task, done: !task.done })} />
        <nav className="drawer-crumb truncate" aria-label="Breadcrumb">
          {path.length ? path.map((p, i) => (
            <span key={p.id} className="crumb">
              {i > 0 && <Icon name="chevronRight" size={11} />}
              <Link to={`/tasks?project=${p.id}&task=${task.id}`} className="crumb-link"><span className="dot" style={{ background: p.colour || 'var(--app-muted)' }} />{p.is_inbox ? 'Inbox' : p.name}</Link>
            </span>
          )) : 'Task'}
          {task.parent_id && <span className="crumb"><Icon name="chevronRight" size={11} /><button className="linkish truncate" onClick={() => onOpen(task.parent_id!)}>{parent?.title ?? 'Parent task'}</button></span>}
        </nav>
        <span className="spacer" />
        <button className={'btn ghost icon sm' + (task.favorite ? ' fav-on' : '')} onClick={() => save({ favorite: !task.favorite })} aria-pressed={task.favorite} aria-label={task.favorite ? 'Remove from favourites' : 'Add to favourites'} title="Favourite (s)">
          <Icon name="star" />
        </button>
        <Menu align="end" label="Task actions" trigger={(p) => <button {...p} className="btn ghost icon sm" aria-label="Task actions"><Icon name="more" /></button>}>
          {(close) => (
            <>
              <MenuItem icon="link" onClick={() => { close(); navigator.clipboard?.writeText(`${location.origin}/app/tasks?view=all&task=${task.id}`).then(() => toast.show('Link copied')) }}>Copy link</MenuItem>
              {canEdit && <MenuItem icon="copy" onClick={() => (close(), duplicate.mutate(task.id, { onSuccess: (t) => (toast.show('Task duplicated'), onOpen(t.id)) }))}>Duplicate</MenuItem>}
              {canEdit && task.parent_id && <MenuItem icon="arrowUp" onClick={() => (close(), save({ parent_id: null }))}>Make top-level task</MenuItem>}
              {canEdit && <><div className="menu-sep" /><MenuItem icon="trash" danger end="Del" onClick={() => (close(), remove())}>Delete task</MenuItem></>}
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
          readOnly={!canEdit}
          aria-label="Title"
          onChange={(e) => setTitle(e.target.value.replace(/\n/g, ' '))}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.preventDefault(), (e.target as HTMLTextAreaElement).blur())
            if (e.key === 'Escape') { e.stopPropagation(); setTitle(task.title); requestAnimationFrame(() => titleRef.current?.blur()) }
          }}
          onBlur={() => { const t = title.replace(/\s+/g, ' ').trim(); if (t && t !== task.title) save({ title: t }); else setTitle(task.title) }}
        />

        <p className="detail-facts muted xsmall">
          {task.done && task.done_at ? <span><Icon name="check" size={11} /> Completed {shortStamp(task.done_at)}</span> : null}
          {!task.done && task.repeat_mode > 0 && task.done_at ? <span title={fmtStamp(task.done_at)}><Icon name="repeat" size={11} /> Last done {relTime(new Date(task.done_at))}</span> : null}
          {isOverdue(task) ? <span className="danger-text"><Icon name="alert" size={11} /> Overdue since {shortStamp(task.due!)}</span> : null}
          {task.event_id ? <Link to={`/calendar?event=${task.event_id}`}><Icon name="calendar" size={11} /> From a calendar event</Link> : null}
          {me && task.owner.id !== me.id ? <span><Icon name="user" size={11} /> Owned by {task.owner.name || task.owner.username}</span> : null}
          {!canEdit ? <span><Icon name="info" size={11} /> View only</span> : null}
          {!canEdit && assignedToMe ? (
            <button type="button" className="linkish" onClick={() => unassign.mutate(undefined, { onSuccess: () => toast.show('You are no longer assigned') })} disabled={unassign.isPending}>
              <Icon name="x" size={11} /> Unassign me
            </button>
          ) : null}
        </p>
        <fieldset className="props-wrap" disabled={!canEdit}>
        <dl className="props">
          <dt><Icon name="folder" size={14} />Project</dt>
          <dd>
            <select className="select ghost-select" value={task.project_id ?? ''} aria-label="Project" onChange={(e) => move.mutate({ id: task.id, project_id: e.target.value, bucket_id: null }, { onSuccess: () => toast.show(`Moved to ${projects?.find((p) => p.id === e.target.value)?.name ?? 'project'}`) })}>
              {projects?.filter((p) => (!p.archived && p.role >= 1) || p.id === task.project_id).map((p) => <option key={p.id} value={p.id}>{p.is_inbox ? 'Inbox' : p.name}</option>)}
            </select>
          </dd>

          <StatusField task={task} />

          <dt><Icon name="calendar" size={14} />Due</dt>
          <dd><DateField task={task} field="due" save={save} /></dd>

          <dt><Icon name="play" size={14} />Start</dt>
          <dd><DateField task={task} field="start" save={save} /></dd>

          <dt><Icon name="flag" size={14} />Priority</dt>
          <dd>
            <div className="seg prio-seg" role="radiogroup" aria-label="Priority">
              {PRIOS.map((p) => (
                <button key={p.value} role="radio" aria-checked={task.priority === p.value} aria-pressed={task.priority === p.value} className={'prio-' + p.value} onClick={() => save({ priority: p.value })}>{p.label}</button>
              ))}
            </div>
          </dd>

          <dt><Icon name="tag" size={14} />Labels</dt>
          <dd className="label-cell"><LabelsField task={task} labels={labels} save={save} /></dd>

          <dt><Icon name="users" size={14} />Assignees</dt>
          <dd className="label-cell"><AssigneesField task={task} save={save} /></dd>

          <dt><Icon name="repeat" size={14} />Repeat</dt>
          <dd><RepeatField task={task} save={save} /></dd>

          <dt><Icon name="bell" size={14} />Reminders</dt>
          <dd><RemindersField task={task} save={save} /></dd>

          <dt><Icon name="palette" size={14} />Colour</dt>
          <dd className="swatches">
            <button className="swatch none" role="radio" aria-checked={!task.colour} aria-label="No colour" onClick={() => save({ colour: '' })}>{!task.colour && <Icon name="check" size={11} />}</button>
            {PROJECT_COLOURS.map((c) => (
              <button key={c} className="swatch" role="radio" aria-checked={task.colour === c} aria-label={c} style={{ background: c }} onClick={() => save({ colour: c })}>{task.colour === c && <Icon name="check" size={11} />}</button>
            ))}
          </dd>

          <dt><Icon name="chart" size={14} />Progress</dt>
          <dd className="progress-cell">
            <input type="range" min={0} max={100} step={5} defaultValue={task.percent} key={task.percent} aria-label="Percent done"
              onInput={(e) => { const out = (e.target as HTMLInputElement).nextElementSibling; if (out) out.textContent = `${(e.target as HTMLInputElement).value}%` }}
              onPointerUp={(e) => save({ percent: Number((e.target as HTMLInputElement).value) })}
              onKeyUp={(e) => save({ percent: Number((e.target as HTMLInputElement).value) })} />
            <span className="tabular small">{task.percent}%</span>
          </dd>

          <dt><Icon name="clock" size={14} />Time spent</dt>
          <dd className="time-cell"><TimeSpentField task={task} save={save} /></dd>
        </dl>
        </fieldset>

        <label className="detail-section-label" htmlFor="task-desc">Description</label>
        <textarea
          id="task-desc"
          className="textarea detail-desc"
          value={desc}
          readOnly={!canEdit}
          placeholder={canEdit ? 'Add details…' : 'No description'}
          maxLength={10000}
          onChange={(e) => setDesc(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); (e.target as HTMLTextAreaElement).blur() } if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) (e.target as HTMLTextAreaElement).blur() }}
          onBlur={() => desc !== task.description && save({ description: desc })}
        />

        <Subtasks task={task} onOpen={onOpen} canEdit={canEdit} />

        <Relations task={task} onOpen={onOpen} canEdit={canEdit} />

        <Comments taskId={task.id} canComment={canEdit || assignedToMe} />

        <p className="detail-foot muted xsmall">
          Created {shortStamp(task.created_on)} by {task.owner.name || task.owner.username} · updated {shortStamp(task.updated_on)}
        </p>
      </div>
    </>
  )
}

function Subtasks({ task, onOpen, canEdit }: { task: TaskDetail; onOpen: (id: string) => void; canEdit: boolean }) {
  const params = { parent: task.id, sort: 'position', limit: 200 }
  const subs = useTasks(params, !!task.subtasks)
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
        {items.map((t) => <TaskRow key={t.id} task={t} showProject={false} onToggle={() => (canEdit ? setDone.mutate({ task: t, done: !t.done }) : toast.error('You can only view this task'))} onOpen={() => onOpen(t.id)} />)}
        {canEdit && <QuickAddInput compact parentId={task.id} projectId={task.project_id} listKey={keys.taskList(params)} placeholder="Add subtask — natural language works" />}
      </div>
    </div>
  )
}

function Comments({ taskId, canComment }: { taskId: string; canComment: boolean }) {
  const comments = useComments(taskId)
  const me = useMe().data
  const add = useAddComment(taskId)
  const edit = useEditComment(taskId)
  const remove = useDeleteComment(taskId)
  const [body, setBody] = useState('')
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const submit = () => {
    const b = body.trim()
    if (!b) return
    add.mutate(b, { onSuccess: () => setBody('') })
  }
  const saveEdit = () => {
    if (!editing) return
    const b = editing.body.trim()
    if (!b) return
    edit.mutate({ id: editing.id, body: b }, { onSuccess: () => setEditing(null) })
  }
  return (
    <div className="detail-block">
      <div className="detail-section-label">Comments {comments.data?.length ? <span className="muted">{comments.data.length}</span> : null}</div>
      <div className="comments">
        {comments.data?.map((c) => {
          const mine = !!me && c.author.id === me.id
          return (
            <div key={c.id} className="comment">
              <Avatar name={c.author.name || c.author.username} size={1.5} />
              <div className="comment-main">
                <div className="comment-head">
                  <strong>{c.author.name || c.author.username}</strong>
                  <span className="muted" title={fmtStamp(c.created_on)}>{shortStamp(c.created_on)}{c.edited_on ? ' · edited' : ''}</span>
                  {mine && editing?.id !== c.id && (
                    <span className="comment-tools">
                      <button className="btn ghost sm" onClick={() => setEditing({ id: c.id, body: c.body })}>Edit</button>
                      <button className="btn ghost sm danger-text" onClick={() => setDeleting(c.id)}>Delete</button>
                    </span>
                  )}
                </div>
                {editing?.id === c.id ? (
                  <div className="comment-form">
                    <textarea className="textarea" rows={3} autoFocus value={editing.body} maxLength={10000} aria-label="Edit comment"
                      onChange={(e) => setEditing({ id: c.id, body: e.target.value })}
                      onKeyDown={(e) => {
                        if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') (e.preventDefault(), saveEdit())
                        if (e.key === 'Escape') (e.stopPropagation(), setEditing(null))
                      }} />
                    <div className="row"><span className="grow" /><button className="btn sm" onClick={() => setEditing(null)}>Cancel</button><button className="btn primary sm" disabled={!editing.body.trim() || edit.isPending} onClick={saveEdit}>Save</button></div>
                  </div>
                ) : (
                  <div className="comment-body pre-wrap">{c.body}</div>
                )}
              </div>
            </div>
          )
        })}
        {!canComment && !comments.data?.length && <p className="muted xsmall">No comments.</p>}
        {canComment && <form className="comment-form" onSubmit={(e) => (e.preventDefault(), submit())}>
          <textarea
            className="textarea"
            rows={2}
            value={body}
            maxLength={10000}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Write a comment…"
            aria-label="New comment"
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') (e.preventDefault(), submit())
              if (e.key === 'Escape') (e.stopPropagation(), (e.target as HTMLTextAreaElement).blur())
            }}
          />
          {body.trim() && (
            <div className="row"><span className="muted xsmall grow">Ctrl+Enter to send</span><button className="btn primary sm" disabled={add.isPending}>Comment</button></div>
          )}
        </form>}
      </div>
      <Confirm open={!!deleting} title="Delete comment?" body="This can't be undone." onConfirm={() => deleting && remove.mutate(deleting)} onClose={() => setDeleting(null)} />
    </div>
  )
}

function autosize(el: HTMLTextAreaElement | null) {
  if (!el) return
  el.style.height = 'auto'
  el.style.height = el.scrollHeight + 'px'
}
