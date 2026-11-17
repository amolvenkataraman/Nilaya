// /calendar/public/:id: a public calendar's month, for anyone with the link. One request for the
// calendar and one per visible 6-week grid. Private events arrive as "Busy" (masked by the server).
// Narrow screens (640px and less) get an agenda list instead of the grid.
import { type CSSProperties, useMemo } from 'react'
import { Link, useLocation, useParams, useSearchParams } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Icon } from '../../components/Icon'
import { toast } from '../../components/toast'
import { Button, buttonClass, cardClass, ErrorBox, SkeletonRows, useMediaQuery } from '../../components/ui'
import { ApiError, get, loginUrl, post } from '../../lib/api'
import { cn } from '../../lib/cn'
import { addDays, addMonths, dateFormatter, dayKey, fmtTime, isSameDay, monthGrid, startOfDay } from '../../lib/dates'
import { signedIn } from '../../lib/session'
import { PublicFrame, PublicNotice, usePublicTitle } from './PublicFrame'

interface PublicCal {
  id: number
  name: string
  colour: string
  description: string
  owner: string
  time_zone: string
  subscribed: boolean | null
}
interface PublicEvent {
  id: string
  name: string
  start: string
  end: string | null
  all_day: boolean
  location: string | null
  busy: boolean
}
interface Placed extends PublicEvent {
  s: Date
  e: Date
}

const MAX_CHIPS = 3
const monthTitle = dateFormatter({ month: 'long', year: 'numeric' })
const weekday = dateFormatter({ weekday: 'short' })
const agendaDay = dateFormatter({ weekday: 'short', month: 'short', day: 'numeric' })
const parseMonth = (raw: string | null) => {
  const m = /^(\d{4})-(\d{2})$/.exec(raw ?? '')
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, 1) : new Date(new Date().getFullYear(), new Date().getMonth(), 1)
}
const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`

/** Local days an event covers; all-day and multi-day ends are exclusive. */
function daysOf(ev: Placed, first: Date, last: Date): string[] {
  const endIncl = ev.all_day || ev.e.getTime() > ev.s.getTime() ? new Date(ev.e.getTime() - 1) : ev.e
  const out: string[] = []
  for (let d = startOfDay(ev.s < first ? first : ev.s); d <= endIncl && d <= last && out.length < 42; d = addDays(d, 1)) out.push(dayKey(d))
  return out
}

/** An event in a day cell: the calendar's colour as a tint with an edge, solid for all-day. */
function chipClass(ev: Placed) {
  return cn(
    'block overflow-hidden rounded-xs px-1.5 py-px text-xs leading-5 text-ellipsis whitespace-nowrap',
    ev.all_day
      ? 'bg-(--cal) text-white dark:bg-[color-mix(in_srgb,var(--cal)_70%,#000)]'
      : 'border-l-3 border-(--cal) bg-[color-mix(in_srgb,var(--cal)_14%,var(--app-surface))] text-fg dark:bg-[color-mix(in_srgb,var(--cal)_24%,var(--app-surface))]',
    ev.busy && 'italic',
  )
}

export default function PublicCalendar() {
  const { id = '' } = useParams()
  const [params, setParams] = useSearchParams()
  const loc = useLocation()
  const qc = useQueryClient()
  const phone = useMediaQuery('(max-width: 640px)')
  const monthParam = params.get('month')
  const month = useMemo(() => parseMonth(monthParam), [monthParam])
  const weeks = useMemo(() => monthGrid(month, 0), [month])
  const first = weeks[0][0]
  const last = weeks[5][6]
  const today = new Date()

  const cal = useQuery({
    queryKey: ['public', 'calendar', id],
    queryFn: ({ signal }) => get<PublicCal>(`calendar/public/calendars/${encodeURIComponent(id)}`, undefined, signal),
    staleTime: 10 * 60_000,
    retry: (n, e) => !(e instanceof ApiError && e.status === 404) && n < 3,
  })
  const events = useQuery({
    queryKey: ['public', 'calendar', id, 'events', dayKey(first)],
    queryFn: ({ signal }) =>
      get<PublicEvent[]>(
        `calendar/public/calendars/${encodeURIComponent(id)}/events`,
        { start: first.toISOString(), end: addDays(last, 1).toISOString() },
        signal,
      ),
    enabled: cal.isSuccess,
    staleTime: 5 * 60_000,
    placeholderData: (prev) => prev,
  })
  usePublicTitle(cal.data?.name ?? 'Public calendar')

  const byDay = useMemo(() => {
    const map = new Map<string, Placed[]>()
    const placed = (events.data ?? [])
      .map((e) => ({ ...e, s: new Date(e.start), e: new Date(e.end ?? e.start) }))
      .sort((a, b) => Number(b.all_day) - Number(a.all_day) || a.s.getTime() - b.s.getTime())
    for (const ev of placed) for (const k of daysOf(ev, first, last)) map.set(k, [...(map.get(k) ?? []), ev])
    return map
  }, [events.data, first, last])

  const subscribe = useMutation({
    mutationFn: () => post(`calendar/public/calendars/${encodeURIComponent(id)}/subscribe`),
    onSuccess: () => {
      qc.setQueryData<PublicCal>(['public', 'calendar', id], (c) => (c ? { ...c, subscribed: true } : c))
      toast.show('Subscribed: it now shows in your Calendar.')
    },
  })

  const go = (d: Date) =>
    setParams(
      (p) => {
        const x = new URLSearchParams(p)
        if (monthKey(d) === monthKey(today)) x.delete('month')
        else x.set('month', monthKey(d))
        return x
      },
      { replace: true },
    )

  if (cal.isPending)
    return (
      <PublicFrame wide>
        <div className={cardClass}>
          <SkeletonRows rows={6} />
        </div>
      </PublicFrame>
    )
  if (!cal.data) {
    return (
      <PublicFrame>
        {cal.error instanceof ApiError && cal.error.status === 404 ? (
          <PublicNotice icon="calendar" title="This calendar isn't public">
            <p className="text-sm text-muted">It doesn't exist, or its owner hasn't shared it with a link.</p>
          </PublicNotice>
        ) : (
          <div className={cardClass}>
            <ErrorBox error={cal.error} retry={() => cal.refetch()} />
          </div>
        )}
      </PublicFrame>
    )
  }
  const c = cal.data
  const colour = /^#[0-9a-f]{6}$/i.test(c.colour) ? c.colour : '#0891b2'
  const calVar = { '--cal': colour } as CSSProperties
  const chipLabel = (ev: Placed) => (ev.all_day ? ev.name : `${fmtTime(ev.s)} ${ev.name}`)
  const tip = (ev: Placed) => [ev.name, ev.location].filter(Boolean).join(' — ')
  const inMonth = (d: Date) => d.getMonth() === month.getMonth()
  const actionClass = 'hover:no-underline max-[640px]:w-full'

  let action = null
  if (c.subscribed === null || !signedIn()) {
    action = (
      <Link className={buttonClass({ className: actionClass })} to={loginUrl(loc)}>
        <Icon name="plus" size={14} />
        Sign in to subscribe
      </Link>
    )
  } else if (c.subscribed) {
    action = (
      <a className={buttonClass({ className: actionClass })} href="/calendar">
        <Icon name="check" size={14} />
        Subscribed · Open Calendar
      </a>
    )
  } else {
    action = (
      <Button variant="primary" className={actionClass} disabled={subscribe.isPending} onClick={() => subscribe.mutate()}>
        <Icon name="plus" size={14} />
        {subscribe.isPending ? 'Subscribing…' : 'Subscribe'}
      </Button>
    )
  }
  const monthDays = weeks
    .flat()
    .filter(inMonth)
    .filter((d) => byDay.has(dayKey(d)))

  return (
    <PublicFrame wide>
      <header className="flex items-start gap-3.5 max-[640px]:flex-wrap" style={calVar}>
        <span className="mt-2 size-3.5 shrink-0 rounded-xs bg-(--cal)" aria-hidden="true" />
        <div className="grid min-w-0 flex-1 gap-0.5">
          <h1 className="truncate text-xl font-semibold tracking-[-0.015em]">{c.name}</h1>
          <p className="text-sm text-muted">{['Public calendar', c.owner && `by ${c.owner}`, c.time_zone].filter(Boolean).join(' · ')}</p>
          {c.description && <p className="mt-1 text-sm whitespace-pre-line wrap-anywhere">{c.description}</p>}
        </div>
        <div className="shrink-0 max-[640px]:w-full">{action}</div>
      </header>

      <div className="flex items-center gap-2">
        <Button onClick={() => go(new Date())}>Today</Button>
        <span className="inline-flex">
          <Button variant="ghost" icon onClick={() => go(addMonths(month, -1))} aria-label="Previous month" title="Previous month">
            <Icon name="chevronLeft" />
          </Button>
          <Button variant="ghost" icon onClick={() => go(addMonths(month, 1))} aria-label="Next month" title="Next month">
            <Icon name="chevronRight" />
          </Button>
        </span>
        <h2 className="text-lg font-medium" aria-live="polite">
          {monthTitle.format(month)}
        </h2>
        {events.isFetching && <span className="spinner" role="status" aria-label="Loading" />}
      </div>
      {events.isError && (
        <div className={cardClass}>
          <ErrorBox error={events.error} retry={() => events.refetch()} />
        </div>
      )}

      {phone ? (
        <section className={cn(cardClass, 'py-1')} style={calVar} aria-label={`Events in ${monthTitle.format(month)}`}>
          {monthDays.map((d, i) => {
            const isToday = isSameDay(d, today)
            return (
              <div
                key={dayKey(d)}
                className={cn('grid grid-cols-[5.5rem_minmax(0,1fr)] gap-2 px-3.5 py-2', i > 0 && 'border-t border-border')}
              >
                <span className={cn('pt-px text-sm tabular-nums', isToday && 'font-semibold text-accent')}>{agendaDay.format(d)}</span>
                <ul className="grid gap-1.5">
                  {byDay.get(dayKey(d))?.map((ev) => (
                    <li key={ev.id + dayKey(d)} title={tip(ev)} className="flex min-w-0 items-start gap-2 text-sm">
                      <span className="mt-1.5 size-2 shrink-0 rounded-full bg-(--cal)" aria-hidden="true" />
                      <span className="w-16 shrink-0 pt-0.5 text-xs text-muted tabular-nums">{ev.all_day ? 'All day' : fmtTime(ev.s)}</span>
                      <span className="grid min-w-0 flex-1 wrap-anywhere">
                        <span className={ev.busy ? 'text-muted' : ''}>{ev.name}</span>
                        {ev.location && <span className="text-xs text-muted">{ev.location}</span>}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )
          })}
          {!events.isPending && ![...byDay.keys()].some((k) => k.startsWith(monthKey(month))) && (
            <p className="p-4 text-center text-sm text-muted">Nothing this month.</p>
          )}
          {events.isPending && <SkeletonRows rows={4} />}
        </section>
      ) : (
        <section className={cn(cardClass, 'overflow-hidden')} style={calVar} aria-label={monthTitle.format(month)}>
          <div className="grid grid-cols-7" aria-hidden="true">
            {weeks[0].map((d) => (
              <span
                key={d.getDay()}
                className="border-b border-border px-2 py-1.5 text-xs font-medium tracking-[0.04em] text-muted uppercase"
              >
                {weekday.format(d)}
              </span>
            ))}
          </div>
          {weeks.map((week, w) => (
            <div key={dayKey(week[0])} className="grid grid-cols-7">
              {week.map((d, i) => {
                const list = byDay.get(dayKey(d)) ?? []
                const out = !inMonth(d)
                return (
                  <div
                    key={dayKey(d)}
                    className={cn(
                      'flex min-h-28 min-w-0 flex-col gap-0.5 px-1 pt-1 pb-1.5',
                      w < weeks.length - 1 && 'border-b border-border',
                      i < 6 && 'border-r border-border',
                      out && 'bg-[color-mix(in_srgb,var(--app-surface-2)_55%,transparent)]',
                    )}
                  >
                    <span
                      className={cn(
                        'inline-grid h-6 min-w-6 place-items-center self-start rounded-full px-1 text-xs font-medium tabular-nums',
                        isSameDay(d, today) ? 'bg-accent text-accent-fg' : out && 'text-muted',
                      )}
                    >
                      {d.getDate()}
                    </span>
                    {list.slice(0, list.length > MAX_CHIPS ? MAX_CHIPS - 1 : MAX_CHIPS).map((ev) => (
                      <span key={ev.id} className={chipClass(ev)} title={tip(ev)}>
                        {chipLabel(ev)}
                      </span>
                    ))}
                    {list.length > MAX_CHIPS && (
                      <span
                        className="cursor-default px-1.5 text-xs text-muted"
                        title={list
                          .slice(MAX_CHIPS - 1)
                          .map(tip)
                          .join('\n')}
                      >
                        +{list.length - MAX_CHIPS + 1} more
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          ))}
        </section>
      )}
    </PublicFrame>
  )
}
