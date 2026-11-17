// The drawer's Repeat field: presets (daily … yearly) or a custom interval, counted from the due date or
// from completion.
import { useState } from 'react'
import { Icon } from '../../components/Icon'
import { toast } from '../../components/toast'
import { Button, MenuItem, MenuLabel, MenuSeparator, Popover } from '../../components/ui'
import { cn } from '../../lib/cn'
import type { TaskDetail } from '../../lib/types'
import { popForm, popInput, popRow, popSelect, propBtn, type Save } from './propField'
import { REPEAT_PRESETS, REPEAT_UNITS, repeatParts, repeatText } from './recurrence'

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
    <Popover
      label="Repeat"
      width="17rem"
      trigger={(p) => (
        <button
          {...p}
          type="button"
          className={cn(propBtn, task.repeat_mode ? 'text-fg' : 'text-muted')}
          onClick={(e) => {
            const [c, u] = repeatParts(task.repeat_every)
            setN(c)
            setUnit(u)
            setAfter(task.repeat_mode === 3)
            p.onClick?.(e)
          }}
        >
          {task.repeat_mode ? (
            <>
              <Icon name="repeat" size={12} />
              {text}
            </>
          ) : (
            'Does not repeat'
          )}
        </button>
      )}
    >
      {(close) => (
        <>
          {REPEAT_PRESETS.map((p) => {
            const on = p.mode ? text === p.label : !task.repeat_mode
            return (
              <MenuItem
                key={p.label}
                icon={p.mode ? 'repeat' : 'x'}
                active={on}
                end={on ? '✓' : undefined}
                onClick={() => {
                  close()
                  set(p.mode, p.every)
                }}
              >
                {p.label}
              </MenuItem>
            )
          })}
          <MenuSeparator />
          <form
            className={popForm}
            onSubmit={(e) => {
              e.preventDefault()
              close()
              set(after ? 3 : 1, Math.max(1, n || 1) * unit)
            }}
          >
            <MenuLabel className="p-0">Custom</MenuLabel>
            <div className={popRow}>
              <span className="text-sm">Every</span>
              <input
                type="number"
                className={cn(popInput, 'w-18!')}
                min={1}
                max={999}
                value={n}
                onChange={(e) => setN(Number(e.target.value))}
                aria-label="Every how many"
              />
              <select className={popSelect} value={unit} onChange={(e) => setUnit(Number(e.target.value))} aria-label="Unit">
                {REPEAT_UNITS.map(([name, s]) => (
                  <option key={s} value={s}>
                    {name}
                  </option>
                ))}
              </select>
            </div>
            <label className={cn(popRow, 'text-sm')}>
              <input type="checkbox" className="accent-accent" checked={after} onChange={(e) => setAfter(e.target.checked)} />
              Count from when I complete it
            </label>
            <div className={popRow}>
              <span className="flex-auto" />
              <Button type="submit" size="sm" variant="primary">
                Set
              </Button>
            </div>
          </form>
        </>
      )}
    </Popover>
  )
}
