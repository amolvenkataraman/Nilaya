import { Link } from 'react-router'
import { Icon } from '../../components/Icon'
import { ErrorBox, SkeletonRows } from '../../components/ui'
import { dayDiff, dayKey, fmtDate, groupByDay, isEndOfDay, placedStart } from '../../lib/dates'
import { useAgenda } from '../../lib/queries'
import type { AgendaItem } from '../../lib/types'
import { dayStartIn, fmtDateIn, fmtTimeIn, toZoneInput, useCalPrefs, zoneDay, type Zone } from './zone'

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
  const q = useAgenda(14, true)
  const { tz } = useCalPrefs()
  const now = zoneDay(Date.now(), tz) // today in the display zone
  if (q.isError && !q.data) return <ErrorBox error={q.error} retry={() => q.refetch()} />
  if (q.isPending) return <div className="agenda"><SkeletonRows rows={8} /></div>
  const today = now
  const todayStart = dayStartIn(today, tz)
  const items = q.data
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
  const rest = items.filter((i) => !overdue.includes(i))
    .map((i, n) => ({ i, n, key: placeOf(i) ? dayKey(new Date(placeOf(i)!)) : '~' }))
    .sort((a, b) => a.key.localeCompare(b.key) || a.n - b.n)
    .map((x) => x.i)
  const groups = groupByDay(rest, placeOf)
  if (!items.length) return <div className="agenda"><p className="empty">Nothing in the next two weeks.</p></div>
  return (
    <div className="agenda">
      {overdue.length > 0 && (
        <section className="agenda-day">
          <h2 className="agenda-date overdue">Overdue</h2>
          <ul>{overdue.map((i) => <Row key={i.kind + i.id} item={i} tz={tz} onOpen={onOpen} showDate />)}</ul>
        </section>
      )}
      {groups.map((g) => (
        <section key={g.key} className={'agenda-day' + (g.date && dayKey(g.date) === dayKey(now) ? ' is-today' : '')}>
          <h2 className="agenda-date">{g.date ? dayHeading(g.date, now) : 'No date'}</h2>
          <ul>{g.items.map((i) => <Row key={i.kind + i.id} item={i} tz={tz} onOpen={onOpen} />)}</ul>
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
  if (showDate && s) time = i.kind === 'all_day' ? fmtDate(s, { month: 'short', day: 'numeric' }) : fmtDateIn(s, { month: 'short', day: 'numeric' }, zone)
  const body = (
    <>
      <span className="agenda-bar" style={{ background: i.colour }} />
      <span className="agenda-time tabular">{time}</span>
      <span className="grow" style={{ minWidth: 0 }}>
        <span className={'agenda-title' + (i.done ? ' done' : '')}>
          {i.kind === 'deadline' && <Icon name="flag" size={12} />}
          {i.kind === 'todo' && <Icon name="tasks" size={12} />}
          {i.title}
        </span>
        <span className="agenda-sub truncate">
          {i.calendar}
          {i.end && s && i.kind === 'event' ? ` · until ${fmtTimeIn(new Date(i.end), tz)}` : ''}
          {i.location ? ` · ${i.location}` : ''}
        </span>
      </span>
    </>
  )
  return (
    <li>
      {i.kind === 'todo' ? (
        <Link className="agenda-item" to={`/tasks?view=all&task=${encodeURIComponent(i.id)}`}>{body}</Link>
      ) : (
        <button type="button" className="agenda-item" onClick={() => onOpen(i)}>{body}</button>
      )}
    </li>
  )
}
