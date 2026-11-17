// Home › Today: all-day chips, today's timed items with now/next/past states, then the next 7 days (up to 8).
import type { CSSProperties } from 'react'
import { Link } from 'react-router'
import { Icon } from '../../components/Icon'
import { ErrorBox, SkeletonRows } from '../../components/ui'
import { cn } from '../../lib/cn'
import { addDays, fmtDate, fmtTime, isSameDay, placedStart, relTime } from '../../lib/dates'
import type { AgendaItem } from '../../lib/types'
import { CardLink } from '../settings/Card'
import { Chip } from '../settings/Chip'
import { DashCard } from './DashCard'

const LATER_SHOWN = 8

export function AgendaCard({
  items,
  later,
  loading,
  error,
  now,
}: {
  items: AgendaItem[]
  later: AgendaItem[]
  loading: boolean
  error: unknown
  now: Date
}) {
  const allDay = items.filter((i) => i.kind === 'all_day')
  const timed = items.filter((i) => i.kind !== 'all_day')
  const current = timed.filter((i) => i.start && i.end && new Date(i.start) <= now && new Date(i.end) > now)
  const next = timed.find((i) => i.start && new Date(i.start) > now)
  return (
    <DashCard title="Today" icon="calendar" titleId="dash-agenda-h" actions={<Actions />}>
      {loading ? (
        <SkeletonRows rows={5} />
      ) : error ? (
        <ErrorBox error={error} />
      ) : (
        <div className="grid gap-1 px-2 pt-1.5 pb-3">
          {allDay.length > 0 && (
            <div className="flex flex-wrap gap-1 px-2 pt-1 pb-1.5">
              {allDay.map((i) => (
                <span
                  key={i.id}
                  className="rounded-xs border-l-3 border-(--c) bg-[color-mix(in_srgb,var(--c)_16%,var(--app-surface))] px-2 py-0.5 text-xs font-medium text-fg"
                  style={{ '--c': i.colour } as CSSProperties}
                >
                  {i.title}
                </span>
              ))}
            </div>
          )}
          {timed.length === 0 && <div className="p-4 text-sm text-muted">No events today.</div>}
          <ol className="m-0 grid list-none gap-px p-0">
            {timed.map((i) => {
              const start = i.start ? new Date(i.start) : null
              const end = i.end ? new Date(i.end) : null
              const isNow = current.includes(i)
              const isNext = next === i
              const last = end ?? start
              const past = !isNow && last !== null && last <= now
              return (
                <li
                  key={i.kind + i.id}
                  className={cn(
                    'grid grid-cols-[4.5rem_3px_minmax(0,1fr)] items-stretch gap-2.5 rounded-sm px-2 py-1.75 hover:bg-hover',
                    isNow && 'bg-accent-soft',
                    past && 'opacity-55',
                  )}
                >
                  <div className="grid content-start gap-px text-right text-xs font-medium text-fg tabular-nums">
                    {start &&
                      (i.kind === 'deadline' ? (
                        <span className="inline-flex items-center justify-end gap-0.75">
                          <Icon name="flag" size={12} className="text-warning" />
                          {fmtTime(start)}
                        </span>
                      ) : (
                        fmtTime(start)
                      ))}
                    {end && i.kind === 'event' && <span className="font-normal text-muted">{fmtTime(end)}</span>}
                  </div>
                  <span className="min-h-7 rounded-[2px]" style={{ background: i.colour }} aria-hidden="true" />
                  <div className="grid min-w-0 gap-px">
                    <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-sm font-medium">
                      <span className={cn('min-w-0 wrap-anywhere', isNext && 'font-semibold')}>{i.title}</span>
                      {isNow && <Chip tone="accent">Now</Chip>}
                      {isNext && start && <Chip>Next · {relTime(start, now)}</Chip>}
                      {i.kind === 'deadline' && <Chip tone="warning">Due</Chip>}
                    </div>
                    <div className="truncate text-xs text-muted">{[i.calendar, i.location].filter(Boolean).join(' · ')}</div>
                  </div>
                </li>
              )
            })}
          </ol>
          {later.length > 0 && <Later items={later} now={now} />}
        </div>
      )}
    </DashCard>
  )
}

function Actions() {
  return (
    <>
      <span className="flex-1" />
      <CardLink to="/calendar">Calendar</CardLink>
    </>
  )
}

function Later({ items, now }: { items: AgendaItem[]; now: Date }) {
  const start = (i: AgendaItem) => new Date(placedStart(i) as string)
  return (
    <div className="mt-2 grid gap-1 border-t border-border px-2 pt-2.5">
      <div className="mb-1.5 text-xs font-semibold text-muted">Next 7 days</div>
      {items.slice(0, LATER_SHOWN).map((i, idx) => {
        const d = start(i)
        const newDay = idx === 0 || !isSameDay(d, start(items[idx - 1]))
        return (
          <div key={i.kind + i.id} className="grid grid-cols-[4.5rem_auto_4rem_minmax(0,1fr)] items-center gap-2 text-xs">
            <span className="font-semibold text-fg">
              {newDay ? (isSameDay(d, addDays(now, 1)) ? 'Tomorrow' : fmtDate(d, { weekday: 'short', day: 'numeric' })) : ''}
            </span>
            <span className="size-2 shrink-0 rounded-full" style={{ background: i.colour }} />
            <span className="text-muted tabular-nums">{i.kind === 'all_day' || !i.start ? 'All day' : fmtTime(d)}</span>
            <span className="truncate">
              {i.kind === 'deadline' ? 'Due: ' : ''}
              {i.title}
            </span>
          </div>
        )
      })}
      {items.length > LATER_SHOWN && (
        <Link className="text-xs text-muted" to="/calendar?view=agenda">
          +{items.length - LATER_SHOWN} more in the agenda
        </Link>
      )}
    </div>
  )
}
