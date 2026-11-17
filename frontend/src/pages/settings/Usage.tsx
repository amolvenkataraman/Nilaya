// Staff usage dashboard from GET /analytics/summary: page views and API calls per person, app and day.
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Columns, HBars } from '../../components/charts'
import { EmptyState, QueryView, Segmented, SkeletonRows, useIsPhone } from '../../components/ui'
import { cn } from '../../lib/cn'
import { addDays, dayKey, fmtDate, parseDayKey, startOfDay } from '../../lib/dates'
import { type UsageSummary, usageQuery } from './api'
import { Card, CardBody, CardCount, CardHead, cardClass } from './Card'
import { SectionHead } from './SettingsSection'

const PERIODS = [
  { value: '7', label: '7 days' },
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' },
  { value: '365', label: 'Year' },
] as const
type Period = (typeof PERIODS)[number]['value']
const n = (v: number | null | undefined) => v ?? 0
const fmt = (v: number) => v.toLocaleString()
const none = <EmptyState>No usage in this period yet.</EmptyState>

/** Daily columns up to a month; weekly beyond (one column per 7 days, newest on the right). */
function series(d: UsageSummary, maxLabels: number) {
  const byDay = new Map(d.per_day.map((r) => [r.day, n(r.views)]))
  const today = startOfDay(new Date())
  const daily = Array.from({ length: d.days }, (_, i) => dayKey(addDays(today, i - d.days + 1)))
  if (d.days <= 31) {
    const every = Math.ceil(d.days / maxLabels)
    return {
      values: daily.map((k) => byDay.get(k) ?? 0),
      labels: daily.map((k, i) =>
        (d.days - 1 - i) % every === 0
          ? fmtDate(parseDayKey(k), d.days <= 7 ? { weekday: 'short' } : { month: 'short', day: 'numeric' })
          : '',
      ),
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
    labels: weeks.map((w, i) =>
      (weeks.length - 1 - i) % every === 0 ? fmtDate(parseDayKey(w.start), { month: 'short', day: 'numeric' }) : '',
    ),
    unit: 'week',
  }
}

export function UsagePage() {
  const [period, setPeriod] = useState<Period>('30')
  const q = useQuery(usageQuery(Number(period)))
  return (
    // The charts' label rows may not shrink below their text (the shared stylesheet's 1fr would), and the
    // dates never wrap. `!` because that stylesheet isn't in a layer yet.
    <div className="[&_.cols-labels]:grid-cols-[repeat(var(--n),minmax(0,1fr))]! [&_.cols-labels_span]:whitespace-nowrap [&_.cols-values]:grid-cols-[repeat(var(--n),minmax(0,1fr))]!">
      <SectionHead className="mb-4">
        <div className="min-w-0 flex-1 max-md:basis-full">
          <h1 className="text-lg font-semibold">Usage</h1>
          <p className="mt-0.5 text-sm text-muted">
            Page views and API calls (including in-page data loads) per person, app and day: which apps actually get used. Staff only.
          </p>
        </div>
        <Segmented label="Period" value={period} onChange={setPeriod} options={PERIODS} />
      </SectionHead>
      <QueryView
        query={q}
        skeleton={
          <div className={cardClass}>
            <SkeletonRows rows={6} />
          </div>
        }
      >
        {(d) => <UsageBody d={d} stale={q.isPlaceholderData} />}
      </QueryView>
    </div>
  )
}

function UsageBody({ d, stale }: { d: UsageSummary; stale: boolean }) {
  const phone = useIsPhone()
  const totals = useMemo(
    () => ({ views: d.apps.reduce((a, x) => a + n(x.views), 0), calls: d.apps.reduce((a, x) => a + n(x.calls), 0) }),
    [d],
  )
  const chart = useMemo(() => series(d, phone ? 5 : 10), [d, phone])
  const cells = useMemo(() => new Map(d.matrix.map((m) => [`${m.user__username}|${m.app}`, m])), [d])
  const kpis = [
    [fmt(totals.views), 'page views'],
    [fmt(totals.calls), 'API calls'],
    [fmt(d.people.length), d.people.length === 1 ? 'person active' : 'people active'],
    [d.apps[0]?.app ?? '–', 'most used app'],
  ]
  const pad = 'px-3 py-2 text-left whitespace-nowrap'
  const cell = cn(pad, 'border-t border-border')
  const num = 'text-right tabular-nums'
  return (
    <div className={cn('grid gap-4 transition-opacity duration-150', stale && 'opacity-60')}>
      <div className="grid grid-cols-4 gap-3 max-md:grid-cols-2">
        {kpis.map(([v, l]) => (
          <div key={l} className={cn(cardClass, 'grid gap-0.5 px-4 py-3')}>
            <span className="truncate text-xl leading-[1.2] font-semibold tracking-[-0.02em] tabular-nums">{v}</span>
            <span className="text-sm text-muted">{l}</span>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-[minmax(0,3fr)_minmax(0,2fr)] items-start gap-4 max-md:grid-cols-1">
        <Card>
          <CardHead title={`Page views per ${chart.unit}`} />
          <CardBody>
            {chart.values.some((v) => v > 0) ? (
              <Columns values={chart.values} labels={chart.labels} format={fmt} height={200} title={`Page views per ${chart.unit}`} />
            ) : (
              none
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHead title="Page views by app" />
          <CardBody>
            {d.apps.length ? (
              <HBars
                items={d.apps.map((a) => ({
                  key: a.app,
                  label: a.app,
                  value: n(a.views),
                  title: `${a.app}: ${fmt(n(a.views))} views · ${fmt(n(a.calls))} API calls · ${a.people} ${a.people === 1 ? 'person' : 'people'}`,
                }))}
                format={fmt}
              />
            ) : (
              none
            )}
          </CardBody>
        </Card>
      </div>
      <Card>
        <CardHead title="People × apps">
          <CardCount>page views · API calls</CardCount>
        </CardHead>
        {d.people.length ? (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="text-muted *:font-medium">
                  <th scope="col" className={cn(pad, 'sticky left-0 bg-surface')}>
                    Person
                  </th>
                  <th scope="col" className={cn(pad, num)}>
                    Active days
                  </th>
                  {d.apps.map((a) => (
                    <th key={a.app} scope="col" className={cn(pad, num)}>
                      {a.app}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {d.people.map((p) => (
                  <tr key={p.user}>
                    <th scope="row" title={`@${p.user}`} className={cn(cell, 'sticky left-0 bg-surface font-medium')}>
                      {p.name}
                    </th>
                    <td className={cn(cell, num)}>{fmt(p.active_days)}</td>
                    {d.apps.map((a) => {
                      const m = cells.get(`${p.user}|${a.app}`)
                      return (
                        <td key={a.app} className={cn(cell, num, !m && 'text-muted')}>
                          {m ? `${fmt(n(m.views))} · ${fmt(n(m.calls))}` : '–'}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          none
        )}
      </Card>
    </div>
  )
}
