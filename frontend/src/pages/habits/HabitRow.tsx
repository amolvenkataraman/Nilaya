// One habit for today: badge, name, goal and progress, streak, today's note, and the check-in control (a round
// check for yes/no, a −/amount/+ stepper for measurable habits) with an actions menu. Used by Today and,
// compact, by the dashboard card.
import { useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { Icon } from '../../components/Icon'
import { toast } from '../../components/toast'
import { buttonClass, Menu, MenuItem, MenuSeparator } from '../../components/ui'
import { cn } from '../../lib/cn'
import { useArchiveHabit, useCheck, usePauseHabit, useSetEntry, type Habit, type TodayRow } from './api'
import { DayDialog, type DayTarget } from './DayEditor'
import { HabitBadge, HabitIcon, hc } from './HabitBadge'
import { fmtNum, goalText, streakText } from './habitRules'

/** One tap of +/− (and the +/− keys): 1, or a tenth of a big target (e.g. 800 of 8000 steps). */
export const stepOf = (h: Habit) => (h.target >= 100 ? Math.round(h.target / 10) : 1)

/** Skip or unskip today, with the classic page's confirmation toast. */
export function useSkipToday() {
  const setEntry = useSetEntry()
  return (row: TodayRow, today: string) =>
    setEntry.mutate(
      { habit: row.habit, day: today, value: row.skipped ? null : 0, skipped: !row.skipped },
      {
        onSuccess: () =>
          toast.show(row.skipped ? `${row.habit.name} is back on for today.` : `Skipped ${row.habit.name} today. Your streak is safe.`),
      },
    )
}

const chip = 'inline-flex h-5 items-center gap-1 whitespace-nowrap rounded-full border px-1.75 text-xs font-medium'
const chipPlain = cn(chip, 'border-border bg-surface-2 text-muted')

export function HabitCheck({ row, size = 'md', onAmount }: { row: TodayRow; size?: 'md' | 'sm'; onAmount?: () => void }) {
  const check = useCheck()
  const h = row.habit
  if (h.kind === 'yesno') {
    const on = row.value >= 1
    return (
      <button
        type="button"
        className={cn(
          'grid flex-none place-items-center rounded-full border-2 p-0 transition-[background-color,border-color,color,scale] active:scale-94',
          size === 'sm' ? 'size-7 [&_svg]:size-3.25' : 'size-9 [&_svg]:size-4',
          on
            ? 'border-(--hc) bg-(--hc) text-white'
            : 'border-[color-mix(in_srgb,var(--hc)_55%,var(--app-border))] bg-transparent text-transparent hover:bg-[color-mix(in_srgb,var(--hc)_12%,transparent)] hover:text-[color-mix(in_srgb,var(--hc)_60%,transparent)]',
        )}
        style={hc(h)}
        aria-pressed={on}
        aria-label={on ? `Undo "${h.name}" for today` : `Mark "${h.name}" done for today`}
        onClick={() => check.mutate({ habit: h, current: row.value })}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={3}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="m5 12.5 4.5 4.5L19 7.5" />
        </svg>
      </button>
    )
  }
  const step = stepOf(h)
  const stepButton = cn('grid place-items-center rounded-full border-0', size === 'sm' ? 'size-6' : 'size-7')
  const amount = cn(
    'min-w-12 text-center text-sm font-semibold tabular-nums',
    row.over ? 'text-danger' : row.done ? 'text-(--hc)' : 'text-fg',
  )
  const value = (
    <>
      {fmtNum(row.value)}
      <span className="font-normal text-muted">/{fmtNum(row.period_required)}</span>
    </>
  )
  return (
    <div className="inline-flex flex-none items-center gap-0.5 rounded-full border border-border bg-surface p-0.5" style={hc(h)}>
      <button
        type="button"
        className={cn(stepButton, 'bg-transparent text-muted hover:not-disabled:bg-hover hover:not-disabled:text-fg disabled:opacity-40')}
        aria-label={`Less ${h.name}`}
        disabled={row.value <= 0}
        onClick={() => check.mutate({ habit: h, amount: -step, current: row.value })}
      >
        <HabitIcon name="minus" size={0.75} />
      </button>
      {onAmount ? (
        <button
          type="button"
          className={cn(amount, 'rounded-sm border-0 bg-transparent px-1 py-0.5 hover:bg-hover')}
          aria-live="polite"
          onClick={onAmount}
          title="Type an amount"
          aria-label={`${h.name} today: ${fmtNum(row.value)} of ${fmtNum(row.period_required)}. Type an amount`}
        >
          {value}
        </button>
      ) : (
        <span className={amount} aria-live="polite">
          {value}
        </span>
      )}
      <button
        type="button"
        className={cn(
          stepButton,
          'bg-[color-mix(in_srgb,var(--hc)_14%,transparent)] text-(--hc) hover:bg-[color-mix(in_srgb,var(--hc)_24%,transparent)]',
        )}
        aria-label={`More ${h.name}`}
        onClick={() => check.mutate({ habit: h, amount: step, current: row.value })}
      >
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

export function HabitRow({
  row,
  compact,
  onEdit,
  onMove,
  onDrag,
  today,
}: {
  row: TodayRow
  compact?: boolean
  onEdit?: () => void
  onMove?: (dir: -1 | 1) => void
  onDrag?: (e: ReactPointerEvent<HTMLElement>) => void
  today?: string
}) {
  const h = row.habit
  const skip = useSkipToday()
  const pause = usePauseHabit()
  const navigate = useNavigate()
  const [day, setDay] = useState<DayTarget | null>(null)
  const archive = useArchiveHabit()
  const editDay = (focus?: 'note') =>
    today && setDay({ habit: h, day: today, value: row.value, skipped: row.skipped, note: row.note, focus })
  const pct = row.period_required > 0 ? Math.min(1, row.period_value / row.period_required) : 0
  const prog = progressText(row)
  const done = row.done && h.goal === 'at_least'
  const act = (fn: () => void, close: () => void) => () => {
    close()
    fn()
  }
  return (
    // A group named after the habit: Today's J/K focus lands on the row itself, which is not a list item or a button.
    // biome-ignore lint/a11y/useSemanticElements: see above
    <div
      className={cn(
        'group relative flex items-center rounded-sm hover:bg-hover focus-visible:-outline-offset-2',
        compact ? 'min-h-10 gap-2.5 px-2 py-1.5' : 'min-h-13 gap-3 py-2 pr-2 pl-2.5',
        !row.due && 'opacity-70',
      )}
      style={hc(h)}
      role="group"
      data-hid={compact ? undefined : h.id}
      tabIndex={compact ? undefined : -1}
      aria-label={h.name}
    >
      {onDrag && (
        <span
          className="absolute inset-y-0 left-0 grid w-3 cursor-grab touch-none place-items-center text-muted opacity-0 group-hover:opacity-80 touch:opacity-50 [&_svg]:w-3"
          onPointerDown={onDrag}
          title="Drag to reorder (or Alt + ↑/↓)"
          aria-hidden="true"
        >
          <Icon name="grip" size={14} />
        </span>
      )}
      <HabitBadge habit={h} size={compact ? 1.75 : 2.25} />
      <div className="grid min-w-0 flex-1 gap-0.5">
        <Link className={cn('truncate text-sm font-medium hover:text-fg', done ? 'text-muted' : 'text-fg')} to={`/habits/${h.id}`}>
          {h.name}
        </Link>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted">
          {!compact && <span>{goalText(h)}</span>}
          {prog && <span className="tabular-nums">{prog}</span>}
          {row.skipped && <span className={chipPlain}>Skipped</span>}
          {row.over && <span className={cn(chip, 'border-transparent bg-danger-soft text-danger')}>Over limit</span>}
          {h.paused && <span className={chipPlain}>Paused</span>}
          {row.streak > 0 && (
            <span
              className="inline-flex items-center gap-0.75 font-medium text-warning tabular-nums"
              title={`Current streak: ${streakText(row.streak, row.streak_unit)}`}
            >
              <HabitIcon name="flame" size={0.75} />
              {row.streak}
              {compact ? '' : ' ' + row.streak_unit + (row.streak === 1 ? '' : 's')}
            </span>
          )}
        </div>
        {row.note && !compact && (
          <span className="inline-flex max-w-full items-center gap-1 truncate text-xs text-muted italic [&_svg]:flex-none" title={row.note}>
            <Icon name="comment" size={12} />
            {row.note}
          </span>
        )}
        {!compact && (h.kind === 'measurable' || h.period !== 'day') && (
          <span className="mt-1 block h-1 max-w-64 overflow-hidden rounded-[2px] bg-surface-2" aria-hidden="true">
            <span
              className={cn('block h-full rounded-[2px] transition-[width] duration-300 ease-out', row.over ? 'bg-danger' : 'bg-(--hc)')}
              style={{ width: `${pct * 100}%` }}
            />
          </span>
        )}
      </div>
      <HabitCheck row={row} size={compact ? 'sm' : 'md'} onAmount={!compact && today ? () => editDay() : undefined} />
      {!compact && today && (
        <Menu
          align="end"
          label={`${h.name} actions`}
          trigger={(p) => (
            <button
              {...p}
              className={buttonClass({
                variant: 'ghost',
                size: 'sm',
                icon: true,
                className: 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100 aria-expanded:opacity-100 touch:opacity-100',
              })}
              aria-label={`Actions for "${h.name}"`}
            >
              <Icon name="more" size={14} />
            </button>
          )}
        >
          {(close) => (
            <>
              <MenuItem icon="chart" onClick={act(() => navigate(`/habits/${h.id}`), close)}>
                Stats and history
              </MenuItem>
              <MenuItem icon="clock" onClick={act(() => skip(row, today), close)} end={<span className="kbd">S</span>}>
                {row.skipped ? 'Unskip today' : 'Skip today'}
              </MenuItem>
              {h.kind === 'measurable' && (
                <MenuItem icon="edit" onClick={act(() => editDay(), close)}>
                  Type today's amount…
                </MenuItem>
              )}
              <MenuItem icon="comment" onClick={act(() => editDay('note'), close)}>
                {row.note ? "Edit today's note" : 'Add a note'}
              </MenuItem>
              {onEdit && (
                <MenuItem icon="edit" onClick={act(onEdit, close)} end={<span className="kbd">E</span>}>
                  Edit habit
                </MenuItem>
              )}
              {onMove && (
                <>
                  <MenuSeparator />
                  <MenuItem icon="arrowUp" onClick={act(() => onMove(-1), close)}>
                    Move up
                  </MenuItem>
                  <MenuItem icon="arrowDown" onClick={act(() => onMove(1), close)}>
                    Move down
                  </MenuItem>
                </>
              )}
              <MenuSeparator />
              <MenuItem icon={h.paused ? 'play' : 'clock'} onClick={act(() => pause.mutate({ id: h.id, paused: !h.paused }), close)}>
                {h.paused ? 'Resume' : 'Pause'}
              </MenuItem>
              <MenuItem icon="album" onClick={act(() => archive.mutate({ id: h.id, archived: true }), close)}>
                Archive
              </MenuItem>
            </>
          )}
        </Menu>
      )}
      <DayDialog target={day} onClose={() => setDay(null)} />
    </div>
  )
}
