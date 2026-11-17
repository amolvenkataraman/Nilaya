// Table layout for tasks: every field as a column, sortable by clicking a header, columns can be
// shown or hidden (remembered on this device). Rows can be multi-selected (checkbox, Shift, Ctrl/Cmd).
// Only rows near the viewport are rendered. Headers with a server sort (title, due, priority, created,
// updated) sort the whole list; the others sort the loaded rows.
import { useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import { Icon } from '../../components/Icon'
import { dueTone, fmtMinutes, Ring, TaskCheck } from '../../components/TaskRow'
import { Button, Menu, MenuItem } from '../../components/ui'
import { cn } from '../../lib/cn'
import { dueLabel, shortStamp } from '../../lib/dates'
import type { Sort } from '../../lib/qs'
import { usePref } from '../../lib/storage'
import type { Label, Task } from '../../lib/types'
import { labelChip, labelStyle } from './Labels'
import { prioTone } from './priority'
import type { Selection } from './selection'
import { useWindowed } from './virtual'

type Col = { key: string; label: string; get: (t: Task) => string | number; render?: (t: Task) => ReactNode }
const COLS_KEY = 'app.tasks.tableCols'
const DEFAULT_COLS = ['project', 'due', 'priority', 'labels', 'progress', 'subtasks', 'updated']
/** Columns the server can sort by (its direction: due and title ascending, the rest newest/highest first). */
const SERVER_SORT: Record<string, [Sort, 1 | -1]> = {
  title: ['title', 1],
  due: ['due', 1],
  priority: ['priority', -1],
  created: ['created', -1],
  updated: ['updated', -1],
}
const TONE = { overdue: 'text-danger', today: 'text-accent font-medium', soon: 'text-warning', '': '' }
const td = 'border-b border-border px-3 py-1.5 text-xs whitespace-nowrap text-muted'
const selBox = 'sel-box m-0 size-3.5 cursor-pointer align-middle accent-accent'
const withIcon = 'flex items-center gap-1'

export function TaskTable({
  tasks,
  total,
  more,
  labels,
  pathOf,
  onOpen,
  onToggle,
  selected,
  sel,
  sort: serverSort,
  onSort,
}: {
  tasks: Task[]
  total?: number
  more?: boolean
  labels?: Label[]
  pathOf: Map<string, string>
  onOpen: (t: Task) => void
  onToggle: (t: Task) => void
  selected: string | null
  sel?: Selection
  /** The list's (server) sort, and a setter (null = the list's default). */
  sort?: Sort
  onSort?: (s: Sort | null) => void
}) {
  const cols = useMemo((): Col[] => {
    const labelById = new Map((labels ?? []).map((l) => [l.id, l]))
    return [
      { key: 'project', label: 'Project', get: (t) => (t.project_id ? (pathOf.get(t.project_id) ?? '') : '') },
      {
        key: 'due',
        label: 'Due',
        get: (t) => t.due ?? '9999',
        render: (t) => (t.due ? <span className={TONE[dueTone(t.due, t.done)]}>{dueLabel(t.due)}</span> : ''),
      },
      { key: 'start', label: 'Start', get: (t) => t.start ?? '9999', render: (t) => (t.start ? dueLabel(t.start) : '') },
      {
        key: 'priority',
        label: 'Priority',
        get: (t) => -t.priority,
        render: (t) => <span className={t.priority >= 15 ? prioTone(t.priority) : ''}>{t.priority ? t.priority_label : 'None'}</span>,
      },
      {
        key: 'labels',
        label: 'Labels',
        get: (t) => t.labels.map((id) => labelById.get(id)?.name ?? '').join(','),
        render: (t) => (
          <span className="inline-flex gap-1">
            {t.labels.flatMap((id) => {
              const l = labelById.get(id)
              return l ? (
                <span key={l.id} className={labelChip} style={labelStyle(l.colour)}>
                  {l.name}
                </span>
              ) : (
                []
              )
            })}
          </span>
        ),
      },
      { key: 'assignees', label: 'Assignees', get: (t) => t.assignees.map((a) => a.name || a.username).join(', ') },
      {
        key: 'progress',
        label: 'Progress',
        get: (t) => t.percent,
        render: (t) =>
          t.percent ? (
            <span className={withIcon}>
              <Ring value={t.percent} />
              {t.percent}%
            </span>
          ) : (
            ''
          ),
      },
      { key: 'time', label: 'Time spent', get: (t) => t.time_spent, render: (t) => (t.time_spent ? fmtMinutes(t.time_spent) : '') },
      {
        key: 'repeat',
        label: 'Repeat',
        get: (t) => t.repeat_mode,
        render: (t) => (t.repeat_mode ? <Icon name="repeat" size={13} title="Repeats" /> : ''),
      },
      {
        key: 'reminders',
        label: 'Reminders',
        get: (t) => t.reminders.length,
        render: (t) =>
          t.reminders.length ? (
            <span className={withIcon}>
              <Icon name="bell" size={12} />
              {t.reminders.length}
            </span>
          ) : (
            ''
          ),
      },
      {
        key: 'subtasks',
        label: 'Subtasks',
        get: (t) => t.subtasks ?? 0,
        render: (t) => (t.subtasks ? `${t.subtasks_done ?? 0}/${t.subtasks}` : ''),
      },
      { key: 'comments', label: 'Comments', get: (t) => t.comments ?? 0, render: (t) => t.comments || '' },
      { key: 'completed', label: 'Completed', get: (t) => t.done_at ?? '', render: (t) => (t.done_at ? shortStamp(t.done_at) : '') },
      {
        key: 'created',
        label: 'Created',
        get: (t) => t.created_on,
        render: (t) => <span title={`by ${t.owner.name || t.owner.username}`}>{shortStamp(t.created_on)}</span>,
      },
      { key: 'updated', label: 'Updated', get: (t) => t.updated_on, render: (t) => shortStamp(t.updated_on) },
    ]
  }, [labels, pathOf])
  const [shown, setShown] = usePref<string[]>(COLS_KEY, DEFAULT_COLS)
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null)
  const toggleCol = (k: string) => setShown(shown.includes(k) ? shown.filter((x) => x !== k) : [...shown, k])
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
  }, [tasks, sort, cols])
  const order = rows.map((t) => t.id)
  const picked = sel ? rows.filter((t) => sel.has(t.id)).length : 0
  const allBox = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (allBox.current) allBox.current.indeterminate = picked > 0 && picked < rows.length
  }, [picked, rows.length])
  /** Modifier clicks select instead of opening; a plain click on a row clears the selection. */
  const rowClick = (e: MouseEvent, t: Task) => {
    if (sel?.click(e, t.id, order)) return e.preventDefault()
    sel?.clear()
    onOpen(t)
  }
  const head = (key: string, label: string) => {
    const server = onSort ? SERVER_SORT[key] : undefined
    const dir = sort?.key === key ? sort.dir : !sort && server && serverSort === server[0] ? server[1] : null
    const click = () => {
      if (server && onSort) {
        setSort(null)
        onSort(serverSort === server[0] && !sort ? null : server[0])
        return
      }
      setSort((s) => (s?.key === key ? (s.dir === 1 ? { key, dir: -1 } : null) : { key, dir: 1 }))
    }
    return (
      <th
        key={key}
        scope="col"
        aria-sort={dir ? (dir === 1 ? 'ascending' : 'descending') : 'none'}
        className="[position:sticky] top-0 z-1 border-b border-border bg-surface p-0 text-left whitespace-nowrap"
      >
        <button
          type="button"
          className="inline-flex items-center gap-1 border-0 bg-transparent px-3 py-2 text-xs font-semibold text-muted hover:text-fg"
          onClick={click}
          title={server ? 'Sort the whole list' : more ? 'Sort the loaded rows' : undefined}
        >
          {label}
          {dir && <Icon name={dir === 1 ? 'arrowUp' : 'arrowDown'} size={11} />}
        </button>
      </th>
    )
  }
  const body = useRef<HTMLTableSectionElement>(null)
  const w = useWindowed(order, body, 37)
  const span = visible.length + (sel ? 3 : 2)
  const spacer = (height: number) => (
    <tr style={{ height }}>
      <td colSpan={span} className="border-0 p-0" />
    </tr>
  )
  const th = '[position:sticky] top-0 z-1 border-b border-border bg-surface text-left whitespace-nowrap'
  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <span className="text-xs text-muted">
          {total != null && total > tasks.length
            ? `${tasks.length.toLocaleString()} of ${total.toLocaleString()} tasks loaded`
            : `${tasks.length.toLocaleString()} tasks`}{' '}
          · click a header to sort{sort && more ? ' (loaded rows)' : ''}
        </span>
        <span className="flex-1" />
        <Menu
          align="end"
          label="Columns"
          trigger={(p) => (
            <Button {...p} size="sm">
              <Icon name="layers" size={13} />
              Columns
            </Button>
          )}
        >
          {() =>
            cols.map((c) => (
              <MenuItem
                key={c.key}
                active={shown.includes(c.key)}
                end={shown.includes(c.key) ? '✓' : undefined}
                onClick={() => toggleCol(c.key)}
              >
                {c.label}
              </MenuItem>
            ))
          }
        </Menu>
      </div>
      <div className="overflow-auto rounded-md border border-border bg-surface">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              {sel && (
                <th scope="col" className={cn(th, 'w-7 p-0 pl-3')}>
                  <input
                    ref={allBox}
                    type="checkbox"
                    className={selBox}
                    checked={rows.length > 0 && picked === rows.length}
                    onChange={() => (picked === rows.length ? sel.clear() : sel.set(order))}
                    aria-label="Select all"
                  />
                </th>
              )}
              <th scope="col" className={cn(th, 'w-8 p-0')} aria-label="Done" />
              {head('title', 'Title')}
              {visible.map((c) => head(c.key, c.label))}
            </tr>
          </thead>
          <tbody ref={body} className="[&>tr:last-child>td]:border-b-0">
            {w.padTop > 0 && spacer(w.padTop)}
            {rows.slice(w.start, w.end).map((t) => (
              <tr
                key={t.id}
                ref={w.measure(t.id)}
                data-task={t.id}
                className={cn('cursor-default hover:bg-hover', (t.id === selected || sel?.has(t.id)) && 'bg-accent-soft')}
                onClick={(e) => rowClick(e, t)}
              >
                {sel && (
                  // biome-ignore lint/a11y/useKeyWithClickEvents: only keeps the row's click from firing; the checkbox is the control
                  <td className={cn(td, 'w-7 p-0! pl-3!')} onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      className={selBox}
                      checked={sel.has(t.id)}
                      aria-label={`Select "${t.title}"`}
                      onChange={(e) => ((e.nativeEvent as globalThis.MouseEvent).shiftKey ? sel.range(order, t.id) : sel.toggle(t.id))}
                    />
                  </td>
                )}
                {/* biome-ignore lint/a11y/useKeyWithClickEvents: only keeps the row's click from firing; the check is the control */}
                <td className={cn(td, 'w-8 pr-0!')} onClick={(e) => e.stopPropagation()}>
                  <TaskCheck task={t} onToggle={() => onToggle(t)} />
                </td>
                <td className={cn(td, 'min-w-56 whitespace-normal!')}>
                  <button
                    type="button"
                    className={cn(
                      'cursor-pointer border-0 bg-transparent p-0 text-left text-sm',
                      t.done ? 'text-muted line-through' : 'text-fg',
                    )}
                    onClick={(e) => {
                      e.stopPropagation()
                      rowClick(e, t)
                    }}
                  >
                    {t.title}
                  </button>
                </td>
                {visible.map((c) => (
                  <td key={c.key} className={td}>
                    {c.render ? c.render(t) : String(c.get(t) || '')}
                  </td>
                ))}
              </tr>
            ))}
            {w.padBottom > 0 && spacer(w.padBottom)}
            {rows.length === 0 && (
              <tr>
                <td colSpan={span} className={cn(td, 'text-center')}>
                  No tasks here.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
