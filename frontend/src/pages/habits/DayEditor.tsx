// Edit one habit's day: amount (or done), "skip this day" and a note. Opened from the grid
// (right-click / long-press a cell, or click a measurable one), a Today row's menu and the
// detail page's notes. Saves through PUT /habits/entries/{id}/{day}.
import { useEffect, useId, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Button, Dialog, Field, Input, Textarea } from '../../components/ui'
import { fmtDate, parseDayKey } from '../../lib/dates'
import { useSetEntry, type Habit } from './api'
import { fmtNum } from './habitRules'

export interface DayTarget {
  habit: Habit
  day: string
  value: number
  skipped: boolean
  note: string
  focus?: 'note'
}

export function DayDialog({ target, onClose }: { target: DayTarget | null; onClose: () => void }) {
  const setEntry = useSetEntry()
  const formId = useId()
  const clear = () => {
    if (target) setEntry.mutate({ habit: target.habit, day: target.day, value: 0, skipped: false, note: '' })
    onClose()
  }
  return (
    <Dialog
      open={!!target}
      onClose={onClose}
      title={
        target ? `${target.habit.name} · ${fmtDate(parseDayKey(target.day), { weekday: 'short', month: 'short', day: 'numeric' })}` : ''
      }
      width="24rem"
      footer={
        <>
          {target && (target.value > 0 || target.skipped || target.note) && (
            <Button variant="ghost" onClick={clear}>
              Clear day
            </Button>
          )}
          <span className="flex-1" />
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" form={formId}>
            Save
          </Button>
        </>
      }
    >
      {target && <DayForm key={target.habit.id + target.day} id={formId} t={target} onDone={onClose} />}
    </Dialog>
  )
}

const checkRow = 'flex items-center gap-2 text-sm [&_input]:size-4'

function DayForm({ id, t, onDone }: { id: string; t: DayTarget; onDone: () => void }) {
  const setEntry = useSetEntry()
  const h = t.habit
  const measurable = h.kind === 'measurable'
  const [amount, setAmount] = useState(t.value && !t.skipped ? fmtNum(t.value) : '')
  const [done, setDone] = useState(t.value >= 1 && !t.skipped)
  const [skipped, setSkipped] = useState(t.skipped)
  const [note, setNote] = useState(t.note)
  const [error, setError] = useState('')
  const submit = () => {
    const n = amount.trim() === '' ? 0 : Number(amount)
    if (measurable && !(n >= 0)) return setError('Enter an amount of 0 or more.')
    const value = measurable ? n : done ? 1 : 0
    setEntry.mutate({ habit: h, day: t.day, value: skipped ? 0 : value, skipped, note: note.trim() })
    onDone()
  }
  return (
    <form
      id={id}
      className="grid gap-3.5"
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
    >
      {measurable ? (
        <Field label={`Amount${h.unit ? ` (${h.unit})` : ''}`}>
          <Input
            type="number"
            inputMode="decimal"
            min={0}
            step="any"
            value={amount}
            disabled={skipped}
            onChange={(e) => setAmount(e.target.value)}
            autoFocus={t.focus !== 'note'}
          />
        </Field>
      ) : (
        <label className={checkRow}>
          <input
            type="checkbox"
            checked={done}
            disabled={skipped}
            onChange={(e) => setDone(e.target.checked)}
            autoFocus={t.focus !== 'note'}
          />
          Done
        </label>
      )}
      <label className={checkRow}>
        <input type="checkbox" checked={skipped} onChange={(e) => setSkipped(e.target.checked)} />
        Skip this day (keeps the streak)
      </label>
      <Field label="Note" error={error || undefined}>
        <Textarea
          rows={3}
          maxLength={500}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="How did it go?"
          autoFocus={t.focus === 'note'}
        />
      </Field>
    </form>
  )
}

/** Right-click or long-press (touch) handlers; `wasLong()` lets the click that follows a long press be ignored. */
export function useLongPress(open: () => void, ms = 500) {
  const timer = useRef<number | undefined>(undefined)
  const fired = useRef(false)
  const start = useRef<[number, number]>([0, 0])
  useEffect(() => () => window.clearTimeout(timer.current), [])
  const cancel = () => window.clearTimeout(timer.current)
  return {
    wasLong: () => {
      const f = fired.current
      fired.current = false
      return f
    },
    handlers: {
      onContextMenu: (e: { preventDefault: () => void }) => {
        e.preventDefault()
        if (fired.current) return // a long press already opened it (Android also fires contextmenu)
        open()
      },
      onPointerDown: (e: ReactPointerEvent) => {
        fired.current = false
        if (e.pointerType !== 'touch') return
        start.current = [e.clientX, e.clientY]
        cancel()
        timer.current = window.setTimeout(() => {
          fired.current = true
          open()
        }, ms)
      },
      onPointerMove: (e: ReactPointerEvent) => {
        if (Math.abs(e.clientX - start.current[0]) + Math.abs(e.clientY - start.current[1]) > 10) cancel()
      },
      onPointerUp: cancel,
      onPointerCancel: cancel,
      onPointerLeave: cancel,
    },
  }
}
