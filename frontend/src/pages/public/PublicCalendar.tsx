// /calendar/public/:id: a public calendar's month, for anyone with the link. One request for the
// calendar and one per visible 6-week grid. Private events arrive as "Busy" (masked by the server).
import { useMemo, type CSSProperties } from 'react'
import { Link, useLocation, useParams, useSearchParams } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError, get, post } from '../../lib/api'
import { signedIn } from '../../lib/session'
import { addDays, addMonths, dateFormatter, dayKey, fmtTime, isSameDay, monthGrid, startOfDay } from '../../lib/dates'
import { Icon } from '../../components/Icon'
import { ErrorBox, SkeletonRows, useMediaQuery } from '../../components/ui'
import { toast } from '../../components/toast'
import { PublicFrame, PublicNotice, loginHere, usePublicTitle } from './PublicFrame'

interface PublicCal { id: number; name: string; colour: string; description: string; owner: string; time_zone: string; subscribed: boolean | null }
interface PublicEvent { id: string; name: string; start: string; end: string | null; all_day: boolean; location: string | null; busy: boolean }
interface Placed extends PublicEvent { s: Date; e: Date }

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

export default function PublicCalendar() {
  const { id = '' } = useParams()
  const [params, setParams] = useSearchParams()
  const loc = useLocation()
  const qc = useQueryClient()
  const phone = useMediaQuery('(max-width: 640px)')
  const month = parseMonth(params.get('month'))
  const weeks = useMemo(() => monthGrid(month, 0), [month.getTime()])  // eslint-disable-line react-hooks/exhaustive-deps
  const first = weeks[0][0]
  const last = weeks[5][6]
  const today = new Date()

  const cal = useQuery({
    queryKey: ['public', 'calendar', id],
    queryFn: () => get<PublicCal>(`calendar/public/calendars/${encodeURIComponent(id)}`),
    staleTime: 10 * 60_000,
    retry: (n, e) => !(e instanceof ApiError && e.status === 404) && n < 3,
  })
  const events = useQuery({
    queryKey: ['public', 'calendar', id, 'events', dayKey(first)],
    queryFn: ({ signal }) => get<PublicEvent[]>(`calendar/public/calendars/${encodeURIComponent(id)}/events`,
      { start: first.toISOString(), end: addDays(last, 1).toISOString() }, signal),
    enabled: cal.isSuccess,
    staleTime: 5 * 60_000,
    placeholderData: (prev) => prev,
  })
  usePublicTitle(cal.data?.name ?? 'Public calendar')

  const byDay = useMemo(() => {
    const map = new Map<string, Placed[]>()
    const placed = (events.data ?? []).map((e) => ({ ...e, s: new Date(e.start), e: new Date(e.end ?? e.start) }))
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
    onError: (e) => toast.error((e as Error).message),
  })

  const go = (d: Date) => setParams((p) => {
    const x = new URLSearchParams(p)
    if (monthKey(d) === monthKey(today)) x.delete('month')
    else x.set('month', monthKey(d))
    return x
  }, { replace: true })

  if (cal.isPending) return <PublicFrame wide><div className="card"><SkeletonRows rows={6} /></div></PublicFrame>
  if (!cal.data) {
    return (
      <PublicFrame>
        {cal.error instanceof ApiError && cal.error.status === 404
          ? <PublicNotice icon="calendar" title="This calendar isn't public"><p className="muted small">It doesn't exist, or its owner hasn't shared it with a link.</p></PublicNotice>
          : <div className="card"><ErrorBox error={cal.error} retry={() => cal.refetch()} /></div>}
      </PublicFrame>
    )
  }
  const c = cal.data
  const colour = /^#[0-9a-f]{6}$/i.test(c.colour) ? c.colour : '#0891b2'
  const chipLabel = (ev: Placed) => (ev.all_day ? ev.name : `${fmtTime(ev.s)} ${ev.name}`)
  const tip = (ev: Placed) => [ev.name, ev.location].filter(Boolean).join(' — ')
  const inMonth = (d: Date) => d.getMonth() === month.getMonth()

  let action = null
  if (c.subscribed === null || !signedIn()) {
    action = <Link className="btn" to={loginHere(loc)}><Icon name="plus" size={14} />Sign in to subscribe</Link>
  } else if (c.subscribed) {
    action = <a className="btn" href="/calendar"><Icon name="check" size={14} />Subscribed · Open Calendar</a>
  } else {
    action = <button className="btn primary" disabled={subscribe.isPending} onClick={() => subscribe.mutate()}><Icon name="plus" size={14} />{subscribe.isPending ? 'Subscribing…' : 'Subscribe'}</button>
  }

  return (
    <PublicFrame wide>
      <header className="pc-head" style={{ '--cal': colour } as CSSProperties}>
        <span className="pc-swatch" aria-hidden="true" />
        <div className="pc-info">
          <h1 className="truncate">{c.name}</h1>
          <p className="muted small">{['Public calendar', c.owner && `by ${c.owner}`, c.time_zone].filter(Boolean).join(' · ')}</p>
          {c.description && <p className="pc-desc small">{c.description}</p>}
        </div>
        <div className="pc-action">{action}</div>
      </header>

      <div className="pc-toolbar">
        <button className="btn" onClick={() => go(new Date())}>Today</button>
        <span className="pc-nav">
          <button className="btn ghost icon" onClick={() => go(addMonths(month, -1))} aria-label="Previous month" title="Previous month"><Icon name="chevronLeft" /></button>
          <button className="btn ghost icon" onClick={() => go(addMonths(month, 1))} aria-label="Next month" title="Next month"><Icon name="chevronRight" /></button>
        </span>
        <h2 className="pc-title" aria-live="polite">{monthTitle.format(month)}</h2>
        {events.isFetching && <span className="spinner" aria-label="Loading" />}
      </div>
      {events.isError && <div className="card pc-err"><ErrorBox error={events.error} retry={() => events.refetch()} /></div>}

      {phone ? (
        <section className="card pc-agenda" style={{ '--cal': colour } as CSSProperties} aria-label={`Events in ${monthTitle.format(month)}`}>
          {weeks.flat().filter(inMonth).filter((d) => byDay.has(dayKey(d))).map((d) => (
            <div key={dayKey(d)} className={'pc-aday' + (isSameDay(d, today) ? ' today' : '')}>
              <span className="pc-adate tabular">{agendaDay.format(d)}</span>
              <ul>
                {byDay.get(dayKey(d))!.map((ev) => (
                  <li key={ev.id + dayKey(d)} title={tip(ev)}>
                    <span className="pc-dot" aria-hidden="true" />
                    <span className="pc-atime tabular muted">{ev.all_day ? 'All day' : fmtTime(ev.s)}</span>
                    <span className="grow"><span className={ev.busy ? 'muted' : ''}>{ev.name}</span>{ev.location && <span className="xsmall muted pc-aloc">{ev.location}</span>}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {!events.isPending && ![...byDay.keys()].some((k) => k.startsWith(monthKey(month))) && <p className="empty">Nothing this month.</p>}
          {events.isPending && <SkeletonRows rows={4} />}
        </section>
      ) : (
        <section className="card pc-grid" style={{ '--cal': colour } as CSSProperties} aria-label={monthTitle.format(month)}>
          <div className="pc-weekdays" aria-hidden="true">{weeks[0].map((d) => <span key={d.getDay()}>{weekday.format(d)}</span>)}</div>
          {weeks.map((week) => (
            <div key={dayKey(week[0])} className="pc-week">
              {week.map((d) => {
                const list = byDay.get(dayKey(d)) ?? []
                return (
                  <div key={dayKey(d)} className={'pc-day' + (inMonth(d) ? '' : ' out') + (isSameDay(d, today) ? ' today' : '')}>
                    <span className="pc-daynum tabular">{d.getDate()}</span>
                    {list.slice(0, list.length > MAX_CHIPS ? MAX_CHIPS - 1 : MAX_CHIPS).map((ev) => (
                      <span key={ev.id} className={'pc-chip' + (ev.all_day ? ' allday' : '') + (ev.busy ? ' busy' : '')} title={tip(ev)}>{chipLabel(ev)}</span>
                    ))}
                    {list.length > MAX_CHIPS && <span className="pc-more xsmall muted" title={list.slice(MAX_CHIPS - 1).map(tip).join('\n')}>+{list.length - MAX_CHIPS + 1} more</span>}
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
