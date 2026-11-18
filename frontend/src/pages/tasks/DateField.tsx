// The drawer's Due and Start fields: quick days (today, tomorrow, the weekend, next week, in 2 weeks),
// clear, or a date with an optional time. A start must come before the due date.
import { useState } from 'react'
import { toast } from '../../components/toast'
import { Button, MenuItem, MenuSeparator, Popover } from '../../components/ui'
import { cn } from '../../lib/cn'
import { addDays, dayKey, fmtDate, isEndOfDay, startOfDay } from '../../lib/dates'
import type { TaskDetail } from '../../lib/types'
import { fmtWhen, popForm, popInput, popRow, propBtn, type Save } from './propField'
import { isOverdue } from './task'
import type { IconName } from '../../components/Icon'

const pad = (n: number) => String(n).padStart(2, '0')

export function DateField({ task, field, save }: { task: TaskDetail; field: 'due' | 'start'; save: Save }) {
  const value = task[field]
  const cur = value ? new Date(value) : null
  const [day, setDay] = useState('')
  const [time, setTime] = useState('')
  const today = startOfDay(new Date())
  const sat = addDays(today, (6 - today.getDay() + 7) % 7 || 7)
  const nextMon = addDays(today, (8 - today.getDay()) % 7 || 7)
  const none = field === 'due' ? 'No due date' : 'No start date'
  /** Keep the current time of day (or 23:59 = all day; 9:00 for a new start). */
  const onDay = (d: Date) => {
    const x = new Date(d)
    if (cur && !isEndOfDay(cur)) x.setHours(cur.getHours(), cur.getMinutes(), 0, 0)
    else if (field === 'start') x.setHours(9, 0, 0, 0)
    else x.setHours(23, 59, 0, 0)
    return x.toISOString()
  }
  const set = (iso: string | null) => {
    if (iso === value) return
    const other = field === 'start' ? task.due : task.start
    if (iso && other && (field === 'start' ? new Date(iso) > new Date(other) : new Date(iso) < new Date(other))) {
      return toast.error('The start must be before the due date.')
    }
    save({ [field]: iso })
  }
  const quick: [string, Date, IconName][] = [
    ['Today', today, 'sun'],
    ['Tomorrow', addDays(today, 1), 'arrowRight'],
    ['This weekend', sat, 'calendar'],
    ['Next week', nextMon, 'chevronRight'],
    ['In 2 weeks', addDays(today, 14), 'calendar'],
  ]
  const overdue = field === 'due' && isOverdue(task)
  return (
    <Popover
      label={field === 'due' ? 'Due date' : 'Start date'}
      width="17rem"
      trigger={(p) => (
        <button
          {...p}
          type="button"
          className={cn(propBtn, overdue ? 'text-danger' : cur ? 'text-fg' : 'text-muted')}
          onClick={(e) => {
            setDay(cur ? dayKey(cur) : '')
            setTime(cur && !isEndOfDay(cur) ? `${pad(cur.getHours())}:${pad(cur.getMinutes())}` : '')
            p.onClick?.(e)
          }}
        >
          {value ? fmtWhen(value) : none}
        </button>
      )}
    >
      {(close) => (
        <>
          {quick.map(([l, d, ic]) => (
            <MenuItem
              key={l}
              icon={ic}
              end={fmtDate(d, { weekday: 'short', month: 'short', day: 'numeric' })}
              onClick={() => {
                close()
                set(onDay(d))
              }}
            >
              {l}
            </MenuItem>
          ))}
          {cur && (
            <MenuItem
              icon="x"
              danger
              onClick={() => {
                close()
                set(null)
              }}
            >
              {none}
            </MenuItem>
          )}
          <MenuSeparator />
          <form
            className={popForm}
            onSubmit={(e) => {
              e.preventDefault()
              if (!day) return
              const [y, m, dd] = day.split('-').map(Number)
              const x = new Date(y, m - 1, dd, 23, 59)
              if (time) {
                const [hh, mm] = time.split(':').map(Number)
                x.setHours(hh, mm)
              }
              close()
              set(x.toISOString())
            }}
          >
            <div className={popRow}>
              <input
                type="date"
                className={cn(popInput, 'flex-1')}
                value={day}
                onChange={(e) => setDay(e.target.value)}
                aria-label="Date"
              />
              <input type="time" className={popInput} value={time} onChange={(e) => setTime(e.target.value)} aria-label="Time" />
            </div>
            <div className={popRow}>
              <span className="min-w-0 flex-auto text-xs text-muted">No time = all day</span>
              <Button type="submit" size="sm" variant="primary" disabled={!day}>
                Set
              </Button>
            </div>
          </form>
        </>
      )}
    </Popover>
  )
}
