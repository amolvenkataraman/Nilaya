// Floating bar for the selected tasks: complete, due date, priority, label, move, delete.
// Every action is one optimistic cache pass plus pooled requests (api.ts useBulkOps).
import { useState } from 'react'
import { Icon } from '../../components/Icon'
import { Menu, MenuItem } from '../../components/ui'
import { addDays, parseDayKey, startOfDay } from '../../lib/dates'
import { PRIORITIES, type Label, type Project, type Task } from '../../lib/types'
import { plural, useBulkOps, useDeleteWithUndo } from './api'

const PRIO_CLASS: Record<number, string> = { 0: 'muted', 5: '', 10: 'accent-text', 15: 'warn-text', 20: 'danger-text' }

export function BulkBar({ tasks, projects, labels, onClear }: {
  tasks: Task[]; projects?: Project[]; labels?: Label[]; onClear: () => void
}) {
  const ops = useBulkOps()
  const deleteLater = useDeleteWithUndo()
  const [day, setDay] = useState('')
  if (!tasks.length) return null
  const ids = tasks.map((t) => t.id)
  const today = startOfDay(new Date())
  const due = (d: Date | null) => ops.setDue(tasks, d)
  const targets = (projects ?? []).filter((p) => p.role >= 1 && !p.archived).sort((a, b) => Number(b.is_inbox) - Number(a.is_inbox))
  const allDone = tasks.every((t) => t.done)

  return (
    <div className="bulk-bar" role="toolbar" aria-label={`${plural(tasks.length)} selected`}>
      <span className="bulk-count">{tasks.length} selected</span>
      <span className="bulk-sep" />
      <button className="btn ghost sm" onClick={() => (ops.setDone(ids, !allDone), onClear())} title={allDone ? 'Mark as not done' : 'Complete'}>
        <Icon name="check" size={14} /><span className="bulk-label">{allDone ? 'Reopen' : 'Complete'}</span>
      </button>
      <Menu label="Set due date" trigger={(p) => <button {...p} className="btn ghost sm" title="Due date"><Icon name="calendar" size={14} /><span className="bulk-label">Due</span></button>}>
        {(close) => (
          <>
            <form className="bulk-date" onSubmit={(e) => { e.preventDefault(); if (day) { due(parseDayKey(day)); close() } }}>
              <input type="date" className="input" value={day} onChange={(e) => setDay(e.target.value)} aria-label="Due date" />
              <button className="btn sm primary" disabled={!day}>Set</button>
            </form>
            <MenuItem icon="sun" onClick={() => (close(), due(today))}>Today</MenuItem>
            <MenuItem icon="arrowRight" onClick={() => (close(), due(addDays(today, 1)))}>Tomorrow</MenuItem>
            <MenuItem icon="calendar" onClick={() => (close(), due(addDays(today, 7)))}>Next week</MenuItem>
            <div className="menu-sep" />
            <MenuItem icon="x" onClick={() => (close(), due(null))}>Clear due date</MenuItem>
          </>
        )}
      </Menu>
      <Menu label="Set priority" trigger={(p) => <button {...p} className="btn ghost sm" title="Priority"><Icon name="flag" size={14} /><span className="bulk-label">Priority</span></button>}>
        {(close) => [{ value: 0, label: 'None' }, ...PRIORITIES].reverse().map((p) => (
          <MenuItem key={p.value} end={tasks.every((t) => t.priority === p.value) ? '✓' : undefined} onClick={() => (close(), ops.setPriority(ids, p.value))}>
            <span className={'row bulk-prio ' + PRIO_CLASS[p.value]}><Icon name="flag" size={13} />{p.label}</span>
          </MenuItem>
        ))}
      </Menu>
      <Menu label="Labels" trigger={(p) => <button {...p} className="btn ghost sm" title="Label"><Icon name="tag" size={14} /><span className="bulk-label">Label</span></button>}>
        {() => (labels?.length ? labels.map((l) => {
          const all = tasks.every((t) => t.labels.includes(l.id))
          const some = !all && tasks.some((t) => t.labels.includes(l.id))
          return (
            <MenuItem key={l.id} end={all ? '✓' : some ? '–' : undefined} onClick={() => ops.toggleLabel(tasks, l.id)}>
              <span className="row bulk-prio"><span className="dot" style={{ background: l.colour || 'var(--app-muted)' }} />{l.name}</span>
            </MenuItem>
          )
        }) : <div className="menu-label">No labels yet. Add one from the sidebar.</div>)}
      </Menu>
      <Menu label="Move to project" width="15rem" trigger={(p) => <button {...p} className="btn ghost sm" title="Move to project"><Icon name="folder" size={14} /><span className="bulk-label">Move</span></button>}>
        {(close) => (
          <>
            <div className="menu-label">Move to</div>
            {targets.map((p) => (
              <MenuItem key={p.id} onClick={() => (close(), ops.move(ids, p), onClear())} end={tasks.every((t) => t.project_id === p.id) ? '✓' : undefined}>
                <span className="row bulk-prio">{p.is_inbox ? <Icon name="inbox" size={13} /> : <span className="dot" style={{ background: p.colour || 'var(--app-muted)' }} />}<span className="truncate">{p.is_inbox ? 'Inbox' : p.name}</span></span>
              </MenuItem>
            ))}
          </>
        )}
      </Menu>
      <button className="btn ghost sm bulk-danger" onClick={() => (deleteLater(tasks), onClear())} title="Delete (undo for 6 s)">
        <Icon name="trash" size={14} /><span className="bulk-label">Delete</span>
      </button>
      <span className="bulk-sep" />
      <button className="btn ghost icon sm" onClick={onClear} aria-label="Clear selection" title="Clear selection (Esc)"><Icon name="x" size={14} /></button>
    </div>
  )
}
