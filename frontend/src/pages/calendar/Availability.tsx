// Someone else's availability (/calendar/availability/:username?date=): a week of busy blocks from
// GET /calendar/availability/{username}?date= (one request per day, cached). Only calendars that
// person shares as busy count, and only times are shown, never event names.
import { useLayoutEffect, useMemo, useRef } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import { useQueries, useQuery } from '@tanstack/react-query'
import { AppShell } from '../../components/AppShell'
import { Icon } from '../../components/Icon'
import { Avatar, ErrorBox, useMediaQuery, useNow } from '../../components/ui'
import { ApiError, get } from '../../lib/api'
import { addDays, dayKey, fmtDate, fmtTime, isSameDay, parseDayKey, startOfDay } from '../../lib/dates'
import { rangeTitle, stepDate, viewRange } from './util'
import './calendar.css'

interface Busy { start: string; end: string }
interface Avail { username: string; name?: string; date: string; busy: Busy[] }
interface Profile { id: string; username: string; name: string; profile_picture: string; description: string }

const hourFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric' })
const HOURS = Array.from({ length: 24 }, (_, h) => h)

/** bare: signed out (PublicAvailability.tsx): no app chrome, and no profile request (that needs sign-in). */
export default function AvailabilityPage({ bare = false }: { bare?: boolean }) {
  const { username = '' } = useParams()
  const [params, setParams] = useSearchParams()
  const phone = useMediaQuery('(max-width: 760px)')
  const n = phone ? 3 : 7
  const raw = params.get('date')
  const date = raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? parseDayKey(raw) : startOfDay(new Date())
  const setDate = (d: Date) => setParams((p) => { const x = new URLSearchParams(p); if (isSameDay(d, new Date())) x.delete('date'); else x.set('date', dayKey(d)); return x }, { replace: true })
  const { days } = viewRange('week', date, n)
  const now = useNow(60_000)

  const profile = useQuery({ queryKey: ['users', username], queryFn: () => get<Profile>(`users/${encodeURIComponent(username)}`), staleTime: 10 * 60_000, retry: false, enabled: !bare })
  const results = useQueries({
    queries: days.map((d) => ({
      queryKey: ['calendar', 'availability', username, dayKey(d)],
      queryFn: ({ signal }: { signal: AbortSignal }) => get<Avail>(`calendar/availability/${encodeURIComponent(username)}`, { date: dayKey(d) }, signal),
      staleTime: 2 * 60_000,
      enabled: bare || profile.isSuccess,
      retry: (n: number, e: unknown) => !(e instanceof ApiError && e.status === 404) && n < 2,
    })),
  })
  const loading = results.some((r) => r.isFetching)
  const failed = results.find((r) => r.error)?.error
  // The server cuts days in the other person's time zone: merge everything, then clip to my local days.
  const busy = useMemo(() => {
    const seen = new Map<string, Busy>()
    for (const r of results) for (const b of r.data?.busy ?? []) seen.set(b.start + b.end, b)
    const list = [...seen.values()].map((b) => ({ s: new Date(b.start).getTime(), e: new Date(b.end).getTime() })).sort((a, b) => a.s - b.s)
    // Overlapping busy times read as one block (who cares which event it was: they're busy).
    const merged: { s: number; e: number }[] = []
    for (const b of list) {
      const last = merged[merged.length - 1]
      if (last && b.s <= last.e) last.e = Math.max(last.e, b.e)
      else merged.push({ ...b })
    }
    return merged
  }, [results.map((r) => r.dataUpdatedAt).join()])
  const perDay = days.map((d) => {
    const d0 = startOfDay(d).getTime()
    const d1 = addDays(startOfDay(d), 1).getTime()
    return busy.filter((b) => b.s < d1 && b.e > d0).map((b) => ({ ...b, a: Math.max(0, (b.s - d0) / 60000), z: Math.min(1440, (b.e - d0) / 60000) }))
  })

  const scroller = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const el = scroller.current
    if (el) el.scrollTop = (el.scrollHeight / 24) * 7.5
  }, [username])

  const name = profile.data?.name || results.find((r) => r.data?.name)?.data?.name || username
  const missing = bare ? results.find((r) => r.error instanceof ApiError && r.error.status === 404)?.error : profile.error
  const title = rangeTitle('week', date, n)
  const nav = (
    <>
      <button className="btn cal-today" onClick={() => setDate(startOfDay(new Date()))}>Today</button>
      <span className="cal-nav">
        <button className="btn ghost icon" onClick={() => setDate(stepDate('week', date, -1, n))} aria-label="Previous" title="Previous"><Icon name="chevronLeft" /></button>
        <button className="btn ghost icon" onClick={() => setDate(stepDate('week', date, 1, n))} aria-label="Next" title="Next"><Icon name="chevronRight" /></button>
      </span>
      <h1 className="cal-title" aria-live="polite">{title}</h1>
      <input className="input avail-date" type="date" value={dayKey(date)} onChange={(e) => e.target.value && setDate(parseDayKey(e.target.value))} aria-label="Go to date" />
    </>
  )
  const body = (
      <div className={'cal avail' + (bare ? ' avail-bare' : '')}>
        <div className="avail-head">
          <Avatar name={name} src={profile.data?.profile_picture} size={2.25} />
          <div className="grow" style={{ minWidth: 0 }}>
            <h2 className="truncate">{name}<span className="muted small"> @{username}</span></h2>
            <p className="muted xsmall">Busy times only, from the calendars {profile.data ? `${name.split(' ')[0]} shares` : 'they share'} as busy. Free time is blank.</p>
          </div>
        </div>
        {(phone || bare) && <div className="cal-subbar"><div className="row">{nav}{bare && loading && <span className="spinner" aria-label="Loading" />}</div></div>}
        {missing ? (
          <div className="agenda"><ErrorBox error={missing instanceof ApiError && missing.status === 404 ? new Error(`No one has the username "${username}".`) : missing} /></div>
        ) : (
          <>
            {failed && <div style={{ padding: '0.5rem 1rem' }}><ErrorBox error={failed} retry={() => results.forEach((r) => r.refetch())} /></div>}
            <div className="week" style={{ '--cols': days.length } as React.CSSProperties}>
              <div className="week-head">
                <div className="gutter" aria-hidden="true" />
                {days.map((d) => (
                  <div key={d.getTime()} className="week-day-wrap">
                    <button type="button" className={'week-day' + (isSameDay(d, now) ? ' today' : '')} onClick={() => setDate(d)} aria-label={fmtDate(d, { weekday: 'long', month: 'long', day: 'numeric' })}>
                      <span className="wd">{fmtDate(d, { weekday: 'short' })}</span>
                      <span className="dn tabular">{d.getDate()}</span>
                    </button>
                  </div>
                ))}
              </div>
              <div className="week-scroll" ref={scroller}>
                <div className="week-body">
                  <div className="gutter hours" aria-hidden="true">
                    {HOURS.map((h) => <span key={h} style={{ top: `${(h / 24) * 100}%` }}>{h === 0 ? '' : hourFmt.format(new Date(2000, 0, 1, h))}</span>)}
                  </div>
                  {days.map((d, i) => (
                    <div key={d.getTime()} className="day-col avail-col" role="list" aria-label={`${fmtDate(d, { weekday: 'long', month: 'long', day: 'numeric' })}: ${perDay[i].length ? `${perDay[i].length} busy` : 'free'}`}>
                      {perDay[i].map((b) => {
                        const label = `Busy ${fmtTime(new Date(b.s))} – ${fmtTime(new Date(b.e))}`
                        return (
                          <div key={b.s + '-' + b.e} role="listitem" className={'avail-busy' + (b.z - b.a < 45 ? ' short' : '')} style={{ top: `${(b.a / 1440) * 100}%`, height: `calc(${((b.z - b.a) / 1440) * 100}% - 2px)` }} title={label} aria-label={label}>
                            <strong>Busy</strong><span className="tabular">{fmtTime(new Date(b.s))} – {fmtTime(new Date(b.e))}</span>
                          </div>
                        )
                      })}
                      {isSameDay(d, now) && <div className="now-line" style={{ top: `${((now.getHours() * 60 + now.getMinutes()) / 1440) * 100}%` }} aria-hidden="true" />}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
  )
  if (bare) return body
  return (
    <AppShell app="calendar" pageTitle={`${name}: availability`} fullHeight topbar={
      <>
        <Link to="/calendar" className="btn ghost sm"><Icon name="chevronLeft" size={14} />Calendar</Link>
        {!phone && nav}
        <span className="spacer" />
        {loading && <span className="spinner" aria-label="Loading" />}
      </>
    }>
      {body}
    </AppShell>
  )
}
