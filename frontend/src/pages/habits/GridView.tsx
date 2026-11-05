// Progress grid: habits x days for a week or a month. Click a cell to log or clear that day
// (backfill; measurable habits open the day editor); right-click or long-press for amount, skip and note.
import { useState } from 'react'
import { Link } from 'react-router'
import { Icon } from '../../components/Icon'
import { ErrorBox, SkeletonRows } from '../../components/ui'
import { addDays, dayKey, fmtDate, isSameDay } from '../../lib/dates'
import { useCheck, useEntries, useHabits, type Entry, type Habit } from './api'
import { DayDialog, useLongPress, type DayTarget } from './DayEditor'
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
  const [editing, setEditing] = useState<DayTarget | null>(null)

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
                  return <Cell key={k} habit={h} day={k} entry={e} scheduled={sched} future={k > todayKey} today={k === todayKey} onEdit={setEditing} />
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
        {habits.data?.some((h) => h.goal === 'at_most') && <span><i className="lg kept" /> limit kept</span>}
        <span><i className="lg skip" /> skipped</span>
        <span><i className="lg off" /> not scheduled</span>
        <span><i className="lg note" /> note</span>
        <span className="muted">Click a day to log it; right-click or long-press to skip or add a note.</span>
      </p>
      <DayDialog target={editing} onClose={() => setEditing(null)} />
    </div>
  )
}

function Cell({ habit: h, day, entry, scheduled, future, today, onEdit }: {
  habit: Habit; day: string; entry?: Entry; scheduled: boolean; future: boolean; today: boolean; onEdit: (t: DayTarget) => void
}) {
  const check = useCheck()
  const value = entry && !entry.skipped ? entry.value : 0
  const edit = () => onEdit({ habit: h, day, value: entry?.value ?? 0, skipped: !!entry?.skipped, note: entry?.note ?? '' })
  const press = useLongPress(edit)
  const before = day < h.start_date || (!!h.end_date && day > h.end_date)
  const met = !!entry && !entry.skipped && dayMet(h, value) && (h.goal === 'at_least' ? value > 0 : true)
  const over = h.goal === 'at_most' && value > h.target
  const part = !met && value > 0 && h.goal === 'at_least'
  const frac = part ? Math.min(0.85, Math.max(0.2, value / Math.max(h.target, 1))) : 0
  // A limit with nothing logged is kept (the classic grid's "kept" cell); the Done column counts it as met too.
  const kept = !met && !over && !entry?.skipped && scheduled && h.goal === 'at_most'
  const state = entry?.skipped ? 'skip' : over ? 'over' : met ? 'met' : part ? 'part' : kept ? 'kept' : scheduled ? 'empty' : 'off'
  const label = `${h.name}, ${fmtDate(parseDay(day), { weekday: 'long', month: 'short', day: 'numeric' })}: ${
    entry?.skipped ? 'skipped' : value ? fmtNum(value) + (h.unit ? ' ' + h.unit : '') + (over ? ', over the limit' : '') : kept ? 'kept (nothing logged)' : scheduled ? 'not done' : 'not scheduled'
  }${entry?.note ? ' · ' + entry.note : ''}`
  if (future || before) return <td className="h-cell-td"><span className="h-cell disabled" aria-hidden="true" /></td>

  const yesno = h.kind === 'yesno'
  return (
    <td className={'h-cell-td' + (today ? ' today' : '')}>
      <button
        type="button"
        className={'h-cell ' + state + (part && frac >= 0.55 ? ' hi' : '')}
        aria-pressed={yesno ? met : undefined}
        aria-label={label}
        title={label}
        style={part ? ({ ['--frac' as string]: frac } as React.CSSProperties) : undefined}
        {...press.handlers}
        onClick={() => {
          if (press.wasLong()) return
          if (yesno) check.mutate({ habit: h, date: day, done: !met, current: value })
          else edit()
        }}
      >
        {yesno
          ? met && <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>
          : value > 0 && <span className="h-cell-num">{value >= 1000 ? Math.round(value / 100) / 10 + 'k' : fmtNum(Math.round(value * 10) / 10)}</span>}
        {entry?.note && <span className="h-cell-note" aria-hidden="true" />}
      </button>
    </td>
  )
}
