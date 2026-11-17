// One habit: today's check-in, streaks, strength, completion rates, a year heat map, strength over time,
// completion by weekday, totals (measurable habits) and the day notes.
import { useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { Columns } from '../../components/charts'
import { Icon } from '../../components/Icon'
import { layerOpen } from '../../components/layers'
import { Button, buttonClass, Confirm, ErrorBox, Menu, MenuItem, MenuSeparator, SkeletonRows, useHotkey } from '../../components/ui'
import { cn } from '../../lib/cn'
import { fmtDate, fmtTime, parseDayKey } from '../../lib/dates'
import { useArchiveHabit, useDeleteHabit, useHabits, usePauseHabit, useStats, useToday, type Habit } from './api'
import { Card, cardClass } from './Card'
import { DayDialog, type DayTarget } from './DayEditor'
import { HabitBadge, HabitIcon, hc } from './HabitBadge'
import { Heatmap, ScoreTrend } from './HabitCharts'
import { HabitCheck, progressText } from './HabitRow'
import { fmtNum, goalText, scheduleText, streakText, WEEKDAY_LETTERS } from './habitRules'
import { habitPage } from './page'

/** "20:00:00" -> the app's time format. */
const clock = (t: string) => {
  const [h, m] = t.split(':').map(Number)
  return fmtTime(new Date(2000, 0, 1, h, m))
}
const pct = (v: number | null) => (v === null ? '–' : `${Math.round(v * 100)}%`)
const longDate = (day: string) => fmtDate(parseDayKey(day), { month: 'short', day: 'numeric', year: 'numeric' })
const tile = cn(cardClass, 'grid content-start gap-1 px-4 py-3')
const empty = 'p-4 text-sm text-muted'

export function HabitDetail({ id, onEdit }: { id: string; onEdit: (h: Habit) => void }) {
  const all = useHabits(true)
  const habit = all.data?.find((h) => h.id === id)
  const stats = useStats(habit ? id : undefined)
  const today = useToday()
  const row = today.data?.habits.find((r) => r.habit.id === id)
  const pause = usePauseHabit()
  const archive = useArchiveHabit()
  const remove = useDeleteHabit()
  const navigate = useNavigate()
  const [confirm, setConfirm] = useState(false)
  const [day, setDay] = useState<DayTarget | null>(null)
  useHotkey(
    (e) => e.key === 'e' && !e.metaKey && !e.ctrlKey && !e.altKey && !!habit && !layerOpen(['dialog', 'palette', 'menu']),
    (e) => {
      e.preventDefault()
      if (habit) onEdit(habit)
    },
  )

  if (all.isPending)
    return (
      <div className={habitPage()}>
        <SkeletonRows rows={6} />
      </div>
    )
  if (all.error && !all.data)
    return (
      <div className={habitPage()}>
        <ErrorBox error={all.error} />
      </div>
    )
  if (!habit)
    return (
      <div className={habitPage()}>
        <div className="p-4 text-center text-sm text-muted">That habit doesn't exist any more.</div>
      </div>
    )
  const s = stats.data
  const unitWord = (n: number) => streakText(n, s?.streak_unit ?? 'day').replace(/^\d+ /, '')
  const menuAction = (fn: () => void, close: () => void) => () => {
    close()
    fn()
  }

  return (
    <div className={habitPage()} style={hc(habit)}>
      <header className="flex flex-wrap items-center gap-3.5">
        <HabitBadge habit={habit} size={3} />
        <div className="min-w-0 flex-auto">
          <h1 className="truncate text-xl tracking-[-0.02em]">{habit.name}</h1>
          <p className="text-sm text-muted">
            {goalText(habit)}
            {habit.period !== 'day' || habit.kind === 'measurable' ? ` · ${scheduleText(habit)}` : ''}
            {habit.reminder_time && ` · Reminder ${clock(habit.reminder_time)}`}
            {` · Since ${longDate(habit.start_date)}`}
            {habit.end_date && ` until ${longDate(habit.end_date)}`}
            {habit.paused && ' · Paused'}
            {habit.archived && ' · Archived'}
          </p>
        </div>
        {row && !habit.archived && (
          <div className="flex items-center gap-2.5">
            {progressText(row) && <span className="text-sm text-muted tabular-nums">{progressText(row)}</span>}
            <HabitCheck row={row} />
          </div>
        )}
        <Button size="sm" onClick={() => onEdit(habit)} title="Edit (E)">
          <Icon name="edit" size={14} />
          Edit
        </Button>
        <Menu
          align="end"
          label="Habit actions"
          trigger={(p) => (
            <button {...p} className={buttonClass({ size: 'sm', icon: true })} aria-label="More actions">
              <Icon name="more" size={14} />
            </button>
          )}
        >
          {(close) => (
            <>
              <MenuItem
                icon={habit.paused ? 'play' : 'clock'}
                onClick={menuAction(() => pause.mutate({ id: habit.id, paused: !habit.paused }), close)}
              >
                {habit.paused ? 'Resume' : 'Pause'}
              </MenuItem>
              <MenuItem icon="album" onClick={menuAction(() => archive.mutate({ id: habit.id, archived: !habit.archived }), close)}>
                {habit.archived ? 'Restore from archive' : 'Archive'}
              </MenuItem>
              <MenuSeparator />
              <MenuItem icon="trash" danger onClick={menuAction(() => setConfirm(true), close)}>
                Delete habit
              </MenuItem>
            </>
          )}
        </Menu>
      </header>
      {habit.description && <p className="text-sm whitespace-pre-wrap wrap-anywhere text-muted">{habit.description}</p>}

      {stats.error && !stats.data ? (
        <ErrorBox error={stats.error} retry={() => stats.refetch()} />
      ) : !s ? (
        <div className="grid grid-cols-4 gap-3 max-md:grid-cols-2">
          {['current', 'best', 'strength', 'completion'].map((k) => (
            <div key={k} className={tile}>
              <span className="block h-10 animate-pulse rounded-xs bg-surface-2" />
            </div>
          ))}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-4 gap-3 max-md:grid-cols-2">
            <Tile label="Current streak">
              <HabitIcon name="flame" size={1.1} />
              {s.current_streak}
              <small>{unitWord(s.current_streak)}</small>
            </Tile>
            <Tile label="Best streak">
              {s.best_streak}
              <small>{unitWord(s.best_streak)}</small>
            </Tile>
            <Tile
              label="Habit strength"
              extra={
                <span className="mt-1 block h-1 max-w-64 overflow-hidden rounded-[2px] bg-surface-2" aria-hidden="true">
                  <span
                    className="block h-full rounded-[2px] bg-(--hc) transition-[width] duration-300 ease-out"
                    style={{ width: `${s.score}%` }}
                  />
                </span>
              }
            >
              {Math.round(s.score)}
              <small>/ 100</small>
            </Tile>
            <Tile
              label="Completion"
              extra={
                <span className="text-xs text-muted">
                  7 d {pct(s.rates.d7)} · 90 d {pct(s.rates.d90)} · all {pct(s.rates.all)}
                </span>
              }
            >
              {pct(s.rates.d30)}
              <small>30 days</small>
            </Tile>
          </div>

          <Card id="heat-h" title="Last 12 months">
            <Heatmap stats={s} habit={habit} />
          </Card>

          <div className="grid grid-cols-2 gap-3 max-md:grid-cols-1">
            <Card id="trend-h" title="Strength over time">
              <ScoreTrend points={s.score_trend} />
            </Card>
            <Card id="wd-h" title="By weekday">
              {s.weekdays.some((w) => w.judged) ? (
                <Columns
                  title="Completion by weekday"
                  values={s.weekdays.map((w) => (w.rate ?? 0) * 100)}
                  labels={WEEKDAY_LETTERS}
                  format={(v) => `${Math.round(v)}%`}
                  height={96}
                />
              ) : (
                <div className={empty}>Not enough history yet.</div>
              )}
            </Card>
          </div>

          {habit.kind === 'measurable' && (
            <Card id="tot-h" title={`Totals${habit.unit ? ` (${habit.unit})` : ''}`}>
              <dl className="m-0 grid grid-cols-3 gap-x-4 gap-y-3 max-md:grid-cols-2 [&_dd]:m-0 [&_dd]:text-md [&_dd]:font-semibold [&_dd]:tabular-nums [&_dt]:text-xs [&_dt]:text-muted">
                <div>
                  <dt>This week</dt>
                  <dd>{fmtNum(s.totals.week)}</dd>
                </div>
                <div>
                  <dt>This month</dt>
                  <dd>{fmtNum(s.totals.month)}</dd>
                </div>
                <div>
                  <dt>All time</dt>
                  <dd>{fmtNum(s.totals.total)}</dd>
                </div>
                <div>
                  <dt>Daily average</dt>
                  <dd>{s.totals.average === null ? '–' : fmtNum(Math.round(s.totals.average * 10) / 10)}</dd>
                </div>
                <div>
                  <dt>Best day</dt>
                  <dd>{s.totals.best === null ? '–' : fmtNum(s.totals.best)}</dd>
                </div>
                <div>
                  <dt>Days logged</dt>
                  <dd>{s.totals.days}</dd>
                </div>
              </dl>
            </Card>
          )}

          <Card
            id="notes-h"
            title="Notes"
            bodyClass={s.notes.length ? 'px-4 pt-1 pb-3' : ''}
            action={
              <>
                <span className="flex-1" />
                {row && !habit.archived && !s.notes.some((n) => n.date === s.today) && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setDay({ habit, day: s.today, value: row.value, skipped: row.skipped, note: row.note, focus: 'note' })}
                  >
                    <Icon name="plus" size={14} />
                    Note for today
                  </Button>
                )}
              </>
            }
          >
            {s.notes.length ? (
              <ul className="grid gap-2">
                {s.notes.map((n) => (
                  <li key={n.date} className="grid grid-cols-[6.5rem_minmax(0,1fr)] items-baseline gap-3 max-md:grid-cols-1 max-md:gap-0.5">
                    <button
                      type="button"
                      className="cursor-pointer border-0 bg-transparent p-0 text-left text-xs text-muted tabular-nums underline decoration-dotted underline-offset-3 hover:text-fg"
                      title="Edit this day"
                      onClick={() => setDay({ habit, day: n.date, value: n.value, skipped: n.skipped, note: n.note, focus: 'note' })}
                    >
                      {longDate(n.date)}
                    </button>
                    <span className="text-sm whitespace-pre-wrap wrap-anywhere">{n.note}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className={empty}>No notes yet. Add one from Today or the Progress grid (right-click or long-press a day).</div>
            )}
          </Card>
        </>
      )}
      <Confirm
        open={confirm}
        title={`Delete "${habit.name}"?`}
        body="All of its history is deleted too. Archive it instead to keep the stats."
        onConfirm={() => remove.mutate(habit.id, { onSuccess: () => navigate('/habits') })}
        onClose={() => setConfirm(false)}
      />
      <DayDialog target={day} onClose={() => setDay(null)} />
    </div>
  )
}

function Tile({ label, extra, children }: { label: string; extra?: ReactNode; children: ReactNode }) {
  return (
    <div className={tile}>
      <span className="text-xs font-medium text-muted">{label}</span>
      <span className="flex items-baseline gap-1.25 text-xl font-semibold tracking-[-0.02em] tabular-nums [&_small]:text-xs [&_small]:font-normal [&_small]:tracking-normal [&_small]:text-muted [&_svg]:self-center [&_svg]:text-warning">
        {children}
      </span>
      {extra}
    </div>
  )
}
