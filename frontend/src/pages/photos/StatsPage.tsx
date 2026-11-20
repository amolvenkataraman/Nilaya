// Photos › Stats (/photos/stats): everything the classic Stats page shows, plus extras. Charts are the shared
// measured SVG columns (components/charts.tsx): one hue per chart (the media switch picks the series),
// tooltips on hover and keyboard focus.
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Icon } from '../../components/Icon'
import { HBars, PlotColumns } from '../../components/charts'
import { InlineFail } from '../../components/resilience'
import { pageClass, PageHead, QueryView, SkeletonRows } from '../../components/ui'
import { cn } from '../../lib/cn'
import { fmtDate } from '../../lib/dates'
import { StatCard, StatTile, Unit, cardGridClass, helpClass, smallSelectClass, tilesClass } from './StatCards'
import { type MonthCount, type Series, monthKey, n, pct, statsOf, statsQuery } from './statsData'
import { fmtHms } from './util'
import { placeText } from '../../lib/format'

/** Change vs the previous period of the same length, as the classic page shows it (+100% from nothing). */
function Delta({ cur, prev }: { cur: number; prev: number }) {
  if (!prev && !cur) return <span className="text-xs text-muted">No items in either period</span>
  const p = prev ? ((cur - prev) / prev) * 100 : 100
  return (
    <span
      className={cn(
        'inline text-xs font-medium [&>svg]:mr-0.5 [&>svg]:inline [&>svg]:align-[-1px]',
        p > 0 ? 'text-success' : p < 0 ? 'text-danger' : 'text-muted',
      )}
      title={`Previous period: ${n(prev)} items`}
    >
      {p !== 0 && <Icon name={p > 0 ? 'arrowUp' : 'arrowDown'} size={12} />}
      {p > 0 ? '+' : ''}
      {p.toFixed(1)}% vs prior period ({n(prev)})
    </span>
  )
}

type Kind = 'all' | 'photo' | 'video' | 'duration'
const KINDS: [Kind, string][] = [
  ['all', 'All media'],
  ['photo', 'Photos only'],
  ['video', 'Videos only'],
  ['duration', 'Video duration'],
]
type Counts = { photos: number; videos: number; length_s: number }
const pick = (s: Counts, k: Kind) => (k === 'all' ? s.photos + s.videos : k === 'photo' ? s.photos : k === 'video' ? s.videos : s.length_s)
const fmtKind = (k: Kind) => (v: number) =>
  k === 'duration' ? fmtHms(v) : `${n(v)} ${k === 'photo' ? 'photos' : k === 'video' ? 'videos' : 'items'}`
/** Readout for one column: the chosen series first, then the rest of the breakdown. */
function tipText(label: string, s: Counts, k: Kind) {
  const rest = [
    k !== 'all' && k !== 'duration' ? '' : `${n(s.photos)} photos`,
    k === 'video' || k === 'photo' ? '' : `${n(s.videos)} videos`,
    k !== 'duration' && s.length_s ? `${fmtHms(s.length_s)} of video` : '',
  ].filter(Boolean)
  return `${label}: ${fmtKind(k)(pick(s, k))}${rest.length ? ` · ${rest.join(' · ')}` : ''}`
}

function KindSelect({ value, onChange, label }: { value: Kind; onChange: (k: Kind) => void; label: string }) {
  return (
    <select
      className={smallSelectClass}
      value={value}
      onChange={(e) => onChange(e.target.value as Kind)}
      aria-label={`${label}: media type`}
    >
      {KINDS.map(([k, l]) => (
        <option key={k} value={k}>
          {l}
        </option>
      ))}
    </select>
  )
}

/** A Series card (hour / day of month / month of year / weekday) with its own media switch. */
function ActivityCard({
  title,
  series,
  labels,
  tipLabels,
  note,
}: {
  title: string
  series: Series
  labels: string[]
  tipLabels: string[]
  note: (peak: string) => string
}) {
  const [kind, setKind] = useState<Kind>('all')
  const rows = labels.map((_, i) => ({ photos: series.photos[i] ?? 0, videos: series.videos[i] ?? 0, length_s: series.length_s[i] ?? 0 }))
  const values = rows.map((r) => pick(r, kind))
  const peak = values.some((v) => v > 0) ? values.indexOf(Math.max(...values)) : -1
  return (
    <StatCard title={title} actions={<KindSelect value={kind} onChange={setKind} label={title} />}>
      <PlotColumns
        title={title}
        values={values}
        labels={labels}
        tips={rows.map((r, i) => tipText(tipLabels[i], r, kind))}
        highlight={peak >= 0 ? peak : undefined}
        height={110}
      />
      <p className={helpClass}>{peak >= 0 ? note(tipLabels[peak]) : 'Nothing here yet.'}</p>
    </StatCard>
  )
}

type Range = '12m' | '24m' | '5y' | '10y' | 'all'
const RANGES: [Range, string][] = [
  ['12m', 'Past 12 months'],
  ['24m', 'Past 24 months'],
  ['5y', 'Past 5 years (monthly)'],
  ['10y', 'Past 10 years (yearly)'],
  ['all', 'All years (yearly)'],
]

/** Upload history columns: the last 12/24/60 months up to this month, or years (last 10, or every year). */
function historyRows(byMonth: MonthCount[], range: Range, now = new Date()) {
  const zero = { photos: 0, videos: 0, length_s: 0 }
  if (range === '10y' || range === 'all') {
    const years = new Map<number, typeof zero>()
    for (const m of byMonth) {
      const y = Number(m.month.slice(0, 4))
      const t = years.get(y) ?? { ...zero }
      t.photos += m.photos
      t.videos += m.videos
      t.length_s += m.length_s
      years.set(y, t)
    }
    const thisYear = now.getFullYear()
    const ys = [...years.keys()]
    const first = range === '10y' ? thisYear - 9 : Math.min(thisYear, ...ys)
    const last = range === '10y' ? thisYear : Math.max(first, ...ys)
    return Array.from({ length: last - first + 1 }, (_, i) => ({
      label: String(first + i),
      full: String(first + i),
      ...(years.get(first + i) ?? zero),
    }))
  }
  const count = { '12m': 12, '24m': 24, '5y': 60 }[range]
  const byKey = new Map(byMonth.map((m) => [m.month, m]))
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (count - 1 - i), 15)
    const m = byKey.get(monthKey(d.getFullYear(), d.getMonth() + 1))
    return {
      label: fmtDate(d, count === 12 ? { month: 'short' } : { month: 'short', year: '2-digit' }),
      full: fmtDate(d, { month: 'short', year: 'numeric' }),
      ...(m ? { photos: m.photos, videos: m.videos, length_s: m.length_s } : zero),
    }
  })
}

function UploadHistory({ byMonth }: { byMonth: MonthCount[] }) {
  const [kind, setKind] = useState<Kind>('all')
  const [range, setRange] = useState<Range>('12m')
  const rows = useMemo(() => historyRows(byMonth, range), [byMonth, range])
  const values = rows.map((r) => pick(r, kind))
  const total = values.reduce((a, b) => a + b, 0)
  const peak = total > 0 ? values.indexOf(Math.max(...values)) : -1
  return (
    <StatCard
      title="Upload history"
      wide
      actions={
        <>
          <KindSelect value={kind} onChange={setKind} label="Upload history" />
          <select
            className={smallSelectClass}
            value={range}
            onChange={(e) => setRange(e.target.value as Range)}
            aria-label="Upload history: range"
          >
            {RANGES.map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </>
      }
    >
      <PlotColumns
        title="Upload history"
        values={values}
        labels={rows.map((r) => r.label)}
        tips={rows.map((r) => tipText(r.full, r, kind))}
        height={160}
      />
      <p className={helpClass}>
        {total > 0 ? (
          <>
            {RANGES.find(([k]) => k === range)?.[1]}: {fmtKind(kind)(total)} · busiest {rows[peak].full} ({fmtKind(kind)(values[peak])})
          </>
        ) : (
          'Nothing in this range.'
        )}
      </p>
    </StatCard>
  )
}

const hourName = (h: number) => (h === 0 ? '12 AM' : h < 12 ? `${h} AM` : h === 12 ? '12 PM' : `${h - 12} PM`)
const HOUR_LABELS = Array.from({ length: 24 }, (_, h) => (h % 3 === 0 ? hourName(h).replace(' ', '').toLowerCase().replace('m', '') : ''))
const HOUR_TIPS = Array.from({ length: 24 }, (_, h) => `${hourName(h)}–${hourName((h + 1) % 24)}`)
const DAYS = Array.from({ length: 31 }, (_, i) => String(i + 1))
const DAY_TIPS = Array.from({ length: 31 }, (_, i) => `Day ${i + 1} of the month`)
const MONTHS = Array.from({ length: 12 }, (_, i) => fmtDate(new Date(2026, i, 15), { month: 'short' }))
const MONTH_TIPS = Array.from({ length: 12 }, (_, i) => fmtDate(new Date(2026, i, 15), { month: 'long' }))
// Monday first, as the server sends them.
const WEEKDAYS = Array.from({ length: 7 }, (_, i) => fmtDate(new Date(2026, 10, 2 + i), { weekday: 'short' }))
const WEEKDAY_TIPS = Array.from({ length: 7 }, (_, i) => fmtDate(new Date(2026, 10, 2 + i), { weekday: 'long' }))
const PERIODS = { week: 'Past 7 days', month: 'Past 30 days', ytd: 'Year to date', year: 'Past 365 days' } as const

export function StatsPage() {
  const q = useQuery(statsQuery)
  const s = useMemo(() => (q.data ? statsOf(q.data) : null), [q.data])
  const t = s?.totals
  const span =
    t?.first && t.last
      ? `${fmtDate(new Date(t.first), { month: 'short', year: 'numeric' })} – ${fmtDate(new Date(t.last), { month: 'short', year: 'numeric' })}`
      : ''
  return (
    <div className={pageClass(true)}>
      <PageHead
        title="Stats"
        sub={s ? (span ? `Totals and capture activity · ${span}` : 'Totals and capture activity for your libraries.') : undefined}
        className="mb-4"
      />
      <QueryView query={q} skeleton={<SkeletonRows rows={8} />}>
        {() => s && <StatsBody s={s} failed={q.isError} retry={() => q.refetch()} />}
      </QueryView>
    </div>
  )
}

function StatsBody({ s, failed, retry }: { s: ReturnType<typeof statsOf>; failed: boolean; retry: () => void }) {
  const t = s.totals
  return (
    <>
      {failed && <InlineFail what="the latest stats (showing saved ones)" retry={retry} />}
      <div className={tilesClass}>
        <StatTile label="Total items" value={n(t.total)} sub="Combined media files" />
        <StatTile label="Photos" value={n(t.photos)} sub={`${pct(t.photos, t.total)} of library`} />
        <StatTile
          label="Videos"
          value={n(t.videos)}
          sub={
            <>
              {pct(t.videos, t.total)} of library{t.video_length_s ? ` · ${fmtHms(t.video_length_s)}` : ''}
            </>
          }
        />
        <StatTile
          label="Average quality"
          value={
            t.avg_megapixels ? (
              <>
                {t.avg_megapixels.toFixed(1)} <Unit>MP</Unit>
              </>
            ) : (
              '—'
            )
          }
          sub="For captured images"
        />
      </div>
      <h2 className="mt-1 mb-2 flex items-baseline gap-2 text-sm font-semibold">
        Recent activity <span className="text-xs text-muted">vs. prior period</span>
      </h2>
      <div className={tilesClass}>
        {(['week', 'month', 'ytd', 'year'] as const).map((k) => (
          <StatTile
            key={k}
            label={PERIODS[k]}
            value={
              <>
                {n(s.periods[k].count)} <Unit>items</Unit>
              </>
            }
            sub={<Delta cur={s.periods[k].count} prev={s.periods[k].previous} />}
          />
        ))}
      </div>
      <div className={cardGridClass}>
        <UploadHistory byMonth={s.by_month} />
        <ActivityCard
          title="Hourly activity"
          series={s.by_hour}
          labels={HOUR_LABELS}
          tipLabels={HOUR_TIPS}
          note={(p) => `Busiest hour: ${p}.`}
        />
        <ActivityCard
          title="Daily activity"
          series={s.by_day_of_month}
          labels={DAYS}
          tipLabels={DAY_TIPS}
          note={(p) => `Busiest: ${p.toLowerCase()}.`}
        />
        <ActivityCard
          title="Monthly activity"
          series={s.by_month_of_year}
          labels={MONTHS}
          tipLabels={MONTH_TIPS}
          note={(p) => `Busiest month of the year: ${p}.`}
        />
        <ActivityCard
          title="Day of week"
          series={s.by_weekday}
          labels={WEEKDAYS}
          tipLabels={WEEKDAY_TIPS}
          note={(p) => `Busiest day: ${p}.`}
        />
        <StatCard title="Top equipment">
          {s.cameras.length ? (
            <HBars
              items={s.cameras.map((c, i) => {
                const name = [c.make, c.model].filter(Boolean).join(' ') || 'Unknown camera'
                return { key: i, label: name, value: c.count, title: `${name}: ${n(c.count)} captures` }
              })}
              format={n}
            />
          ) : (
            <p className={helpClass}>No camera metadata available.</p>
          )}
        </StatCard>
        <StatCard title="Countries">
          {s.countries.length ? (
            <HBars items={s.countries.map((c) => ({ key: c.name, label: placeText(c.name), value: c.count }))} format={n} />
          ) : (
            <p className={helpClass}>No places yet.</p>
          )}
        </StatCard>
        <StatCard title="Cities">
          {s.cities.length ? (
            <HBars items={s.cities.map((c) => ({ key: c.name, label: placeText(c.name), value: c.count }))} format={n} />
          ) : (
            <p className={helpClass}>No places yet.</p>
          )}
        </StatCard>
      </div>
    </>
  )
}
