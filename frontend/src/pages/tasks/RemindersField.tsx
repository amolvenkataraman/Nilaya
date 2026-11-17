// The drawer's Reminders field: each reminder as a chip (when it fires, sent, or "needs a date"), and a
// popover to add one relative to the due or start date, or at a date and time.
import { useState } from 'react'
import { Icon } from '../../components/Icon'
import { Button, Chip, chipClass, MenuItem, MenuLabel, MenuSeparator, Popover } from '../../components/ui'
import { cn } from '../../lib/cn'
import { fmtStamp, shortStamp } from '../../lib/dates'
import type { TaskDetail } from '../../lib/types'
import { fmtWhen, popForm, popInput, popRow, popSelect, type Save } from './propField'
import { durText, type ReminderIn, reminderIn, reminderText } from './recurrence'

const REL_PRESETS: [number, string][] = [
  [0, 'At due time'],
  [-900, '15 minutes before'],
  [-3600, '1 hour before'],
  [-86400, '1 day before'],
  [-604800, '1 week before'],
]
const OFFSET_UNITS: [string, number][] = [
  ['minutes', 60],
  ['hours', 3600],
  ['days', 86400],
  ['weeks', 604800],
]

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
    <div className="flex flex-wrap items-center gap-1">
      {rems.map((r, i) => (
        <Chip
          key={r.id ?? i}
          className={cn('pr-0.5', r.sent && 'opacity-70')}
          title={r.fire_at ? `Fires ${fmtStamp(r.fire_at)}` : 'Needs a date on the task'}
        >
          <Icon name="bell" size={11} />
          {reminderText(r) ?? (r.at ? fmtWhen(r.at) : '')}
          {r.sent ? (
            <span className="text-muted"> · sent</span>
          ) : r.relative_to && r.fire_at ? (
            <span className="text-muted"> · {shortStamp(r.fire_at)}</span>
          ) : !r.fire_at ? (
            <span className="text-muted"> · needs a date</span>
          ) : null}
          <button
            type="button"
            className="inline-flex rounded-full border-0 bg-transparent p-0.5 text-muted hover:bg-hover hover:text-fg"
            aria-label="Remove reminder"
            onClick={() => put(keep.filter((_, j) => j !== i))}
          >
            <Icon name="x" size={10} />
          </button>
        </Chip>
      ))}
      <Popover
        label="Add reminder"
        width="18rem"
        trigger={(p) => (
          <button
            {...p}
            type="button"
            className={chipClass({ interactive: true })}
            onClick={(e) => {
              setAt('')
              setRel(task.due ? 'due' : 'start')
              p.onClick?.(e)
            }}
          >
            <Icon name="plus" size={11} />
            Add reminder
          </button>
        )}
      >
        {(close) => {
          const add = (r: ReminderIn) => {
            close()
            put([...keep, r])
          }
          return (
            <>
              <MenuLabel>{task.due ? 'Relative to the due date' : 'Set a due date for relative reminders'}</MenuLabel>
              {task.due &&
                REL_PRESETS.map(([off, l]) => (
                  <MenuItem key={off} icon="bell" onClick={() => add({ at: null, relative_to: 'due', offset: off })}>
                    {l}
                  </MenuItem>
                ))}
              {task.start && (
                <MenuItem icon="play" onClick={() => add({ at: null, relative_to: 'start', offset: 0 })}>
                  At start time
                </MenuItem>
              )}
              {(task.due || task.start) && (
                <form
                  className={popForm}
                  onSubmit={(e) => {
                    e.preventDefault()
                    add({ at: null, relative_to: rel, offset: dir * Math.max(0, n || 0) * unit })
                  }}
                >
                  <div className={popRow}>
                    <input
                      type="number"
                      className={cn(popInput, 'w-16!')}
                      min={0}
                      max={999}
                      value={n}
                      onChange={(e) => setN(Number(e.target.value))}
                      aria-label="Offset"
                    />
                    <select className={popSelect} value={unit} onChange={(e) => setUnit(Number(e.target.value))} aria-label="Offset unit">
                      {OFFSET_UNITS.map(([l, s]) => (
                        <option key={s} value={s}>
                          {l}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className={popRow}>
                    <select className={popSelect} value={dir} onChange={(e) => setDir(Number(e.target.value))} aria-label="Before or after">
                      <option value={-1}>before</option>
                      <option value={1}>after</option>
                    </select>
                    <select
                      className={popSelect}
                      value={rel}
                      onChange={(e) => setRel(e.target.value as 'due' | 'start')}
                      aria-label="Relative to"
                    >
                      {task.due && <option value="due">due</option>}
                      {task.start && <option value="start">start</option>}
                    </select>
                    <Button type="submit" size="sm" variant="primary">
                      Add
                    </Button>
                  </div>
                  <span className="text-xs text-muted">
                    {n ? `${durText(n * unit)} ${dir < 0 ? 'before' : 'after'} ${rel}` : `At ${rel} time`}
                  </span>
                </form>
              )}
              <MenuSeparator />
              <form
                className={popForm}
                onSubmit={(e) => {
                  e.preventDefault()
                  const d = new Date(at)
                  if (!at || Number.isNaN(d.getTime())) return
                  add({ at: d.toISOString(), relative_to: '', offset: 0 })
                }}
              >
                <MenuLabel className="p-0">At a date and time</MenuLabel>
                <div className={popRow}>
                  <input
                    type="datetime-local"
                    className={cn(popInput, 'flex-1')}
                    value={at}
                    onChange={(e) => setAt(e.target.value)}
                    aria-label="Reminder date and time"
                  />
                  <Button type="submit" size="sm" variant="primary" disabled={!at}>
                    Add
                  </Button>
                </div>
              </form>
            </>
          )
        }}
      </Popover>
    </div>
  )
}
