// Today (/habits): the date and a done/total ring, the best current streak and last 7 days, the habits due today
// and the others in their own list (drag or Alt+↑/↓ to reorder), archived habits on demand and the shortcuts.
import { useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { Icon } from '../../components/Icon'
import { Button, ErrorBox, SkeletonRows } from '../../components/ui'
import { cn } from '../../lib/cn'
import { fmtLongDate, parseDayKey } from '../../lib/dates'
import { useArchiveHabit, useHabits, useToday, type Habit, type TodayRow } from './api'
import { cardClass } from './Card'
import { HabitBadge, HabitIcon } from './HabitBadge'
import { HabitRow } from './HabitRow'
import { goalText, streakText } from './habitRules'
import { habitPage } from './page'
import { useRowReorder } from './useRowReorder'
import { useTodayHotkeys } from './useTodayHotkeys'

const isDue = (r: TodayRow) => r.due && !r.habit.paused
const list = cn(cardClass, 'grid gap-px p-1')

export function TodayView({ onNew, onEdit }: { onNew: () => void; onEdit: (h: Habit) => void }) {
  const today = useToday()
  const t = today.data
  const loaded = t?.habits ?? []
  const { rows, move, drag, keepFocus } = useRowReorder(loaded, isDue)
  const due = rows.filter(isDue)
  const other = rows.filter((r) => !isDue(r))
  const pct = t?.total ? t.done / t.total : 0
  // Best current streak (limits after goals on a tie), from Today alone like the classic page.
  const best = useMemo(() => [...loaded].sort((a, b) => b.streak - a.streak || (a.habit.goal === 'at_least' ? -1 : 1))[0], [loaded])
  useTodayHotkeys({ rows, today: t?.date, move, keepFocus, onEdit })

  const row = (r: TodayRow, date: string) => (
    <HabitRow
      key={r.habit.id}
      row={r}
      today={date}
      onEdit={() => onEdit(r.habit)}
      onMove={(d) => move(r.habit.id, d)}
      onDrag={drag(r.habit.id)}
    />
  )
  return (
    <div className={habitPage()}>
      <header className="flex items-center gap-4">
        <div className="min-w-0 flex-auto">
          <h1>Today</h1>
          <p className="text-sm text-muted">{t ? fmtLongDate(parseDayKey(t.date)) : ' '}</p>
        </div>
        {t && t.total > 0 && (
          <div
            className={cn(
              'relative grid size-13 flex-none place-items-center rounded-full',
              'before:absolute before:inset-0 before:rounded-full before:bg-[conic-gradient(var(--app-accent)_calc(var(--p)*360deg),var(--app-surface-2)_0)]',
              'before:[mask:radial-gradient(farthest-side,transparent_calc(100%-5px),#000_calc(100%-4px))]',
            )}
            role="img"
            aria-label={`${t.done} of ${t.total} done`}
            style={{ ['--p' as string]: pct }}
          >
            <span className="absolute inset-0 flex items-center justify-center text-sm font-semibold tabular-nums">
              {t.done}
              <small className="font-normal text-muted">/{t.total}</small>
            </span>
          </div>
        )}
      </header>

      {t && loaded.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <Stat
            value={
              best?.streak ? (
                <>
                  <HabitIcon name="flame" size={0.9} />
                  {best.streak}
                </>
              ) : (
                '–'
              )
            }
            label={
              best?.streak
                ? `${streakText(best.streak, best.streak_unit).replace(/^\d+ /, '')} · ${best.habit.name}`
                : 'Best current streak'
            }
          />
          <Stat value={t.week_judged ? `${Math.round((t.week_done / t.week_judged) * 100)}%` : '–'} label="Last 7 days" />
          {t.over > 0 && <Stat value={t.over} label={`${t.over === 1 ? 'limit' : 'limits'} over`} over />}
        </div>
      )}

      {today.isPending ? (
        <div className={cardClass}>
          <SkeletonRows rows={4} avatar />
        </div>
      ) : today.error && !t ? (
        <ErrorBox error={today.error} retry={() => today.refetch()} />
      ) : !t || rows.length === 0 ? (
        <div className={cn(cardClass, 'grid justify-items-center gap-3 px-4 py-10 text-center text-muted')}>
          <Icon name="repeat" size={28} />
          <p>Build a habit by checking it off every day.</p>
          <Button variant="primary" onClick={onNew}>
            <Icon name="plus" size={14} />
            New habit
          </Button>
        </div>
      ) : (
        <>
          <section className={list} aria-label="Due today" data-habit-list>
            {due.length === 0 && <div className="p-4 text-center text-sm text-muted">Nothing scheduled today.</div>}
            {due.map((r) => row(r, t.date))}
          </section>
          {other.length > 0 && (
            <section aria-label="Not due today">
              <h2 className="mt-2 mb-1.5 text-sm font-semibold text-muted">Not due today</h2>
              <div className={list} data-habit-list>
                {other.map((r) => row(r, t.date))}
              </div>
            </section>
          )}
        </>
      )}
      {t && <ArchivedSection />}
      {rows.length > 0 && (
        <p className="flex flex-wrap items-center gap-1 text-xs text-muted max-md:hidden touch:hidden">
          <span className="kbd">N</span> new · <span className="kbd">J</span>
          <span className="kbd">K</span> move between habits · <span className="kbd">Space</span> check off · <span className="kbd">+</span>
          <span className="kbd">−</span> amount · <span className="kbd">S</span> skip today · <span className="kbd">E</span> edit ·{' '}
          <span className="kbd">?</span> all shortcuts
        </p>
      )}
    </div>
  )
}

function Stat({ value, label, over }: { value: ReactNode; label: string; over?: boolean }) {
  return (
    <div
      className={cn(
        'grid max-w-full min-w-28 gap-px rounded-md border px-3.5 py-2',
        over
          ? 'border-[color-mix(in_srgb,var(--app-danger)_40%,var(--app-border))] bg-danger-soft text-danger'
          : 'border-border bg-surface',
      )}
    >
      <strong className="inline-flex items-center gap-1 text-md leading-[1.3] font-semibold tabular-nums [&_svg]:text-warning">
        {value}
      </strong>
      <span className={cn('truncate text-xs', over ? 'text-danger' : 'text-muted')}>{label}</span>
    </div>
  )
}

function ArchivedSection() {
  const [open, setOpen] = useState(false)
  return (
    <section className="grid justify-items-start gap-2" aria-label="Archived habits">
      <Button variant="ghost" size="sm" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Icon name={open ? 'chevronUp' : 'chevronDown'} size={14} />
        {open ? 'Hide archived' : 'Show archived'}
      </Button>
      {open && <ArchivedList />}
    </section>
  )
}

function ArchivedList() {
  const all = useHabits(true)
  const archive = useArchiveHabit()
  const items = (all.data ?? []).filter((h) => h.archived)
  if (all.isPending) return <SkeletonRows rows={2} avatar />
  if (all.error && !all.data) return <ErrorBox error={all.error} retry={() => all.refetch()} />
  if (!items.length) return <p className="px-2 text-sm text-muted">Nothing archived.</p>
  return (
    <div className={cn(list, 'w-full')}>
      {items.map((h) => (
        <div key={h.id} className="flex min-h-13 items-center gap-3 rounded-sm py-2 pr-2 pl-2.5 opacity-70 hover:bg-hover">
          <HabitBadge habit={h} size={2} />
          <div className="grid min-w-0 flex-1 gap-0.5">
            <Link className="truncate text-sm font-medium text-fg hover:text-fg" to={`/habits/${h.id}`}>
              {h.name}
            </Link>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted">
              <span>{goalText(h)}</span>
            </div>
          </div>
          <Button size="sm" disabled={archive.isPending} onClick={() => archive.mutate({ id: h.id, archived: false })}>
            Unarchive
          </Button>
        </div>
      ))}
    </div>
  )
}
