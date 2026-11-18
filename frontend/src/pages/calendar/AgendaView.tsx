// The agenda: the next two weeks from GET /calendar/agenda (events, deadlines and tasks), grouped by day in the
// display zone, overdue first. Its row look is shared with the phone month's day list.
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { Icon, type IconName } from '../../components/Icon'
import { EmptyState, QueryView, SkeletonRows } from '../../components/ui'
import { cn } from '../../lib/cn'
import { dayDiff, dayKey, fmtDate, groupByDay, isEndOfDay, placedStart } from '../../lib/dates'
import { useAgenda } from '../../lib/queries'
import type { AgendaItem } from '../../lib/types'
import { dayStartIn, fmtDateIn, fmtTimeIn, toZoneInput, useCalPrefs, zoneDay, type Zone } from './zone'

const AGENDA_DAYS = 14
const page = 'mx-auto w-full max-w-208 px-4 pt-3 pb-8'
const dayHead = 'px-2 py-1.5 text-xs font-semibold tracking-[0.04em] uppercase'
export const agendaItem = cn(
  'flex w-full items-start gap-3 rounded-sm border-0 bg-transparent p-2 text-left text-sm text-fg hover:bg-hover hover:no-underline',
)

/** An agenda row's insides: the colour bar, the time, the title (with an optional glyph) and a muted line. */
export function AgendaLine({
  colour,
  time,
  icon,
  title,
  done,
  sub,
}: {
  colour: string
  time: string
  icon?: IconName
  title: ReactNode
  done?: boolean
  sub?: ReactNode
}) {
  return (
    <>
      <span className="min-h-8 w-0.75 flex-none self-stretch rounded-[2px]" style={{ background: colour }} />
      <span className="w-19 flex-none pt-px text-sm text-muted tabular-nums">{time}</span>
      <span className="min-w-0 flex-auto">
        <span className={cn('flex items-center gap-1.5 font-medium wrap-anywhere', done && 'text-muted line-through')}>
          {icon && <Icon name={icon} size={12} className="flex-none text-muted" />}
          {title}
        </span>
        {sub && <span className="mt-px block min-w-0 truncate text-xs text-muted">{sub}</span>}
      </span>
    </>
  )
}

/** Date-only items (all-day events, tasks due "on a day" at 23:59) stay on their own date in any zone. */
const dateOnly = (i: AgendaItem) => i.kind === 'all_day' || (i.kind === 'todo' && !!i.start && isEndOfDay(new Date(i.start)))

function dayHeading(d: Date, now: Date): string {
  const diff = dayDiff(now, d)
  const date = fmtDate(d, { weekday: 'long', month: 'long', day: 'numeric' })
  if (diff === 0) return `Today · ${date}`
  if (diff === 1) return `Tomorrow · ${date}`
  return date
}

export function AgendaView({ onOpen }: { onOpen: (item: AgendaItem) => void }) {
  const q = useAgenda(AGENDA_DAYS, true)
  const { tz } = useCalPrefs()
  return (
    <QueryView
      query={q}
      skeleton={
        <div className={page}>
          <SkeletonRows rows={8} />
        </div>
      }
      isEmpty={(items) => !items.length}
      empty={
        <div className={page}>
          <EmptyState>Nothing in the next two weeks.</EmptyState>
        </div>
      }
    >
      {(items) => <Agenda items={items} tz={tz} onOpen={onOpen} />}
    </QueryView>
  )
}

function Agenda({ items, tz, onOpen }: { items: AgendaItem[]; tz: Zone; onOpen: (item: AgendaItem) => void }) {
  const today = zoneDay(Date.now(), tz) // today in the display zone
  const todayStart = dayStartIn(today, tz)
  const overdue = items.filter((i) => i.kind !== 'all_day' && i.start && new Date(i.start).getTime() < todayStart && !i.done)
  // All-day items by their own date (in another zone their instant falls on the neighbouring day);
  // one that began earlier and is still on shows under today.
  const todayAt = `${dayKey(today)}T00:00:00`
  // Timed items by their wall clock in the display zone (a zone-less local string, like all-day ones).
  const placeOf = (i: AgendaItem) => {
    const at = placedStart(i)
    if (at && !dateOnly(i)) return toZoneInput(at, tz)
    return i.kind === 'all_day' && at && at < todayAt ? todayAt : at
  }
  const rest = items
    .filter((i) => !overdue.includes(i))
    .map((i, n) => ({ i, n, key: placeOf(i) ? dayKey(new Date(placeOf(i)!)) : '~' }))
    .sort((a, b) => a.key.localeCompare(b.key) || a.n - b.n)
    .map((x) => x.i)
  const groups = groupByDay(rest, placeOf)
  const section = 'border-b border-border py-2 last:border-b-0'
  return (
    <div className={page}>
      {overdue.length > 0 && (
        <section className={section}>
          <h2 className={cn(dayHead, 'text-danger')}>Overdue</h2>
          <ul>
            {overdue.map((i) => (
              <Row key={i.kind + i.id} item={i} tz={tz} onOpen={onOpen} showDate />
            ))}
          </ul>
        </section>
      )}
      {groups.map((g) => (
        <section key={g.key} className={section}>
          <h2 className={cn(dayHead, g.date && dayKey(g.date) === dayKey(today) ? 'text-accent' : 'text-muted')}>
            {g.date ? dayHeading(g.date, today) : 'No date'}
          </h2>
          <ul>
            {g.items.map((i) => (
              <Row key={i.kind + i.id} item={i} tz={tz} onOpen={onOpen} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}

function Row({ item: i, tz, onOpen, showDate }: { item: AgendaItem; tz: Zone; onOpen: (i: AgendaItem) => void; showDate?: boolean }) {
  const at = placedStart(i)
  const s = at ? new Date(at) : null
  const zone = dateOnly(i) ? undefined : tz
  let time = ''
  if (i.kind === 'all_day') time = 'All day'
  else if (s) time = (i.kind === 'deadline' || i.kind === 'todo') && isEndOfDay(s) ? 'Due' : fmtTimeIn(s, zone)
  if (showDate && s)
    time = i.kind === 'all_day' ? fmtDate(s, { month: 'short', day: 'numeric' }) : fmtDateIn(s, { month: 'short', day: 'numeric' }, zone)
  const body = (
    <AgendaLine
      colour={i.colour}
      time={time}
      icon={i.kind === 'deadline' ? 'flag' : i.kind === 'todo' ? 'tasks' : undefined}
      title={i.title}
      done={i.done}
      sub={
        <>
          {i.calendar}
          {i.end && s && i.kind === 'event' ? ` · until ${fmtTimeIn(new Date(i.end), tz)}` : ''}
          {i.location ? ` · ${i.location}` : ''}
        </>
      }
    />
  )
  return (
    <li>
      {i.kind === 'todo' ? (
        <Link className={agendaItem} to={`/tasks?view=all&task=${encodeURIComponent(i.id)}`}>
          {body}
        </Link>
      ) : (
        <button type="button" className={agendaItem} onClick={() => onOpen(i)}>
          {body}
        </button>
      )}
    </li>
  )
}
