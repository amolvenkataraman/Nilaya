// Someone else's availability (/calendar/availability/:username?date=): a week of busy blocks from
// GET /calendar/availability/{username}?date= (one request per day, cached). Only calendars that
// person shares as busy count, and only times are shown, never event names. Time outside their working
// hours and days (their Settings › Preferences) is shaded, as on their own calendar.
import { useLayoutEffect, useRef } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import { useQueries, useQuery, type UseQueryResult } from '@tanstack/react-query'
import { AppShell } from '../../components/AppShell'
import { Icon } from '../../components/Icon'
import { Avatar, Button, buttonClass, ErrorBox, fieldClass, useIsPhone, useNow } from '../../components/ui'
import { ApiError } from '../../lib/api'
import { cn } from '../../lib/cn'
import { addDays, dayKey, fmtDate, fmtTime, isSameDay, parseDayKey, startOfDay } from '../../lib/dates'
import { availabilityQuery, userQuery, type Availability, type Busy } from './api'
import { DAY_MIN, pct } from './layout'
import { rangeTitle, stepDate, viewRange } from './range'
import { DayHeader, dayColumn, NowLine, OffHours, TimeGrid } from './TimeGrid'
import { offSpans } from './workHours'

type Span = { s: number; e: number }

/** Spans as one sorted list, overlaps merged. */
function merge(spans: Busy[]) {
  const list = spans.map((b) => ({ s: new Date(b.start).getTime(), e: new Date(b.end).getTime() })).sort((a, b) => a.s - b.s)
  const merged: Span[] = []
  for (const b of list) {
    const last = merged.at(-1)
    if (last && b.s <= last.e) last.e = Math.max(last.e, b.e)
    else merged.push({ ...b })
  }
  return merged
}

/** Every day's busy times (whichever event it was, they're busy) and working hours, each as one list; working is
 *  null until a day says they publish their hours. */
function mergeBusy(results: UseQueryResult<Availability>[]) {
  const shared = results.some((r) => r.data?.working)
  return {
    busy: merge(results.flatMap((r) => r.data?.busy ?? [])),
    working: shared ? merge(results.flatMap((r) => r.data?.working ?? [])) : null,
    name: results.find((r) => r.data?.name)?.data?.name,
    loading: results.some((r) => r.isFetching),
    failed: results.find((r) => r.error)?.error,
    missing: results.find((r) => r.error instanceof ApiError && r.error.status === 404)?.error,
    refetch: () => {
      for (const r of results) r.refetch()
    },
  }
}

/** bare: signed out (PublicAvailability.tsx): no app chrome, and no profile request (that needs sign-in). */
export default function AvailabilityPage({ bare = false }: { bare?: boolean }) {
  const { username = '' } = useParams()
  const [params, setParams] = useSearchParams()
  const phone = useIsPhone()
  const n = phone ? 3 : 7
  const raw = params.get('date')
  const date = raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? parseDayKey(raw) : startOfDay(new Date())
  const setDate = (d: Date) =>
    setParams(
      (p) => {
        const x = new URLSearchParams(p)
        if (isSameDay(d, new Date())) x.delete('date')
        else x.set('date', dayKey(d))
        return x
      },
      { replace: true },
    )
  const { days } = viewRange('week', date, n)
  const now = useNow(60_000)

  const profile = useQuery({ ...userQuery(username), enabled: !bare })
  // The server cuts days in the other person's time zone: merge everything, then clip to my local days.
  const avail = useQueries({
    queries: days.map((d) => availabilityQuery(username, dayKey(d), bare || profile.isSuccess)),
    combine: mergeBusy,
  })
  const inDay = (d: Date, spans: Span[]) => {
    const d0 = startOfDay(d).getTime()
    const d1 = addDays(startOfDay(d), 1).getTime()
    return spans
      .filter((b) => b.s < d1 && b.e > d0)
      .map((b) => ({ ...b, a: Math.max(0, (b.s - d0) / 60000), z: Math.min(DAY_MIN, (b.e - d0) / 60000) }))
  }
  const perDay = days.map((d) => inDay(d, avail.busy))
  const workDay = avail.working ? days.map((d) => inDay(d, avail.working ?? [])) : null
  const offDay = days.map((_, i) => (workDay ? offSpans(workDay[i].map((w) => [w.a, w.z] as const)) : []))
  const workFrom = Math.min(...(workDay ?? []).flatMap((w) => w.map((x) => x.a)))

  const scroller = useRef<HTMLDivElement>(null)
  const scrolledFor = useRef<string | null>(null)
  // Open at 7:30, then at the start of their working hours once those arrive: once per person, not per week.
  useLayoutEffect(() => {
    const el = scroller.current
    if (!el || scrolledFor.current === username) return
    const ready = Number.isFinite(workFrom)
    el.scrollTop = (el.scrollHeight / DAY_MIN) * (ready ? Math.max(0, workFrom - 30) : 450)
    if (ready) scrolledFor.current = username
  }, [username, workFrom])

  const name = profile.data?.name || avail.name || username
  const missing = bare ? avail.missing : profile.error
  const nav = (
    <>
      <Button onClick={() => setDate(startOfDay(new Date()))}>Today</Button>
      <span className="inline-flex">
        <Button variant="ghost" icon onClick={() => setDate(stepDate('week', date, -1, n))} aria-label="Previous" title="Previous">
          <Icon name="chevronLeft" />
        </Button>
        <Button variant="ghost" icon onClick={() => setDate(stepDate('week', date, 1, n))} aria-label="Next" title="Next">
          <Icon name="chevronRight" />
        </Button>
      </span>
      <h1 className={cn('ml-1 min-w-0 truncate text-md font-semibold tracking-[-0.01em]', phone && !bare && 'hidden')} aria-live="polite">
        {rangeTitle('week', date, n)}
      </h1>
      <input
        className={fieldClass.input({ width: 'content', className: cn((phone || bare) && 'ml-auto') })}
        type="date"
        value={dayKey(date)}
        onChange={(e) => e.target.value && setDate(parseDayKey(e.target.value))}
        aria-label="Go to date"
      />
    </>
  )
  const body = (
    <div
      className={cn(
        'relative flex min-h-0 flex-col bg-surface',
        bare ? 'h-[min(78vh,52rem)] overflow-hidden rounded-md border border-border' : 'h-full',
      )}
    >
      <div className="flex items-center gap-3 border-b border-border px-4 py-3 max-md:px-3 max-md:py-2">
        <Avatar name={name} src={profile.data?.profile_picture} size={2.25} />
        <div className="min-w-0 flex-auto">
          <h2 className="truncate text-md">
            {name}
            <span className="text-sm text-muted"> @{username}</span>
          </h2>
          <p className="text-xs text-muted">
            Busy times only, from the calendars {profile.data ? `${name.split(' ')[0]} shares` : 'they share'} as busy. Free time is blank
            {avail.working ? '; shaded time is outside their working hours.' : '.'}
          </p>
        </div>
      </div>
      {(phone || bare) && (
        <div className="grid gap-1.5 border-b border-border px-2 pt-1.5 pb-2">
          <div className={cn('flex items-center gap-1', bare && 'flex-wrap gap-y-1.5')}>
            {nav}
            {bare && avail.loading && <output className="spinner" aria-label="Loading" />}
          </div>
        </div>
      )}
      {missing ? (
        <div className="mx-auto w-full max-w-208 px-4 pt-3 pb-8">
          <ErrorBox
            error={missing instanceof ApiError && missing.status === 404 ? new Error(`No one has the username "${username}".`) : missing}
          />
        </div>
      ) : (
        <>
          {avail.failed && (
            <div className="px-4 py-2">
              <ErrorBox error={avail.failed} retry={avail.refetch} />
            </div>
          )}
          <TimeGrid
            days={days}
            scrollRef={scroller}
            head={(d) => <DayHeader day={d} today={isSameDay(d, now)} onClick={() => setDate(d)} />}
          >
            {days.map((d, i) => (
              <ul
                key={d.getTime()}
                className={dayColumn(false)}
                aria-label={`${fmtDate(d, { weekday: 'long', month: 'long', day: 'numeric' })}: ${perDay[i].length ? `${perDay[i].length} busy` : 'free'}`}
              >
                <OffHours spans={offDay[i]} as="li" />
                {perDay[i].map((b) => {
                  const label = `Busy ${fmtTime(new Date(b.s))} – ${fmtTime(new Date(b.e))}`
                  const short = b.z - b.a < 45
                  return (
                    <li
                      key={`${b.s}-${b.e}`}
                      className={cn(
                        'absolute right-1 left-0.5 z-1 flex overflow-hidden rounded-[5px] px-1.5 text-xs leading-tight text-fg',
                        'bg-[repeating-linear-gradient(135deg,color-mix(in_srgb,var(--app-accent)_16%,var(--app-surface))_0_6px,color-mix(in_srgb,var(--app-accent)_24%,var(--app-surface))_6px_12px)]',
                        'shadow-[inset_3px_0_0_var(--app-accent)]',
                        short ? 'flex-row items-center gap-1.5' : 'flex-col gap-px py-0.75',
                      )}
                      style={{ top: pct(b.a), height: `calc(${pct(b.z - b.a)} - 2px)` }}
                      title={label}
                      aria-label={label}
                    >
                      <strong>Busy</strong>
                      <span className="text-muted tabular-nums">
                        {fmtTime(new Date(b.s))} – {fmtTime(new Date(b.e))}
                      </span>
                    </li>
                  )
                })}
                {isSameDay(d, now) && <NowLine min={now.getHours() * 60 + now.getMinutes()} />}
              </ul>
            ))}
          </TimeGrid>
        </>
      )}
    </div>
  )
  if (bare) return body
  return (
    <AppShell
      app="calendar"
      pageTitle={`${name}: availability`}
      fullHeight
      topbar={
        <>
          <Link to="/calendar" className={buttonClass({ variant: 'ghost', size: 'sm' })}>
            <Icon name="chevronLeft" size={14} />
            Calendar
          </Link>
          {!phone && nav}
          <span className="flex-1" />
          {avail.loading && <output className="spinner" aria-label="Loading" />}
        </>
      }
    >
      {body}
    </AppShell>
  )
}
