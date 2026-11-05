// Table layout for tasks: every field as a column, sortable by clicking a header, columns can be
// shown or hidden (remembered on this device).
import { useMemo, useState } from 'react'
import { Icon } from '../../components/Icon'
import { Menu, MenuItem } from '../../components/ui'
import { Ring, TaskCheck, dueTone, fmtMinutes } from '../../components/TaskRow'
import { dueLabel, shortStamp } from '../../lib/dates'
import type { Label, Task } from '../../lib/types'

type Col = { key: string; label: string; get: (t: Task) => string | number; render?: (t: Task) => React.ReactNode }
const COLS_KEY = 'app.tasks.tableCols'

export function TaskTable({ tasks, labels, pathOf, onOpen, onToggle, selected }: {
  tasks: Task[]; labels?: Label[]; pathOf: Map<string, string>; onOpen: (t: Task) => void; onToggle: (t: Task) => void; selected: string | null
}) {
  const labelName = useMemo(() => new Map((labels ?? []).map((l) => [l.id, l])), [labels])
  const cols: Col[] = [
    { key: 'project', label: 'Project', get: (t) => (t.project_id ? pathOf.get(t.project_id) ?? '' : '') },
    { key: 'due', label: 'Due', get: (t) => t.due ?? '9999', render: (t) => (t.due ? <span className={'meta-due ' + dueTone(t.due, t.done)}>{dueLabel(t.due)}</span> : '') },
    { key: 'start', label: 'Start', get: (t) => t.start ?? '9999', render: (t) => (t.start ? dueLabel(t.start) : '') },
    { key: 'priority', label: 'Priority', get: (t) => -t.priority, render: (t) => <span className={t.priority >= 20 ? 'danger-text' : t.priority >= 15 ? 'warn-text' : ''}>{t.priority_label}</span> },
    { key: 'labels', label: 'Labels', get: (t) => t.labels.map((id) => labelName.get(id)?.name ?? '').join(','), render: (t) => <span className="tt-chips">{t.labels.map((id) => labelName.get(id)).filter(Boolean).map((l) => <span key={l!.id} className="chip">{l!.name}</span>)}</span> },
    { key: 'assignees', label: 'Assignees', get: (t) => t.assignees.map((a) => a.name || a.username).join(', ') },
    { key: 'progress', label: 'Progress', get: (t) => t.percent, render: (t) => (t.percent ? <span className="row" style={{ gap: '0.25rem' }}><Ring value={t.percent} />{t.percent}%</span> : '') },
    { key: 'time', label: 'Time spent', get: (t) => t.time_spent, render: (t) => (t.time_spent ? fmtMinutes(t.time_spent) : '') },
    { key: 'repeat', label: 'Repeat', get: (t) => t.repeat_mode, render: (t) => (t.repeat_mode ? <Icon name="repeat" size={13} title="Repeats" /> : '') },
    { key: 'reminders', label: 'Reminders', get: (t) => t.reminders.length, render: (t) => (t.reminders.length ? <span className="row" style={{ gap: '0.25rem' }}><Icon name="bell" size={12} />{t.reminders.length}</span> : '') },
    { key: 'subtasks', label: 'Subtasks', get: (t) => t.subtasks ?? 0, render: (t) => (t.subtasks ? `${t.subtasks_done ?? 0}/${t.subtasks}` : '') },
    { key: 'comments', label: 'Comments', get: (t) => t.comments ?? 0, render: (t) => t.comments || '' },
    { key: 'completed', label: 'Completed', get: (t) => t.done_at ?? '', render: (t) => (t.done_at ? shortStamp(t.done_at) : '') },
    { key: 'created', label: 'Created', get: (t) => t.created_on, render: (t) => <span title={`by ${t.owner.name || t.owner.username}`}>{shortStamp(t.created_on)}</span> },
    { key: 'updated', label: 'Updated', get: (t) => t.updated_on, render: (t) => shortStamp(t.updated_on) },
  ]
  const [shown, setShown] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(COLS_KEY) || 'null') ?? ['project', 'due', 'priority', 'labels', 'progress', 'subtasks', 'updated']
    } catch {
      return ['project', 'due', 'priority', 'labels', 'progress', 'subtasks', 'updated']
    }
  })
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null)
  const toggleCol = (k: string) => {
    const next = shown.includes(k) ? shown.filter((x) => x !== k) : [...shown, k]
    setShown(next)
    try { localStorage.setItem(COLS_KEY, JSON.stringify(next)) } catch { /* ignore */ }
  }
  const visible = cols.filter((c) => shown.includes(c.key))
  const rows = useMemo(() => {
    if (!sort) return tasks
    const col = sort.key === 'title' ? { get: (t: Task) => t.title.toLowerCase() } : cols.find((c) => c.key === sort.key)
    if (!col) return tasks
    return [...tasks].sort((a, b) => {
      const x = col.get(a)
      const y = col.get(b)
      return (x < y ? -1 : x > y ? 1 : 0) * sort.dir
    })
  }, [tasks, sort])
  const head = (key: string, label: string) => (
    <th key={key} scope="col">
      <button className="tt-sort" onClick={() => setSort((s) => (s?.key === key ? (s.dir === 1 ? { key, dir: -1 } : null) : { key, dir: 1 }))} aria-sort={sort?.key === key ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
        {label}{sort?.key === key && <Icon name={sort.dir === 1 ? 'arrowUp' : 'arrowDown'} size={11} />}
      </button>
    </th>
  )
  return (
    <div className="tt-wrap">
      <div className="tt-tools">
        <span className="muted xsmall">{tasks.length} tasks · click a header to sort</span>
        <span className="spacer" />
        <Menu align="end" label="Columns" trigger={(p) => <button {...p} className="btn sm"><Icon name="layers" size={13} />Columns</button>}>
          {() => cols.map((c) => <MenuItem key={c.key} active={shown.includes(c.key)} end={shown.includes(c.key) ? '✓' : undefined} onClick={() => toggleCol(c.key)}>{c.label}</MenuItem>)}
        </Menu>
      </div>
      <div className="tt-scroll">
        <table className="tt">
          <thead><tr><th scope="col" className="tt-check" aria-label="Done" />{head('title', 'Title')}{visible.map((c) => head(c.key, c.label))}</tr></thead>
          <tbody>
            {rows.map((t) => (
              <tr key={t.id} className={(t.done ? 'done ' : '') + (t.id === selected ? 'sel' : '')} onClick={() => onOpen(t)}>
                <td className="tt-check" onClick={(e) => e.stopPropagation()}><TaskCheck task={t} onToggle={() => onToggle(t)} /></td>
                <td className="tt-title"><button onClick={(e) => (e.stopPropagation(), onOpen(t))}>{t.title}</button></td>
                {visible.map((c) => <td key={c.key}>{c.render ? c.render(t) : String(c.get(t) || '')}</td>)}
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={visible.length + 2} className="empty">No tasks here.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}
