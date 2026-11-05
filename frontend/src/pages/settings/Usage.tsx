// Staff usage dashboard from GET /analytics/summary: page views and API calls per person, app and day.
import { useMemo, useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Columns, HBars } from '../../components/charts'
import { ErrorBox, SkeletonRows, useMediaQuery } from '../../components/ui'
import { get } from '../../lib/api'
import { addDays, dayKey, fmtDate, parseDayKey, startOfDay } from '../../lib/dates'

interface Totals { views: number | null; calls: number | null }
interface Summary {
  days: number
  per_day: (Totals & { day: string; people: number })[]
  apps: (Totals & { app: string; people: number })[]
  people: (Totals & { user: string; name: string; active_days: number })[]
  matrix: (Totals & { user__username: string; app: string })[]
}

const PERIODS = [
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
  { days: 365, label: 'Year' },
]
const n = (v: number | null | undefined) => v ?? 0
const fmt = (v: number) => v.toLocaleString()

/** Daily columns up to a month; weekly beyond (one column per 7 days, newest on the right). */
function series(d: Summary, maxLabels: number) {
  const byDay = new Map(d.per_day.map((r) => [r.day, n(r.views)]))
  const today = startOfDay(new Date())
  const daily = Array.from({ length: d.days }, (_, i) => dayKey(addDays(today, i - d.days + 1)))
  if (d.days <= 31) {
    const every = Math.ceil(d.days / maxLabels)
    return {
      values: daily.map((k) => byDay.get(k) ?? 0),
      labels: daily.map((k, i) => ((d.days - 1 - i) % every === 0 ? fmtDate(parseDayKey(k), d.days <= 7 ? { weekday: 'short' } : { month: 'short', day: 'numeric' }) : '')),
      unit: 'day',
    }
  }
  const weeks: { start: string; v: number }[] = []
  for (let end = daily.length; end > 0; end -= 7) {
    const chunk = daily.slice(Math.max(0, end - 7), end)
    weeks.unshift({ start: chunk[0], v: chunk.reduce((a, k) => a + (byDay.get(k) ?? 0), 0) })
  }
  const every = Math.ceil(weeks.length / Math.max(2, maxLabels - 2))
  return {
    values: weeks.map((w) => w.v),
    labels: weeks.map((w, i) => ((weeks.length - 1 - i) % every === 0 ? fmtDate(parseDayKey(w.start), { month: 'short', day: 'numeric' }) : '')),
    unit: 'week',
  }
}

export function UsagePage() {
  const [days, setDays] = useState(30)
  const q = useQuery({
    queryKey: ['settings', 'usage', days],
    queryFn: ({ signal }) => get<Summary>('analytics/summary', { days }, signal),
    placeholderData: keepPreviousData,
    staleTime: 5 * 60_000,
  })
  const d = q.data
  const totals = useMemo(() => {
    if (!d) return null
    return { views: d.apps.reduce((a, x) => a + n(x.views), 0), calls: d.apps.reduce((a, x) => a + n(x.calls), 0) }
  }, [d])
  const phone = useMediaQuery('(max-width: 760px)')
  const chart = useMemo(() => (d ? series(d, phone ? 5 : 10) : null), [d, phone])
  const cells = useMemo(() => new Map(d?.matrix.map((m) => [`${m.user__username}|${m.app}`, m]) ?? []), [d])

  return (
    <div className="usage">
      <div className="set-section-head usage-head">
        <div className="grow">
          <h1>Usage</h1>
          <p>Page views and API calls (including in-page data loads) per person, app and day: which apps actually get used. Staff only.</p>
        </div>
        <div className="seg" role="group" aria-label="Period">
          {PERIODS.map((p) => (
            <button key={p.days} type="button" aria-pressed={days === p.days} onClick={() => setDays(p.days)}>{p.label}</button>
          ))}
        </div>
      </div>
      {q.isPending ? (
        <div className="set-card"><SkeletonRows rows={6} /></div>
      ) : q.isError && !d ? (
        <ErrorBox error={q.error} retry={() => q.refetch()} />
      ) : d && totals && chart ? (
        <div className={'usage-body' + (q.isPlaceholderData ? ' stale' : '')}>
          <div className="usage-kpis">
            {[
              [fmt(totals.views), 'page views'],
              [fmt(totals.calls), 'API calls'],
              [fmt(d.people.length), d.people.length === 1 ? 'person active' : 'people active'],
              [d.apps[0]?.app ?? '–', 'most used app'],
            ].map(([v, l]) => (
              <div key={l} className="set-card usage-kpi">
                <span className="value truncate">{v}</span>
                <span className="small muted">{l}</span>
              </div>
            ))}
          </div>
          <div className="usage-grid">
            <section className="card">
              <div className="card-head"><h2>Page views per {chart.unit}</h2></div>
              <div className="card-body">
                {chart.values.some((v) => v > 0)
                  ? <Columns values={chart.values} labels={chart.labels} format={fmt} height={200} title={`Page views per ${chart.unit}`} />
                  : <div className="empty">No usage in this period yet.</div>}
              </div>
            </section>
            <section className="card">
              <div className="card-head"><h2>Page views by app</h2></div>
              <div className="card-body">
                {d.apps.length ? (
                  <HBars
                    items={d.apps.map((a) => ({
                      key: a.app, label: a.app, value: n(a.views),
                      title: `${a.app}: ${fmt(n(a.views))} views · ${fmt(n(a.calls))} API calls · ${a.people} ${a.people === 1 ? 'person' : 'people'}`,
                    }))}
                    format={fmt}
                  />
                ) : <div className="empty">No usage in this period yet.</div>}
              </div>
            </section>
          </div>
          <section className="card">
            <div className="card-head"><h2>People × apps</h2><span className="count">page views · API calls</span></div>
            {d.people.length ? (
              <div className="usage-table-wrap">
                <table className="usage-table">
                  <thead>
                    <tr>
                      <th scope="col">Person</th>
                      <th scope="col" className="num">Active days</th>
                      {d.apps.map((a) => <th key={a.app} scope="col" className="num">{a.app}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {d.people.map((p) => (
                      <tr key={p.user}>
                        <th scope="row" title={`@${p.user}`}>{p.name}</th>
                        <td className="num">{fmt(p.active_days)}</td>
                        {d.apps.map((a) => {
                          const m = cells.get(`${p.user}|${a.app}`)
                          return <td key={a.app} className={'num' + (m ? '' : ' zero')}>{m ? `${fmt(n(m.views))} · ${fmt(n(m.calls))}` : '–'}</td>
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <div className="empty">No usage in this period yet.</div>}
          </section>
        </div>
      ) : null}
    </div>
  )
}
