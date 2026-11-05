// Today's habits: the shared row (one-tap check, +/- for measurable habits) and a self-contained
// dashboard card, HabitsTodayCard.
import { useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { Icon } from '../../components/Icon'
import { ErrorBox, Menu, MenuItem, SkeletonRows } from '../../components/ui'
import { toast } from '../../components/toast'
import { useArchiveHabit, useCheck, usePauseHabit, useSetEntry, useToday, type Habit, type TodayRow } from './api'
import { DayDialog, type DayTarget } from './DayEditor'
import { HabitBadge, HIcon, fmtNum, goalText, hc, streakText } from './util'
import './habits.css'

/** One tap of +/− (and the +/− keys): 1, or a tenth of a big target (e.g. 800 of 8000 steps). */
export const stepOf = (h: Habit) => (h.target >= 100 ? Math.round(h.target / 10) : 1)

/** Skip or unskip today, with the classic page's confirmation toast. */
export function useSkipToday() {
  const setEntry = useSetEntry()
  return (row: TodayRow, today: string) => setEntry.mutate(
    { habit: row.habit, day: today, value: row.skipped ? null : 0, skipped: !row.skipped },
    { onSuccess: () => toast.show(row.skipped ? `${row.habit.name} is back on for today.` : `Skipped ${row.habit.name} today. Your streak is safe.`) },
  )
}

export function HabitCheck({ row, size = 'md', onAmount }: { row: TodayRow; size?: 'md' | 'sm'; onAmount?: () => void }) {
  const check = useCheck()
  const h = row.habit
  if (h.kind === 'yesno') {
    const on = row.value >= 1
    return (
      <button
        type="button"
        className={'h-check ' + size + (on ? ' on' : '')}
        style={hc(h)}
        aria-pressed={on}
        aria-label={on ? `Undo "${h.name}" for today` : `Mark "${h.name}" done for today`}
        onClick={() => check.mutate({ habit: h, current: row.value })}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>
      </button>
    )
  }
  const step = stepOf(h)
  return (
    <div className={'h-stepper ' + size} style={hc(h)}>
      <button type="button" className="h-step" aria-label={`Less ${h.name}`} disabled={row.value <= 0} onClick={() => check.mutate({ habit: h, amount: -step, current: row.value })}>
        <HIcon name="minus" size={0.75} />
      </button>
      {onAmount ? (
        <button type="button" className={'h-amount tabular' + (row.over ? ' over' : row.done ? ' met' : '')} aria-live="polite" onClick={onAmount}
          title="Type an amount" aria-label={`${h.name} today: ${fmtNum(row.value)} of ${fmtNum(row.period_required)}. Type an amount`}>
          {fmtNum(row.value)}<span className="muted">/{fmtNum(row.period_required)}</span>
        </button>
      ) : (
        <span className={'h-amount tabular' + (row.over ? ' over' : row.done ? ' met' : '')} aria-live="polite">
          {fmtNum(row.value)}<span className="muted">/{fmtNum(row.period_required)}</span>
        </span>
      )}
      <button type="button" className="h-step plus" aria-label={`More ${h.name}`} onClick={() => check.mutate({ habit: h, amount: step, current: row.value })}>
        <Icon name="plus" size={12} />
      </button>
    </div>
  )
}

export function progressText(row: TodayRow): string {
  const h = row.habit
  if (h.period === 'day' && h.kind === 'yesno') return ''
  const per = h.period === 'day' ? 'today' : `this ${h.period}`
  return `${fmtNum(row.period_value)}/${fmtNum(row.period_required)}${h.unit && h.kind === 'measurable' ? ' ' + h.unit : ''} ${per}`
}

export function HabitRow({ row, compact, onEdit, onMove, onDrag, today }: {
  row: TodayRow; compact?: boolean; onEdit?: () => void; onMove?: (dir: -1 | 1) => void
  onDrag?: (e: ReactPointerEvent<HTMLElement>) => void; today?: string
}) {
  const h = row.habit
  const skip = useSkipToday()
  const pause = usePauseHabit()
  const navigate = useNavigate()
  const [day, setDay] = useState<DayTarget | null>(null)
  const archive = useArchiveHabit()
  const editDay = (focus?: 'note') => today && setDay({ habit: h, day: today, value: row.value, skipped: row.skipped, note: row.note, focus })
  const pct = row.period_required > 0 ? Math.min(1, row.period_value / row.period_required) : 0
  const prog = progressText(row)
  return (
    <div className={'h-row' + (row.done && h.goal === 'at_least' ? ' done' : '') + (!row.due ? ' off' : '') + (compact ? ' compact' : '')} style={hc(h)}
      data-hid={compact ? undefined : h.id} tabIndex={compact ? undefined : -1} aria-label={compact ? undefined : h.name}>
      {onDrag && (
        <span className="h-grip" onPointerDown={onDrag} title="Drag to reorder (or Alt + ↑/↓)" aria-hidden="true"><Icon name="grip" size={14} /></span>
      )}
      <HabitBadge habit={h} size={compact ? 1.75 : 2.25} />
      <div className="h-main">
        <Link className="h-name truncate" to={`/habits/${h.id}`}>{h.name}</Link>
        <div className="h-sub">
          {!compact && <span>{goalText(h)}</span>}
          {prog && <span className="tabular">{prog}</span>}
          {row.skipped && <span className="chip">Skipped</span>}
          {row.over && <span className="chip danger">Over limit</span>}
          {h.paused && <span className="chip">Paused</span>}
          {row.streak > 0 && (
            <span className="h-streak" title={`Current streak: ${streakText(row.streak, row.streak_unit)}`}>
              <HIcon name="flame" size={0.75} />{row.streak}{compact ? '' : ' ' + row.streak_unit + (row.streak === 1 ? '' : 's')}
            </span>
          )}
        </div>
        {row.note && !compact && <span className="h-note truncate" title={row.note}><Icon name="comment" size={12} />{row.note}</span>}
        {!compact && (h.kind === 'measurable' || h.period !== 'day') && (
          <span className={'h-bar' + (row.over ? ' over' : '')} aria-hidden="true"><span style={{ width: `${pct * 100}%` }} /></span>
        )}
      </div>
      <HabitCheck row={row} size={compact ? 'sm' : 'md'} onAmount={!compact && today ? () => editDay() : undefined} />
      {!compact && today && (
        <Menu align="end" label={`${h.name} actions`} trigger={(p) => (
          <button {...p} className="btn ghost icon sm h-more" aria-label={`Actions for "${h.name}"`}><Icon name="more" size={14} /></button>
        )}>
          {(close) => (
            <>
              <MenuItem icon="chart" onClick={() => (close(), navigate(`/habits/${h.id}`))}>Stats and history</MenuItem>
              <MenuItem icon="clock" onClick={() => (close(), skip(row, today))} end={<span className="kbd">S</span>}>
                {row.skipped ? 'Unskip today' : 'Skip today'}
              </MenuItem>
              {h.kind === 'measurable' && <MenuItem icon="edit" onClick={() => (close(), editDay())}>Type today's amount…</MenuItem>}
              <MenuItem icon="comment" onClick={() => (close(), editDay('note'))}>
                {row.note ? "Edit today's note" : 'Add a note'}
              </MenuItem>
              {onEdit && <MenuItem icon="edit" onClick={() => (close(), onEdit())} end={<span className="kbd">E</span>}>Edit habit</MenuItem>}
              {onMove && (
                <>
                  <div className="menu-sep" />
                  <MenuItem icon="arrowUp" onClick={() => (close(), onMove(-1))}>Move up</MenuItem>
                  <MenuItem icon="arrowDown" onClick={() => (close(), onMove(1))}>Move down</MenuItem>
                </>
              )}
              <div className="menu-sep" />
              <MenuItem icon={h.paused ? 'play' : 'clock'} onClick={() => (close(), pause.mutate({ id: h.id, paused: !h.paused }))}>{h.paused ? 'Resume' : 'Pause'}</MenuItem>
              <MenuItem icon="album" onClick={() => (close(), archive.mutate({ id: h.id, archived: true }))}>Archive</MenuItem>
            </>
          )}
        </Menu>
      )}
      <DayDialog target={day} onClose={() => setDay(null)} />
    </div>
  )
}

/** Dashboard card: today's due habits with one-tap check-ins. */
export function HabitsTodayCard({ className = '' }: { className?: string }) {
  const today = useToday()
  const rows = (today.data?.habits ?? []).filter((r) => r.due && !r.habit.paused)
  return (
    <section className={'card ' + className} aria-labelledby="habits-card-h">
      <div className="card-head">
        <h2 id="habits-card-h"><Icon name="repeat" />Habits</h2>
        {today.data && today.data.total > 0 && <span className="count tabular">{today.data.done}/{today.data.total}</span>}
        <span className="spacer" />
        <Link className="btn ghost sm" to="/habits">Habits<Icon name="chevronRight" size={14} /></Link>
      </div>
      <div className="h-card-list">
        {today.isPending ? (
          <SkeletonRows rows={3} avatar />
        ) : today.error && !today.data ? (
          <ErrorBox error={today.error} retry={() => today.refetch()} />
        ) : rows.length === 0 ? (
          <div className="empty">{today.data?.habits.length ? 'Nothing scheduled today.' : <>No habits yet. <Link to="/habits?new=1">Start one</Link></>}</div>
        ) : (
          rows.map((r) => <HabitRow key={r.habit.id} row={r} compact />)
        )}
      </div>
    </section>
  )
}
