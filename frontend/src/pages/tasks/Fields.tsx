// Editable task properties for the detail drawer: due/start pickers, status (board column), assignees,
// labels (with create), repeat (presets + custom), reminders, time spent. Each saves through `save`
// (an optimistic PATCH) or the move mutation; nothing here fetches unless its menu is opened.
import { useState } from 'react'
import { Icon } from '../../components/Icon'
import { Avatar, Menu, MenuItem } from '../../components/ui'
import { toast } from '../../components/toast'
import { useBuckets, useMe, useMoveTask, useProjects } from '../../lib/queries'
import { fmtStamp, addDays, dayKey, fmtDate, fmtTime, isEndOfDay, shortStamp, startOfDay } from '../../lib/dates'
import type { Label, TaskDetail, TaskPatch, UserBrief } from '../../lib/types'
import { fmtMinutes } from '../../components/TaskRow'
import { useMembers, useSaveLabel, type ProjectWithOwner } from './api'
import { labelStyle } from './Labels'
import {
  REPEAT_PRESETS, REPEAT_UNITS, durText, isOverdue, parseMinutes, reminderIn, reminderText, repeatParts, repeatText, type ReminderIn,
} from './util'

export type FullPatch = TaskPatch & { reminders?: ReminderIn[] }
type Save = (body: FullPatch) => void

const pad = (n: number) => String(n).padStart(2, '0')
const fmtWhen = (iso: string) => {
  const d = new Date(iso)
  const day = fmtDate(d, { weekday: 'short', month: 'short', day: 'numeric', ...(d.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}) })
  return isEndOfDay(d) ? day : `${day}, ${fmtTime(d)}`
}

// ---------------------------------------------------------------- due / start
export function DateField({ task, field, save }: { task: TaskDetail; field: 'due' | 'start'; save: Save }) {
  const cur = task[field] ? new Date(task[field]!) : null
  const [day, setDay] = useState('')
  const [time, setTime] = useState('')
  const today = startOfDay(new Date())
  const sat = addDays(today, (6 - today.getDay() + 7) % 7 || 7)
  const nextMon = addDays(today, ((8 - today.getDay()) % 7) || 7)
  /** Keep the current time of day (or 23:59 = all day; 9:00 for a new start). */
  const onDay = (d: Date) => {
    const x = new Date(d)
    if (cur && !isEndOfDay(cur)) x.setHours(cur.getHours(), cur.getMinutes(), 0, 0)
    else if (field === 'start') x.setHours(9, 0, 0, 0)
    else x.setHours(23, 59, 0, 0)
    return x.toISOString()
  }
  const set = (iso: string | null) => {
    if (iso === task[field]) return
    const other = field === 'start' ? task.due : task.start
    if (iso && other && (field === 'start' ? new Date(iso) > new Date(other) : new Date(iso) < new Date(other))) {
      return toast.error('The start must be before the due date.')
    }
    save({ [field]: iso })
  }
  const quick: [string, Date, string][] = [
    ['Today', today, 'sun'], ['Tomorrow', addDays(today, 1), 'arrowRight'], ['This weekend', sat, 'calendar'],
    ['Next week', nextMon, 'chevronRight'], ['In 2 weeks', addDays(today, 14), 'calendar'],
  ]
  const overdue = field === 'due' && isOverdue(task)
  return (
    <Menu label={field === 'due' ? 'Due date' : 'Start date'} width="17rem" trigger={(p) => (
      <button {...p} className={'prop-btn' + (cur ? '' : ' empty') + (overdue ? ' danger-text' : '')}
        onClick={() => { setDay(cur ? dayKey(cur) : ''); setTime(cur && !isEndOfDay(cur) ? `${pad(cur.getHours())}:${pad(cur.getMinutes())}` : ''); p.onClick() }}>
        {cur ? fmtWhen(task[field]!) : field === 'due' ? 'No due date' : 'No start date'}
      </button>
    )}>
      {(close) => (
        <>
          {quick.map(([l, d, ic]) => (
            <MenuItem key={l} icon={ic} end={fmtDate(d, { weekday: 'short', month: 'short', day: 'numeric' })} onClick={() => (close(), set(onDay(d)))}>{l}</MenuItem>
          ))}
          {cur && <MenuItem icon="x" danger onClick={() => (close(), set(null))}>{field === 'due' ? 'No due date' : 'No start date'}</MenuItem>}
          <div className="menu-sep" />
          <form className="date-pop" onSubmit={(e) => {
            e.preventDefault()
            if (!day) return
            const [y, m, dd] = day.split('-').map(Number)
            const x = new Date(y, m - 1, dd, 23, 59)
            if (time) { const [hh, mm] = time.split(':').map(Number); x.setHours(hh, mm) }
            close()
            set(x.toISOString())
          }}>
            <div className="row">
              <input type="date" className="input" value={day} onChange={(e) => setDay(e.target.value)} aria-label="Date" />
              <input type="time" className="input" value={time} onChange={(e) => setTime(e.target.value)} aria-label="Time" />
            </div>
            <div className="row"><span className="muted xsmall grow">No time = all day</span><button className="btn sm primary" disabled={!day}>Set</button></div>
          </form>
        </>
      )}
    </Menu>
  )
}

// ---------------------------------------------------------------- status (board column)
export function StatusField({ task }: { task: TaskDetail }) {
  const buckets = useBuckets(task.project_id)
  const move = useMoveTask()
  const list = [...(buckets.data ?? [])].sort((a, b) => a.position - b.position)
  if (!list.length) return null
  const cur = list.find((b) => b.id === task.bucket_id) ?? list.find((b) => !b.is_done)
  return (
    <>
      <dt><Icon name="board" size={14} />Status</dt>
      <dd>
        <select className="select ghost-select" aria-label="Status" value={cur?.id ?? ''} onChange={(e) => move.mutate({ id: task.id, bucket_id: Number(e.target.value) })}>
          {list.map((b) => <option key={b.id} value={b.id}>{b.name}{b.is_done ? ' (done)' : ''}</option>)}
        </select>
      </dd>
    </>
  )
}

// ---------------------------------------------------------------- assignees
/** The optimistic PATCH (lib/queries) briefly stores assignees as usernames: accept both shapes. */
const asUsers = (list: (UserBrief | string)[]): UserBrief[] => list.map((a) => (typeof a === 'string' ? { id: a, username: a, name: a } : a))

export function AssigneesField({ task: raw, save }: { task: TaskDetail; save: Save }) {
  const task = { ...raw, assignees: asUsers(raw.assignees) }
  return (
    <Menu label="Assignees" width="16rem" trigger={(p) => (
      <button {...p} className={'prop-btn' + (task.assignees.length ? '' : ' empty')}>
        {task.assignees.length ? task.assignees.map((a) => <span key={a.username} className="chip"><Avatar name={a.name || a.username} size={0.875} />{a.name || a.username}</span>) : 'Unassigned'}
      </button>
    )}>
      {() => <AssigneeList task={task} save={save} />}
    </Menu>
  )
}

function AssigneeList({ task: raw, save }: { task: TaskDetail; save: Save }) {
  const task = { ...raw, assignees: asUsers(raw.assignees) }
  const me = useMe().data
  const project = useProjects().data?.find((p) => p.id === task.project_id) as ProjectWithOwner | undefined
  const members = useMembers(task.project_id && !project?.is_inbox ? task.project_id : null)
  // Who the server accepts (tasks.service.assignable_user_ids): the project's owner and members, just
  // the creator for a loose task; people already assigned can stay.
  const people = new Map<string, UserBrief>()
  if (me && (task.project_id ? (project?.role ?? 0) >= 1 : task.owner.id === me.id))
    people.set(me.username, { id: me.id, username: me.username, name: [me.first_name, me.last_name].filter(Boolean).join(' ') || me.username })
  if (project?.owner) people.set(project.owner.username, project.owner)
  if (!task.project_id) people.set(task.owner.username, task.owner)
  for (const a of task.assignees) people.set(a.username, a)
  for (const m of members.data ?? []) people.set(m.user.username, m.user)
  const names = task.assignees.map((a) => a.username)
  return (
    <>
      <div className="menu-label">Assign to</div>
      {[...people.values()].map((u) => {
        const on = names.includes(u.username)
        return (
          <MenuItem key={u.username} active={on} end={on ? '✓' : undefined} onClick={() => save({ assignees: on ? names.filter((n) => n !== u.username) : [...names, u.username] })}>
            <span className="row bulk-prio"><Avatar name={u.name || u.username} size={1.125} />{u.name || u.username}{u.username === me?.username ? <span className="muted"> (you)</span> : null}</span>
          </MenuItem>
        )
      })}
      {members.isFetching && <div className="menu-label">Loading people…</div>}
      {people.size < 2 && !members.isFetching && <div className="menu-label">Share the project to assign others.</div>}
    </>
  )
}

// ---------------------------------------------------------------- labels
export function LabelsField({ task, labels, save }: { task: TaskDetail; labels?: Label[]; save: Save }) {
  const create = useSaveLabel()
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const add = () => {
    const n = name.trim()
    if (!n) return setAdding(false)
    const hit = labels?.find((l) => l.name.toLowerCase() === n.toLowerCase())
    const apply = (id: number) => !task.labels.includes(id) && save({ labels: [...task.labels, id] })
    setName('')
    setAdding(false)
    if (hit) return apply(hit.id)
    create.mutate({ body: { name: n } }, { onSuccess: (l) => apply(l.id) })
  }
  return (
    <>
      {labels?.map((l) => {
        const on = task.labels.includes(l.id)
        return (
          <button key={l.id} className={'chip label-toggle' + (on ? ' on' : '')} style={labelStyle(l.colour)} aria-pressed={on} onClick={() => save({ labels: on ? task.labels.filter((x) => x !== l.id) : [...task.labels, l.id] })}>
            {on ? <Icon name="check" size={11} /> : <span className="dot" style={{ background: l.colour || 'var(--app-muted)' }} />}{l.name}
          </button>
        )
      })}
      {adding ? (
        <form onSubmit={(e) => (e.preventDefault(), add())} className="label-new">
          <input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} onBlur={add} maxLength={48} placeholder="New label" aria-label="New label name"
            onKeyDown={(e) => e.key === 'Escape' && (e.stopPropagation(), setName(''), setAdding(false))} />
        </form>
      ) : (
        <button className="chip" onClick={() => setAdding(true)}><Icon name="plus" size={11} />New label</button>
      )}
    </>
  )
}

// ---------------------------------------------------------------- repeat
export function RepeatField({ task, save }: { task: TaskDetail; save: Save }) {
  const [n, setN] = useState(1)
  const [unit, setUnit] = useState(86400)
  const [after, setAfter] = useState(false)
  const text = repeatText(task.repeat_mode, task.repeat_every)
  const set = (mode: number, every: number | null) => {
    if (mode && !task.due && !task.start) toast.show('Repeats count from the due date: set one so the task can move forward.')
    save({ repeat_mode: mode, repeat_every: every })
  }
  return (
    <Menu label="Repeat" width="17rem" trigger={(p) => (
      <button {...p} className={'prop-btn' + (task.repeat_mode ? '' : ' empty')}
        onClick={() => { const [c, u] = repeatParts(task.repeat_every); setN(c); setUnit(u); setAfter(task.repeat_mode === 3); p.onClick() }}>
        {task.repeat_mode ? <><Icon name="repeat" size={12} />{text}</> : 'Does not repeat'}
      </button>
    )}>
      {(close) => (
        <>
          {REPEAT_PRESETS.map((p) => {
            const on = p.mode ? text === p.label : !task.repeat_mode
            return <MenuItem key={p.label} icon={p.mode ? 'repeat' : 'x'} active={on} end={on ? '✓' : undefined} onClick={() => (close(), set(p.mode, p.every))}>{p.label}</MenuItem>
          })}
          <div className="menu-sep" />
          <form className="date-pop" onSubmit={(e) => { e.preventDefault(); close(); set(after ? 3 : 1, Math.max(1, n || 1) * unit) }}>
            <div className="menu-label" style={{ padding: 0 }}>Custom</div>
            <div className="row">
              <span className="small">Every</span>
              <input type="number" className="input" min={1} max={999} value={n} onChange={(e) => setN(Number(e.target.value))} aria-label="Every how many" style={{ width: '4.5rem' }} />
              <select className="select" value={unit} onChange={(e) => setUnit(Number(e.target.value))} aria-label="Unit">
                {REPEAT_UNITS.map(([name, s]) => <option key={s} value={s}>{name}</option>)}
              </select>
            </div>
            <label className="row small"><input type="checkbox" checked={after} onChange={(e) => setAfter(e.target.checked)} />Count from when I complete it</label>
            <div className="row"><span className="grow" /><button className="btn sm primary">Set</button></div>
          </form>
        </>
      )}
    </Menu>
  )
}

// ---------------------------------------------------------------- reminders
const REL_PRESETS: [number, string][] = [[0, 'At due time'], [-900, '15 minutes before'], [-3600, '1 hour before'], [-86400, '1 day before'], [-604800, '1 week before']]
const OFFSET_UNITS: [string, number][] = [['minutes', 60], ['hours', 3600], ['days', 86400], ['weeks', 604800]]

export function RemindersField({ task, save }: { task: TaskDetail; save: Save }) {
  const rems = task.reminders
  const [at, setAt] = useState('')
  const [n, setN] = useState(30)
  const [unit, setUnit] = useState(60)
  const [dir, setDir] = useState(-1)
  const [rel, setRel] = useState<'due' | 'start'>('due')
  const put = (list: ReminderIn[]) => save({ reminders: list })
  const keep = rems.map(reminderIn)
  return (
    <div className="rems">
      {rems.map((r, i) => (
        <span key={r.id ?? i} className={'chip rem' + (r.sent ? ' sent' : '')} title={r.fire_at ? `Fires ${fmtStamp(r.fire_at)}` : 'Needs a date on the task'}>
          <Icon name="bell" size={11} />
          {reminderText(r) ?? (r.at ? fmtWhen(r.at) : '')}
          {r.sent ? <span className="muted"> · sent</span> : r.relative_to && r.fire_at ? <span className="muted"> · {shortStamp(r.fire_at)}</span> : !r.fire_at ? <span className="muted"> · needs a date</span> : null}
          <button className="rem-x" aria-label="Remove reminder" onClick={() => put(keep.filter((_, j) => j !== i))}><Icon name="x" size={10} /></button>
        </span>
      ))}
      <Menu label="Add reminder" width="18rem" trigger={(p) => (
        <button {...p} className="chip" onClick={() => { setAt(''); setRel(task.due ? 'due' : 'start'); p.onClick() }}><Icon name="plus" size={11} />Add reminder</button>
      )}>
        {(close) => (
          <>
            <div className="menu-label">{task.due ? 'Relative to the due date' : 'Set a due date for relative reminders'}</div>
            {task.due && REL_PRESETS.map(([off, l]) => (
              <MenuItem key={off} icon="bell" onClick={() => (close(), put([...keep, { at: null, relative_to: 'due', offset: off }]))}>{l}</MenuItem>
            ))}
            {task.start && <MenuItem icon="play" onClick={() => (close(), put([...keep, { at: null, relative_to: 'start', offset: 0 }]))}>At start time</MenuItem>}
            {(task.due || task.start) && (
              <form className="date-pop" onSubmit={(e) => { e.preventDefault(); close(); put([...keep, { at: null, relative_to: rel, offset: dir * Math.max(0, n || 0) * unit }]) }}>
                <div className="row">
                  <input type="number" className="input" min={0} max={999} value={n} onChange={(e) => setN(Number(e.target.value))} aria-label="Offset" style={{ width: '4rem' }} />
                  <select className="select" value={unit} onChange={(e) => setUnit(Number(e.target.value))} aria-label="Offset unit">{OFFSET_UNITS.map(([l, s]) => <option key={s} value={s}>{l}</option>)}</select>
                </div>
                <div className="row">
                  <select className="select" value={dir} onChange={(e) => setDir(Number(e.target.value))} aria-label="Before or after"><option value={-1}>before</option><option value={1}>after</option></select>
                  <select className="select" value={rel} onChange={(e) => setRel(e.target.value as 'due' | 'start')} aria-label="Relative to">
                    {task.due && <option value="due">due</option>}{task.start && <option value="start">start</option>}
                  </select>
                  <button className="btn sm primary">Add</button>
                </div>
                <span className="muted xsmall">{n ? `${durText(n * unit)} ${dir < 0 ? 'before' : 'after'} ${rel}` : `At ${rel} time`}</span>
              </form>
            )}
            <div className="menu-sep" />
            <form className="date-pop" onSubmit={(e) => {
              e.preventDefault()
              const d = new Date(at)
              if (!at || isNaN(d.getTime())) return
              close()
              put([...keep, { at: d.toISOString(), relative_to: '', offset: 0 }])
            }}>
              <div className="menu-label" style={{ padding: 0 }}>At a date and time</div>
              <div className="row">
                <input type="datetime-local" className="input" value={at} onChange={(e) => setAt(e.target.value)} aria-label="Reminder date and time" />
                <button className="btn sm primary" disabled={!at}>Add</button>
              </div>
            </form>
          </>
        )}
      </Menu>
    </div>
  )
}

// ---------------------------------------------------------------- time spent
export function TimeSpentField({ task, save }: { task: TaskDetail; save: Save }) {
  const [v, setV] = useState(task.time_spent ? fmtMinutes(task.time_spent) : '')
  const [prev, setPrev] = useState(task.time_spent)
  if (prev !== task.time_spent) { setPrev(task.time_spent); setV(task.time_spent ? fmtMinutes(task.time_spent) : '') }
  const commit = () => {
    const m = parseMinutes(v)
    if (m == null) { toast.error('Use a time like 45m, 1h 30m or 1:30.'); setV(task.time_spent ? fmtMinutes(task.time_spent) : ''); return }
    if (m !== task.time_spent) save({ time_spent: Math.min(m, 32767) })
  }
  return (
    <>
      <input className="input ghost-input time-input" value={v} placeholder="e.g. 1h 30m" aria-label="Time spent" onChange={(e) => setV(e.target.value)} onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') { e.stopPropagation(); setV(task.time_spent ? fmtMinutes(task.time_spent) : ''); (e.target as HTMLInputElement).blur() } }} />
      {[15, 30, 60].map((m) => <button key={m} className="chip" onClick={() => save({ time_spent: task.time_spent + m })}>+{m < 60 ? `${m}m` : '1h'}</button>)}
    </>
  )
}
