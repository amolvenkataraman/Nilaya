// Edit one habit's day: amount (or done), "skip this day" and a note. Opened from the grid
// (right-click / long-press a cell, or click a measurable one), a Today row's menu and the
// detail page's notes. Saves through PUT /habits/entries/{id}/{day}.
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Dialog } from '../../components/ui'
import { fmtDate } from '../../lib/dates'
import { useSetEntry, type Habit } from './api'
import { fmtNum, parseDay } from './util'

export interface DayTarget { habit: Habit; day: string; value: number; skipped: boolean; note: string; focus?: 'note' }

export function DayDialog({ target, onClose }: { target: DayTarget | null; onClose: () => void }) {
  return (
    <Dialog open={!!target} onClose={onClose} title={target ? `${target.habit.name} · ${fmtDate(parseDay(target.day), { weekday: 'short', month: 'short', day: 'numeric' })}` : ''} width="24rem">
      {target && <DayForm key={target.habit.id + target.day} t={target} onDone={onClose} />}
    </Dialog>
  )
}

function DayForm({ t, onDone }: { t: DayTarget; onDone: () => void }) {
  const setEntry = useSetEntry()
  const h = t.habit
  const measurable = h.kind === 'measurable'
  const [amount, setAmount] = useState(t.value && !t.skipped ? fmtNum(t.value) : '')
  const [done, setDone] = useState(t.value >= 1 && !t.skipped)
  const [skipped, setSkipped] = useState(t.skipped)
  const [note, setNote] = useState(t.note)
  const [error, setError] = useState('')
  const save = (value: number, skip: boolean, text: string) => {
    setEntry.mutate({ habit: h, day: t.day, value: skip ? 0 : value, skipped: skip, note: text.trim() })
    onDone()
  }
  const submit = () => {
    const n = amount.trim() === '' ? 0 : Number(amount)
    if (measurable && !(n >= 0)) return setError('Enter an amount of 0 or more.')
    save(measurable ? n : done ? 1 : 0, skipped, note)
  }
  return (
    <form className="h-form" onSubmit={(e) => (e.preventDefault(), submit())}>
      {measurable ? (
        <label className="field">
          <span>Amount{h.unit ? ` (${h.unit})` : ''}</span>
          <input className="input" type="number" inputMode="decimal" min={0} step="any" value={amount} disabled={skipped}
            onChange={(e) => setAmount(e.target.value)} autoFocus={t.focus !== 'note'} />
        </label>
      ) : (
        <label className="h-check-row"><input type="checkbox" checked={done} disabled={skipped} onChange={(e) => setDone(e.target.checked)} autoFocus={t.focus !== 'note'} />Done</label>
      )}
      <label className="h-check-row"><input type="checkbox" checked={skipped} onChange={(e) => setSkipped(e.target.checked)} />Skip this day (keeps the streak)</label>
      <label className="field">
        <span>Note</span>
        <textarea className="textarea" rows={3} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder="How did it go?" autoFocus={t.focus === 'note'} />
      </label>
      {error && <span className="error-text" role="alert">{error}</span>}
      <div className="row" style={{ gap: '0.5rem' }}>
        {(t.value > 0 || t.skipped || t.note) && <button type="button" className="btn ghost" onClick={() => save(0, false, '')}>Clear day</button>}
        <span className="spacer" />
        <button type="button" className="btn" onClick={onDone}>Cancel</button>
        <button type="submit" className="btn primary">Save</button>
      </div>
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
        timer.current = window.setTimeout(() => ((fired.current = true), open()), ms)
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
