// Progress grid: habits x days for a week or a month. Click a cell to log or clear that day
// (backfill); measurable habits get a small amount editor.
import { useState } from 'react'
import { Link } from 'react-router'
import { Icon } from '../../components/Icon'
import { ErrorBox, Menu, SkeletonRows } from '../../components/ui'
import { addDays, dayKey, fmtDate, isSameDay } from '../../lib/dates'
import { useCheck, useEntries, useHabits, useSetEntry, type Entry, type Habit } from './api'
import { HabitBadge, dayMet, fmtNum, hc, isScheduled, parseDay } from './util'

export function GridView({ range, end, onRange, onEnd }: { range: 'week' | 'month'; end: string; onRange: (r: 'week' | 'month') => void; onEnd: (d: string) => void }) {
  const todayKey = dayKey(new Date())
  const span = range === 'week' ? 7 : 30
  const endDate = parseDay(end > todayKey ? todayKey : end)
  const days = Array.from({ length: span }, (_, i) => addDays(endDate, i - span + 1))
  const start = dayKey(days[0])
  const habits = useHabits()
  const entries = useEntries(start, dayKey(endDate))
  const byKey = new Map((entries.data ?? []).map((e) => [`${e.habit_id}|${e.date}`, e]))
  const atToday = dayKey(endDate) >= todayKey

  return (
    <div className="h-grid-wrap">
      <div className="h-toolbar">
        <div className="seg" role="group" aria-label="Range">
          <button aria-pressed={range === 'week'} onClick={() => onRange('week')}>Week</button>
          <button aria-pressed={range === 'month'} onClick={() => onRange('month')}>30 days</button>
        </div>
        <div className="row" style={{ gap: '0.25rem' }}>
          <button className="btn icon sm" aria-label="Earlier" onClick={() => onEnd(dayKey(addDays(endDate, -span)))}><Icon name="chevronLeft" size={14} /></button>
          <button className="btn icon sm" aria-label="Later" disabled={atToday} onClick={() => onEnd(dayKey(addDays(endDate, span)))}><Icon name="chevronRight" size={14} /></button>
          {!atToday && <button className="btn sm" onClick={() => onEnd(todayKey)}>Today</button>}
        </div>
        <span className="muted small tabular">{fmtDate(days[0])} – {fmtDate(endDate, { month: 'short', day: 'numeric', year: 'numeric' })}</span>
      </div>

      {habits.isPending || entries.isPending ? (
        <SkeletonRows rows={5} avatar />
      ) : (habits.error && !habits.data) || (entries.error && !entries.data) ? (
        <ErrorBox error={habits.error ?? entries.error} />
      ) : !habits.data?.length ? (
        <div className="empty">No habits yet.</div>
      ) : (
        <div className="h-grid-scroll">
          <table className={'h-grid ' + range}>
            <thead>
              <tr>
                <th scope="col" className="h-grid-name">Habit</th>
                {days.map((d) => (
                  <th key={dayKey(d)} scope="col" className={'h-grid-day' + (isSameDay(d, new Date()) ? ' today' : '')}>
                    <span className="wd">{fmtDate(d, { weekday: 'narrow' })}</span>
                    <span className="dn tabular">{d.getDate()}</span>
                  </th>
                ))}
                <th scope="col" className="h-grid-sum">Done</th>
              </tr>
            </thead>
            <tbody>
              {habits.data.map((h) => {
                let met = 0
                let judged = 0
                const cells = days.map((d) => {
                  const k = dayKey(d)
                  const e = byKey.get(`${h.id}|${k}`)
                  const sched = isScheduled(h, k)
                  if (sched && k <= todayKey && !e?.skipped) {
                    judged++
                    if (e ? dayMet(h, e.value) : h.goal === 'at_most') met++
                  }
                  return <Cell key={k} habit={h} day={k} entry={e} scheduled={sched} future={k > todayKey} today={k === todayKey} />
                })
                return (
                  <tr key={h.id} style={hc(h)}>
                    <th scope="row" className="h-grid-name">
                      <Link to={`/habits/${h.id}`} className="row">
                        <HabitBadge habit={h} size={1.5} />
                        <span className="truncate">{h.name}</span>
                      </Link>
                    </th>
                    {cells}
                    <td className="h-grid-sum tabular">{judged ? `${met}/${judged}` : '–'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="help h-legend">
        <span><i className="lg met" /> done</span>
        <span><i className="lg part" /> partly</span>
        <span><i className="lg skip" /> skipped</span>
        <span><i className="lg off" /> not scheduled</span>
        <span className="muted">Click a day to log or clear it.</span>
      </p>
    </div>
  )
}

function Cell({ habit: h, day, entry, scheduled, future, today }: { habit: Habit; day: string; entry?: Entry; scheduled: boolean; future: boolean; today: boolean }) {
  const check = useCheck()
  const value = entry && !entry.skipped ? entry.value : 0
  const before = day < h.start_date || (!!h.end_date && day > h.end_date)
  const met = !!entry && !entry.skipped && dayMet(h, value) && (h.goal === 'at_least' ? value > 0 : true)
  const over = h.goal === 'at_most' && value > h.target
  const part = !met && value > 0 && h.goal === 'at_least'
  const frac = part ? Math.min(0.85, Math.max(0.2, value / Math.max(h.target, 1))) : 0
  const state = entry?.skipped ? 'skip' : over ? 'over' : met ? 'met' : part ? 'part' : scheduled ? 'empty' : 'off'
  const label = `${h.name}, ${fmtDate(parseDay(day), { weekday: 'long', month: 'short', day: 'numeric' })}: ${
    entry?.skipped ? 'skipped' : value ? fmtNum(value) + (h.unit ? ' ' + h.unit : '') : scheduled ? 'not done' : 'not scheduled'
  }`
  if (future || before) return <td className="h-cell-td"><span className="h-cell disabled" aria-hidden="true" /></td>

  if (h.kind === 'yesno') {
    return (
      <td className={'h-cell-td' + (today ? ' today' : '')}>
        <button
          type="button"
          className={'h-cell ' + state}
          aria-pressed={met}
          aria-label={label}
          title={label}
          onClick={() => check.mutate({ habit: h, date: day, done: !met, current: value })}
        >
          {met && <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>}
        </button>
      </td>
    )
  }
  return (
    <td className={'h-cell-td' + (today ? ' today' : '')}>
      <Menu
        label={label}
        width="15rem"
        trigger={(p) => (
          <button {...p} type="button" className={'h-cell ' + state} aria-label={label} title={label} style={part ? ({ ['--frac' as string]: frac } as React.CSSProperties) : undefined}>
            {value > 0 && <span className="h-cell-num">{value >= 1000 ? Math.round(value / 100) / 10 + 'k' : fmtNum(Math.round(value * 10) / 10)}</span>}
          </button>
        )}
      >
        {(close) => <AmountEditor habit={h} day={day} entry={entry} close={close} />}
      </Menu>
    </td>
  )
}

function AmountEditor({ habit: h, day, entry, close }: { habit: Habit; day: string; entry?: Entry; close: () => void }) {
  const setEntry = useSetEntry()
  const [v, setV] = useState(entry && !entry.skipped ? String(entry.value) : '')
  const save = () => {
    const n = v.trim() === '' ? null : Number(v)
    if (n !== null && !(n >= 0)) return
    setEntry.mutate({ habit: h, day, value: n })
    close()
  }
  return (
    <form className="h-amount-editor" onSubmit={(e) => (e.preventDefault(), save())}>
      <div className="menu-label">{fmtDate(parseDay(day), { weekday: 'long', month: 'short', day: 'numeric' })}</div>
      <div className="row" style={{ padding: '0 0.5rem' }}>
        <input className="input" type="number" inputMode="decimal" min={0} step="any" value={v} onChange={(e) => setV(e.target.value)} aria-label={`Amount${h.unit ? ' in ' + h.unit : ''}`} autoFocus />
        <span className="muted small">{h.unit}</span>
      </div>
      <div className="row" style={{ padding: '0.5rem', gap: '0.25rem' }}>
        <button type="button" className="btn sm ghost" onClick={() => (setEntry.mutate({ habit: h, day, value: entry?.skipped ? null : 0, skipped: !entry?.skipped }), close())}>
          {entry?.skipped ? 'Unskip' : 'Skip day'}
        </button>
        <span className="spacer" />
        {entry && <button type="button" className="btn sm ghost" onClick={() => (setEntry.mutate({ habit: h, day, value: null }), close())}>Clear</button>}
        <button type="submit" className="btn sm primary">Save</button>
      </div>
    </form>
  )
}
