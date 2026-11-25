// Progress grid: habits x days for a week or a month. Click a cell to log or clear that day
// (backfill; measurable habits open the day editor); right-click or long-press for amount, skip and note.
import { useState, type CSSProperties } from 'react'
import { Link } from 'react-router'
import { Icon } from '../../components/Icon'
import { Button, ErrorBox, Segmented, SkeletonRows } from '../../components/ui'
import { cn } from '../../lib/cn'
import { addDays, dayKey, fmtDate, parseDayKey } from '../../lib/dates'
import { useDayStart, userDayKey } from '../../lib/preferences'
import { useCheck, useEntries, useHabits, type Entry, type Habit } from './api'
import { useLongPress } from '../../lib/useLongPress'
import { DayDialog, type DayTarget } from './DayEditor'
import { HabitBadge, hc } from './HabitBadge'
import { dayMet, fmtNum, isScheduled } from './habitRules'

const RANGES = [
  { value: 'week', label: 'Week' },
  { value: 'month', label: '30 days' },
] as const

// Segmented's buttons keep the browser's border and grey fill; the class below clears them until it does.

// `sticky` isn't generated (an older stylesheet owns that class name, see tailwind.css), hence sticky.
const nameCell = 'sticky left-0 z-1 min-w-44 max-w-64 bg-surface px-3 py-1.5 text-left font-medium'
const sumCell = 'px-3 whitespace-nowrap text-muted'

export function GridView({
  range,
  end,
  onRange,
  onEnd,
}: {
  range: 'week' | 'month'
  end: string
  onRange: (r: 'week' | 'month') => void
  onEnd: (d: string) => void
}) {
  const todayKey = userDayKey(new Date(), useDayStart()) // before the day start it's still yesterday
  const span = range === 'week' ? 7 : 30
  const endDate = parseDayKey(end > todayKey ? todayKey : end)
  const days = Array.from({ length: span }, (_, i) => addDays(endDate, i - span + 1))
  const start = dayKey(days[0])
  const habits = useHabits()
  const entries = useEntries(start, dayKey(endDate))
  const byKey = new Map((entries.data ?? []).map((e) => [`${e.habit_id}|${e.date}`, e]))
  const atToday = dayKey(endDate) >= todayKey
  const [editing, setEditing] = useState<DayTarget | null>(null)

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <Segmented label="Range" value={range} options={RANGES} onChange={onRange} />
        <div className="flex items-center gap-1">
          <Button size="sm" icon aria-label="Earlier" onClick={() => onEnd(dayKey(addDays(endDate, -span)))}>
            <Icon name="chevronLeft" size={14} />
          </Button>
          <Button size="sm" icon aria-label="Later" disabled={atToday} onClick={() => onEnd(dayKey(addDays(endDate, span)))}>
            <Icon name="chevronRight" size={14} />
          </Button>
          {!atToday && (
            <Button size="sm" onClick={() => onEnd(todayKey)}>
              Today
            </Button>
          )}
        </div>
        <span className="text-sm text-muted tabular-nums">
          {fmtDate(days[0])} – {fmtDate(endDate, { month: 'short', day: 'numeric', year: 'numeric' })}
        </span>
      </div>

      {habits.isPending || entries.isPending ? (
        <SkeletonRows rows={5} avatar />
      ) : (habits.error && !habits.data) || (entries.error && !entries.data) ? (
        <ErrorBox error={habits.error ?? entries.error} />
      ) : !habits.data?.length ? (
        <div className="p-4 text-center text-sm text-muted">No habits yet.</div>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border bg-surface">
          <table className="w-full border-separate border-spacing-0 text-xs [&_td]:border-b [&_td]:border-border [&_th]:border-b [&_th]:border-border [&_tbody_tr:last-child>*]:border-b-0">
            <thead>
              <tr>
                <th scope="col" className={cn(nameCell, 'text-xs text-muted')}>
                  Habit
                </th>
                {days.map((d) => {
                  const today = dayKey(d) === todayKey
                  return (
                    <th
                      key={dayKey(d)}
                      scope="col"
                      className={cn('min-w-9 py-1.5 text-center font-medium leading-[1.3]', today ? 'text-accent' : 'text-muted')}
                    >
                      <span className="block">{fmtDate(d, { weekday: 'narrow' })}</span>
                      <span className={cn('block tabular-nums', today && 'font-bold')}>{d.getDate()}</span>
                    </th>
                  )
                })}
                <th scope="col" className={cn(sumCell, 'text-center')}>
                  Done
                </th>
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
                  return (
                    <Cell
                      key={k}
                      habit={h}
                      day={k}
                      entry={e}
                      scheduled={sched}
                      future={k > todayKey}
                      today={k === todayKey}
                      month={range === 'month'}
                      onEdit={setEditing}
                    />
                  )
                })
                return (
                  <tr key={h.id} style={hc(h)}>
                    <th scope="row" className={nameCell}>
                      <Link to={`/habits/${h.id}`} className="flex min-w-0 items-center gap-2 text-sm text-fg">
                        <HabitBadge habit={h} size={1.5} />
                        <span className="truncate">{h.name}</span>
                      </Link>
                    </th>
                    {cells}
                    <td className={cn(sumCell, 'text-center tabular-nums')}>{judged ? `${met}/${judged}` : '–'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted [&>span]:inline-flex [&>span]:items-center [&>span]:gap-1.5">
        <span>
          <i className={cn(swatch, 'bg-accent')} /> done
        </span>
        <span>
          <i className={cn(swatch, 'bg-[linear-gradient(to_top,var(--app-accent)_50%,var(--app-accent-soft)_0)]')} /> partly
        </span>
        {habits.data?.some((h) => h.goal === 'at_most') && (
          <span>
            <i className={cn(swatch, 'bg-[color-mix(in_srgb,var(--app-accent)_28%,var(--app-surface-2))]')} /> limit kept
          </span>
        )}
        <span>
          <i className={cn(swatch, 'bg-[repeating-linear-gradient(135deg,var(--app-surface-2)_0_2px,var(--app-muted)_2px_3px)]')} /> skipped
        </span>
        <span>
          <i className={cn(swatch, 'shadow-[inset_0_0_0_1px_var(--app-border)]')} /> not scheduled
        </span>
        <span>
          <i
            className={cn(
              swatch,
              'relative bg-surface-2 after:absolute after:top-px after:right-px after:size-1 after:rounded-full after:bg-fg',
            )}
          />{' '}
          note
        </span>
        <span className="text-muted">Click a day to log it; right-click or long-press to skip or add a note.</span>
      </p>
      <DayDialog target={editing} onClose={() => setEditing(null)} />
    </div>
  )
}

const swatch = 'inline-block size-3 rounded-[3px]'

const cellBase =
  'relative mx-auto grid place-items-center overflow-hidden border-0 p-0 text-white select-none [-webkit-touch-callout:none] [&_svg]:size-3.25'
const cellState: Record<string, string> = {
  met: 'bg-(--hc)',
  part: 'bg-[linear-gradient(to_top,var(--hc)_calc(var(--frac,0.5)*100%),color-mix(in_srgb,var(--hc)_18%,var(--app-surface-2))_0)]',
  over: 'bg-danger',
  skip: 'bg-[repeating-linear-gradient(135deg,var(--app-surface-2)_0_3px,color-mix(in_srgb,var(--app-muted)_35%,transparent)_3px_4.5px)]',
  off: 'bg-transparent shadow-[inset_0_0_0_1px_var(--app-border)]',
  empty: 'bg-surface-2',
  kept: 'bg-[color-mix(in_srgb,var(--hc)_28%,var(--app-surface-2))]',
}

function Cell({
  habit: h,
  day,
  entry,
  scheduled,
  future,
  today,
  month,
  onEdit,
}: {
  habit: Habit
  day: string
  entry?: Entry
  scheduled: boolean
  future: boolean
  today: boolean
  month: boolean
  onEdit: (t: DayTarget) => void
}) {
  const check = useCheck()
  const value = entry && !entry.skipped ? entry.value : 0
  const edit = () => onEdit({ habit: h, day, value: entry?.value ?? 0, skipped: !!entry?.skipped, note: entry?.note ?? '' })
  const press = useLongPress(edit, { rightClick: true })
  const before = day < h.start_date || (!!h.end_date && day > h.end_date)
  const met = !!entry && !entry.skipped && dayMet(h, value) && (h.goal === 'at_least' ? value > 0 : true)
  const over = h.goal === 'at_most' && value > h.target
  const part = !met && value > 0 && h.goal === 'at_least'
  const frac = part ? Math.min(0.85, Math.max(0.2, value / Math.max(h.target, 1))) : 0
  // A limit with nothing logged is kept (the classic grid's "kept" cell); the Done column counts it as met too.
  const kept = !met && !over && !entry?.skipped && scheduled && h.goal === 'at_most'
  const state = entry?.skipped ? 'skip' : over ? 'over' : met ? 'met' : part ? 'part' : kept ? 'kept' : scheduled ? 'empty' : 'off'
  const label = `${h.name}, ${fmtDate(parseDayKey(day), { weekday: 'long', month: 'short', day: 'numeric' })}: ${
    entry?.skipped
      ? 'skipped'
      : value
        ? fmtNum(value) + (h.unit ? ' ' + h.unit : '') + (over ? ', over the limit' : '')
        : kept
          ? 'kept (nothing logged)'
          : scheduled
            ? 'not done'
            : 'not scheduled'
  }${entry?.note ? ' · ' + entry.note : ''}`
  const size = month ? 'size-5.5 rounded-[5px]' : 'size-7 rounded-[6px]'
  if (future || before)
    return (
      <td className="px-0.5 py-1">
        <span className={cn(cellBase, size, 'bg-transparent')} aria-hidden="true" />
      </td>
    )

  const yesno = h.kind === 'yesno'
  // Numbers: white on a full cell; on a partly filled (or empty) one, the text colour with a halo of the
  // surface, so they read over both the coloured and the pale part in light and dark themes.
  const light = state === 'met' || state === 'over' || (part && frac >= 0.55)
  return (
    <td className={cn('px-0.5 py-1', today && 'bg-[color-mix(in_srgb,var(--app-accent-soft)_45%,transparent)]')}>
      <button
        type="button"
        className={cn(cellBase, size, cellState[state], 'hover:shadow-[0_0_0_2px_color-mix(in_srgb,var(--hc)_45%,transparent)]')}
        aria-pressed={yesno ? met : undefined}
        aria-label={label}
        title={label}
        style={part ? ({ ['--frac' as string]: frac } as CSSProperties) : undefined}
        {...press.handlers}
        onClick={() => {
          if (press.consumed()) return
          if (yesno) check.mutate({ habit: h, date: day, done: !met, current: value })
          else edit()
        }}
      >
        {yesno
          ? met && (
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={3.5}
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="m5 12.5 4.5 4.5L19 7.5" />
              </svg>
            )
          : value > 0 && (
              <span
                className={cn(
                  'relative text-3xs leading-none font-bold',
                  light
                    ? 'text-white [text-shadow:0_0_2px_color-mix(in_srgb,#000_35%,transparent)]'
                    : 'text-fg [text-shadow:0_0_2px_var(--app-surface),0_0_2px_var(--app-surface),0_0_1px_var(--app-surface)]',
                )}
              >
                {value >= 1000 ? Math.round(value / 100) / 10 + 'k' : fmtNum(Math.round(value * 10) / 10)}
              </span>
            )}
        {entry?.note && (
          <span
            className={cn(
              'absolute top-0.5 right-0.5 size-1.25 rounded-full',
              state === 'met' || state === 'over'
                ? 'bg-white shadow-[0_0_0_1px_color-mix(in_srgb,#000_25%,transparent)]'
                : 'bg-fg shadow-[0_0_0_1px_var(--app-surface)]',
            )}
            aria-hidden="true"
          />
        )}
      </button>
    </td>
  )
}
