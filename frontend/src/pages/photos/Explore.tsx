// Photos explore pages: Stats (/photos/stats), Storage (/photos/storage) and Browse (/photos/browse).
// Everything the classic Stats and Storage pages show, plus extras. Charts are the shared measured SVG
// columns (components/charts.tsx): one hue per chart (the media switch picks the series), tooltips on hover
// and keyboard focus. Storage uses the classic four series colours (photos, RAW, videos, video originals).
import { useMemo, useState, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { Icon } from '../../components/Icon'
import { HBars, PlotColumns, StackBar } from '../../components/charts'
import { InlineFail } from '../../components/resilience'
import { ErrorBox, SkeletonRows } from '../../components/ui'
import { get, safeHref } from '../../lib/api'
import { fmtDate } from '../../lib/dates'
import { fmtBytes, fmtHms } from './util'

const HOUR = 60 * 60_000
const n = (x: number) => (x ?? 0).toLocaleString()
const pct = (part: number, whole: number, digits = 1) => (whole > 0 ? `${((part / whole) * 100).toFixed(digits)}%` : '0%')

interface Series { photos: number[]; videos: number[]; length_s: number[] }
interface MonthCount { month: string; photos: number; videos: number; length_s: number }
interface Stats {
  totals: { total: number; photos: number; videos: number; video_length_s: number; avg_megapixels: number | null; first: string | null; last: string | null }
  periods: Record<'week' | 'month' | 'year' | 'ytd', { count: number; previous: number }>
  by_hour: Series
  by_weekday: Series
  by_day_of_month: Series
  by_month_of_year: Series
  by_month: MonthCount[]
  cameras: { make: string | null; model: string | null; count: number }[]
  countries: { name: string; count: number }[]
  cities: { name: string; count: number }[]
}
interface Bucket { count: number; optimized_kb: number; total_kb: number; overhead_kb: number; length_s: number }
/** One row of the storage tables: the classic page's columns (KB and seconds). */
interface Breakdown {
  photo_count: number; photo_kb: number; raw_kb: number
  video_count: number; video_kb: number; original_kb: number; video_s: number
  count: number; optimized_kb: number; total_kb: number
}
interface Group { name: string | null; count: number; videos: number; total_kb: number; optimized_kb: number }
interface Storage {
  all: Bucket; photo: Bucket; video: Bucket
  by_library: (Breakdown & { id: number; name: string })[]
  by_year: (Breakdown & { year: number })[]
  by_month: (Breakdown & { month: string })[]
  undated: Breakdown | null
  by_camera: Group[]
  by_type: Group[]
  largest: { id: string; thumb_url: string; size_kb: number; video: boolean; date_taken: string | null }[]
}

type BrowseItem = { display: string; value: string; count: number; country?: string }

const EMPTY_SERIES: Series = { photos: [], videos: [], length_s: [] }
const BUCKET0: Bucket = { count: 0, optimized_kb: 0, total_kb: 0, overhead_kb: 0, length_s: 0 }
/** Tolerate a partial response (older server, cached copy): every section still renders. */
function statsOf(d: Partial<Stats>): Stats {
  const series = (x: unknown) => (x && typeof x === 'object' && Array.isArray((x as Series).photos) ? (x as Series) : EMPTY_SERIES)
  return {
    totals: { total: 0, photos: 0, videos: 0, video_length_s: 0, avg_megapixels: null, first: null, last: null, ...d.totals },
    periods: { week: { count: 0, previous: 0 }, month: { count: 0, previous: 0 }, year: { count: 0, previous: 0 }, ytd: { count: 0, previous: 0 }, ...d.periods },
    by_hour: series(d.by_hour), by_weekday: series(d.by_weekday), by_day_of_month: series(d.by_day_of_month), by_month_of_year: series(d.by_month_of_year),
    by_month: Array.isArray(d.by_month) ? d.by_month : [],
    cameras: d.cameras ?? [], countries: d.countries ?? [], cities: d.cities ?? [],
  }
}
function storageOf(d: Partial<Storage>): Storage {
  const arr = <T,>(x: T[] | undefined) => (Array.isArray(x) ? x : [])
  const rows = <T,>(x: T[] | undefined) => arr(x).filter((r) => r && typeof (r as unknown as Breakdown).photo_count === 'number')
  return {
    all: { ...BUCKET0, ...d.all }, photo: { ...BUCKET0, ...d.photo }, video: { ...BUCKET0, ...d.video },
    by_library: rows(d.by_library), by_year: rows(d.by_year), by_month: rows(d.by_month), undated: d.undated ?? null,
    by_camera: arr(d.by_camera), by_type: arr(d.by_type), largest: arr(d.largest),
  }
}

function Card({ title, children, className = '', actions }: { title: string; children: ReactNode; className?: string; actions?: ReactNode }) {
  return (
    <section className={'card ex-card ' + className}>
      <div className="card-head ex-card-head"><h2>{title}</h2>{actions && <div className="ex-actions">{actions}</div>}</div>
      <div className="card-body">{children}</div>
    </section>
  )
}

function Tile({ label, value, sub, swatch }: { label: string; value: ReactNode; sub?: ReactNode; swatch?: string }) {
  return (
    <div className="card ex-tile">
      <span className="label">{swatch && <i className={'ex-swatch ' + swatch} aria-hidden="true" />}{label}</span>
      <span className="ex-value tabular">{value}</span>
      {sub && <span className="muted xsmall ex-tile-sub">{sub}</span>}
    </div>
  )
}

/** Change vs the previous period of the same length, as the classic page shows it (+100% from nothing). */
function Delta({ cur, prev }: { cur: number; prev: number }) {
  if (!prev && !cur) return <span className="muted xsmall">No items in either period</span>
  const p = prev ? ((cur - prev) / prev) * 100 : 100
  const cls = p > 0 ? ' up' : p < 0 ? ' down' : ''
  return (
    <span className={'delta' + cls} title={`Previous period: ${n(prev)} items`}>
      {p !== 0 && <Icon name={p > 0 ? 'arrowUp' : 'arrowDown'} size={12} />}
      {p > 0 ? '+' : ''}{p.toFixed(1)}% vs prior period ({n(prev)})
    </span>
  )
}

// ---------------------------------------------------------------- stats
type Kind = 'all' | 'photo' | 'video' | 'duration'
const KINDS: [Kind, string][] = [['all', 'All media'], ['photo', 'Photos only'], ['video', 'Videos only'], ['duration', 'Video duration']]
const pick = (s: { photos: number; videos: number; length_s: number }, k: Kind) =>
  k === 'all' ? s.photos + s.videos : k === 'photo' ? s.photos : k === 'video' ? s.videos : s.length_s
const fmtKind = (k: Kind) => (v: number) => (k === 'duration' ? fmtHms(v) : `${n(v)} ${k === 'photo' ? 'photos' : k === 'video' ? 'videos' : 'items'}`)
/** Readout for one column: the chosen series first, then the rest of the breakdown. */
function tipText(label: string, s: { photos: number; videos: number; length_s: number }, k: Kind) {
  const rest = [
    k !== 'all' && k !== 'duration' ? '' : `${n(s.photos)} photos`,
    k === 'video' || k === 'photo' ? '' : `${n(s.videos)} videos`,
    k !== 'duration' && s.length_s ? `${fmtHms(s.length_s)} of video` : '',
  ].filter(Boolean)
  return `${label}: ${fmtKind(k)(pick(s, k))}${rest.length ? ' · ' + rest.join(' · ') : ''}`
}

function KindSelect({ value, onChange, label }: { value: Kind; onChange: (k: Kind) => void; label: string }) {
  return (
    <select className="select sm-select" value={value} onChange={(e) => onChange(e.target.value as Kind)} aria-label={`${label}: media type`}>
      {KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
    </select>
  )
}

/** A Series card (hour / day of month / month of year / weekday) with its own media switch. */
function ActivityCard({ title, series, labels, tipLabels, note }: {
  title: string; series: Series; labels: string[]; tipLabels: string[]; note: (peak: string) => string
}) {
  const [kind, setKind] = useState<Kind>('all')
  const rows = labels.map((_, i) => ({ photos: series.photos[i] ?? 0, videos: series.videos[i] ?? 0, length_s: series.length_s[i] ?? 0 }))
  const values = rows.map((r) => pick(r, kind))
  const peak = values.some((v) => v > 0) ? values.indexOf(Math.max(...values)) : -1
  return (
    <Card title={title} actions={<KindSelect value={kind} onChange={setKind} label={title} />}>
      <PlotColumns title={title} values={values} labels={labels} tips={rows.map((r, i) => tipText(tipLabels[i], r, kind))} highlight={peak >= 0 ? peak : undefined} height={110} />
      <p className="help">{peak >= 0 ? note(tipLabels[peak]) : 'Nothing here yet.'}</p>
    </Card>
  )
}

type Range = '12m' | '24m' | '5y' | '10y' | 'all'
const RANGES: [Range, string][] = [['12m', 'Past 12 months'], ['24m', 'Past 24 months'], ['5y', 'Past 5 years (monthly)'], ['10y', 'Past 10 years (yearly)'], ['all', 'All years (yearly)']]
const monthKey = (y: number, m: number) => `${y}-${String(m).padStart(2, '0')}`

/** Upload history columns: the last 12/24/60 months up to this month, or years (last 10, or every year). */
function historyRows(byMonth: MonthCount[], range: Range, now = new Date()) {
  const zero = { photos: 0, videos: 0, length_s: 0 }
  if (range === '10y' || range === 'all') {
    const years = new Map<number, typeof zero>()
    for (const m of byMonth) {
      const y = Number(m.month.slice(0, 4))
      const t = years.get(y) ?? { ...zero }
      t.photos += m.photos; t.videos += m.videos; t.length_s += m.length_s
      years.set(y, t)
    }
    const thisYear = now.getFullYear()
    const ys = [...years.keys()]
    const first = range === '10y' ? thisYear - 9 : Math.min(thisYear, ...ys)
    const last = range === '10y' ? thisYear : Math.max(first, ...ys)
    return Array.from({ length: last - first + 1 }, (_, i) => ({ label: String(first + i), full: String(first + i), ...(years.get(first + i) ?? zero) }))
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
    <Card title="Upload history" className="wide" actions={<>
      <KindSelect value={kind} onChange={setKind} label="Upload history" />
      <select className="select sm-select" value={range} onChange={(e) => setRange(e.target.value as Range)} aria-label="Upload history: range">
        {RANGES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
      </select>
    </>}>
      <PlotColumns title="Upload history" values={values} labels={rows.map((r) => r.label)} tips={rows.map((r) => tipText(r.full, r, kind))} height={160} />
      <p className="help">
        {total > 0 ? <>{RANGES.find(([k]) => k === range)![1]}: {fmtKind(kind)(total)} · busiest {rows[peak].full} ({fmtKind(kind)(values[peak])})</> : 'Nothing in this range.'}
      </p>
    </Card>
  )
}

const hourName = (h: number) => (h === 0 ? '12 AM' : h < 12 ? `${h} AM` : h === 12 ? '12 PM' : `${h - 12} PM`)
const MONTHS = Array.from({ length: 12 }, (_, i) => fmtDate(new Date(2026, i, 15), { month: 'short' }))
const WEEKDAYS = Array.from({ length: 7 }, (_, i) => fmtDate(new Date(2026, 10, 2 + i), { weekday: 'short' }))  // Mon first, as sent

export function StatsPage() {
  const q = useQuery({ queryKey: ['photos', 'stats', 2], queryFn: () => get<Stats>('photos/stats'), staleTime: HOUR })
  const head = (sub?: string) => <div className="page-head"><div className="grow"><h1>Stats</h1>{sub && <p className="sub">{sub}</p>}</div></div>
  if (q.isPending) return <div className="page ph-page">{head()}<SkeletonRows rows={8} /></div>
  if (!q.data) return <div className="page ph-page">{head()}<ErrorBox error={q.error} retry={() => q.refetch()} /></div>
  const s = statsOf(q.data)
  const t = s.totals
  const span = t.first && t.last ? `${fmtDate(new Date(t.first), { month: 'short', year: 'numeric' })} – ${fmtDate(new Date(t.last), { month: 'short', year: 'numeric' })}` : ''
  const PERIODS = { week: 'Past 7 days', month: 'Past 30 days', ytd: 'Year to date', year: 'Past 365 days' } as const
  return (
    <div className="page ph-page ex-page">
      {head(span ? `Totals and capture activity · ${span}` : 'Totals and capture activity for your libraries.')}
      {q.isError && <InlineFail what="the latest stats (showing saved ones)" retry={() => q.refetch()} />}
      <div className="ex-tiles">
        <Tile label="Total items" value={n(t.total)} sub="Combined media files" />
        <Tile label="Photos" value={n(t.photos)} sub={`${pct(t.photos, t.total)} of library`} />
        <Tile label="Videos" value={n(t.videos)} sub={<>{pct(t.videos, t.total)} of library{t.video_length_s ? ` · ${fmtHms(t.video_length_s)}` : ''}</>} />
        <Tile label="Average quality" value={t.avg_megapixels ? <>{t.avg_megapixels.toFixed(1)} <span className="ex-unit">MP</span></> : '—'} sub="For captured images" />
      </div>
      <h2 className="ex-section">Recent activity <span className="muted xsmall">vs. prior period</span></h2>
      <div className="ex-tiles">
        {(['week', 'month', 'ytd', 'year'] as const).map((k) => (
          <Tile key={k} label={PERIODS[k]} value={<>{n(s.periods[k].count)} <span className="ex-unit">items</span></>} sub={<Delta cur={s.periods[k].count} prev={s.periods[k].previous} />} />
        ))}
      </div>
      <div className="ex-grid">
        <UploadHistory byMonth={s.by_month} />
        <ActivityCard title="Hourly activity" series={s.by_hour}
          labels={Array.from({ length: 24 }, (_, h) => (h % 3 === 0 ? hourName(h).replace(' ', '').toLowerCase().replace('m', '') : ''))}
          tipLabels={Array.from({ length: 24 }, (_, h) => `${hourName(h)}–${hourName((h + 1) % 24)}`)} note={(p) => `Busiest hour: ${p}.`} />
        <ActivityCard title="Daily activity" series={s.by_day_of_month}
          labels={Array.from({ length: 31 }, (_, i) => String(i + 1))} tipLabels={Array.from({ length: 31 }, (_, i) => `Day ${i + 1} of the month`)}
          note={(p) => `Busiest: ${p.toLowerCase()}.`} />
        <ActivityCard title="Monthly activity" series={s.by_month_of_year} labels={MONTHS}
          tipLabels={Array.from({ length: 12 }, (_, i) => fmtDate(new Date(2026, i, 15), { month: 'long' }))} note={(p) => `Busiest month of the year: ${p}.`} />
        <ActivityCard title="Day of week" series={s.by_weekday} labels={WEEKDAYS}
          tipLabels={Array.from({ length: 7 }, (_, i) => fmtDate(new Date(2026, 10, 2 + i), { weekday: 'long' }))} note={(p) => `Busiest day: ${p}.`} />
        <Card title="Top equipment">
          {s.cameras.length ? <HBars items={s.cameras.map((c, i) => {
            const name = [c.make, c.model].filter(Boolean).join(' ') || 'Unknown camera'
            return { key: i, label: name, value: c.count, title: `${name}: ${n(c.count)} captures` }
          })} format={n} /> : <p className="help">No camera metadata available.</p>}
        </Card>
        <Card title="Countries">{s.countries.length ? <HBars items={s.countries.map((c) => ({ key: c.name, label: c.name, value: c.count }))} format={n} /> : <p className="help">No places yet.</p>}</Card>
        <Card title="Cities">{s.cities.length ? <HBars items={s.cities.map((c) => ({ key: c.name, label: c.name, value: c.count }))} format={n} /> : <p className="help">No places yet.</p>}</Card>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- storage
const fb = (kb: number) => fmtBytes(kb, true)  // the classic page's precision
const SERIES = [
  { key: 'photo', label: 'Photos', cls: 'photo' },
  { key: 'raw', label: 'Photos RAW', cls: 'raw' },
  { key: 'video', label: 'Videos', cls: 'video' },
  { key: 'orig', label: 'Video originals', cls: 'orig' },
] as const

function UsageBar({ r }: { r: Breakdown }) {
  const vals = { photo: r.photo_kb, raw: r.raw_kb, video: r.video_kb, orig: r.original_kb }
  const tot = r.total_kb
  const label = SERIES.map((x) => `${x.label} ${fb(vals[x.key])} (${pct(vals[x.key], tot)})`).join(' · ')
  return <StackBar label={label} parts={SERIES.map((x) => ({ key: x.key, value: vals[x.key], className: 'ex-' + x.cls, label: x.label }))} />
}

const sumRows = (rows: Breakdown[]): Breakdown => rows.reduce((a, r) => {
  for (const k of Object.keys(a) as (keyof Breakdown)[]) a[k] += r[k] ?? 0
  return a
}, { photo_count: 0, photo_kb: 0, raw_kb: 0, video_count: 0, video_kb: 0, original_kb: 0, video_s: 0, count: 0, optimized_kb: 0, total_kb: 0 })

function Cells({ r }: { r: Breakdown }) {
  const z = (v: number, s: string) => <td className={'num' + (v ? '' : ' zero')}>{s}</td>
  return (
    <>
      {z(r.photo_count, n(r.photo_count))}
      {z(r.photo_kb, fb(r.photo_kb))}
      {z(r.raw_kb, fb(r.raw_kb))}
      {z(r.video_count, n(r.video_count))}
      {z(r.video_s, fmtHms(r.video_s))}
      {z(r.video_kb, fb(r.video_kb))}
      {z(r.original_kb, fb(r.original_kb))}
      <td className="num strong">{fb(r.total_kb)}</td>
      <td className="ex-usage"><UsageBar r={r} /></td>
    </>
  )
}

function StorageTable({ first, rows, total, empty, tall }: {
  first: string; rows: { key: string; name: string; muted?: boolean; r: Breakdown }[]; total?: { name: string; r: Breakdown }; empty: string; tall?: boolean
}) {
  return (
    <div className={'ex-table-wrap' + (tall ? ' tall' : '')} tabIndex={0} aria-label={`Storage by ${first.toLowerCase()}`}>
      <table className="ex-table">
        <thead>
          <tr>
            <th rowSpan={2} scope="col" className="ex-first">{first}</th>
            <th colSpan={3} scope="colgroup" className="group photo"><span><i className="ex-swatch photo" aria-hidden="true" />Photos</span></th>
            <th colSpan={4} scope="colgroup" className="group video"><span><i className="ex-swatch video" aria-hidden="true" />Videos</span></th>
            <th rowSpan={2} scope="col" className="num">Total space</th>
            <th rowSpan={2} scope="col">Usage breakdown</th>
          </tr>
          <tr>
            <th scope="col" className="num">Count</th><th scope="col" className="num">Optimized</th><th scope="col" className="num">RAW</th>
            <th scope="col" className="num">Count</th><th scope="col" className="num">Duration</th><th scope="col" className="num">Optimized</th><th scope="col" className="num">Original</th>
          </tr>
        </thead>
        <tbody>
          {rows.length ? rows.map((x) => (
            <tr key={x.key} className={x.muted ? 'muted-row' : ''}>
              <th scope="row" className="ex-first"><span className="truncate" title={x.name}>{x.name}</span></th>
              <Cells r={x.r} />
            </tr>
          )) : <tr><td colSpan={10} className="ex-empty">{empty}</td></tr>}
        </tbody>
        {total && rows.length > 1 && (
          <tfoot>
            <tr><th scope="row" className="ex-first">{total.name}</th><Cells r={total.r} /></tr>
          </tfoot>
        )}
      </table>
    </div>
  )
}

/** "Not recorded" label for a camera/type group with no value, saying which media it covers. */
function groupLabel(g: Group, what: string) {
  if (g.name) return g.name
  if (g.videos === 0) return `Photos, ${what} not recorded`
  if (g.videos === g.count) return `Videos, ${what} not recorded`
  return `${what[0].toUpperCase() + what.slice(1)} not recorded`
}
function GroupBars({ rows, what }: { rows: Group[]; what: string }) {
  if (!rows.length) return <p className="help">Nothing here yet.</p>
  return <HBars items={rows.map((r, i) => {
    const label = groupLabel(r, what)
    const split = `${n(r.count - r.videos)} photos, ${n(r.videos)} videos`
    return { key: i, label, value: r.total_kb, title: `${label}: ${fmtBytes(r.total_kb)} (${fmtBytes(r.optimized_kb)} optimized) in ${n(r.count)} items · ${split}` }
  })} format={fmtBytes} />
}

const TABLES = [['library', 'By library'], ['year', 'By year'], ['month', 'By month']] as const
type Table = typeof TABLES[number][0]

/** Every month from the newest to the oldest with items; months without any show as empty rows (like the classic page). */
function allMonths(rows: (Breakdown & { month: string })[]) {
  if (!rows.length) return []
  const byKey = new Map(rows.map((r) => [r.month, r]))
  const [y1, m1] = rows[0].month.split('-').map(Number)
  const [y0, m0] = rows[rows.length - 1].month.split('-').map(Number)
  const out: { key: string; name: string; muted: boolean; r: Breakdown }[] = []
  for (let y = y1, m = m1; y > y0 || (y === y0 && m >= m0); m === 1 ? (y--, (m = 12)) : m--) {
    const k = monthKey(y, m)
    const r = byKey.get(k)
    out.push({ key: k, name: fmtDate(new Date(y, m - 1, 15), { month: 'short', year: 'numeric' }), muted: !r, r: r ?? sumRows([]) })
  }
  return out
}

export function StoragePage() {
  const q = useQuery({ queryKey: ['photos', 'storage', 2], queryFn: () => get<Storage>('photos/storage'), staleTime: HOUR })
  const [params, setParams] = useSearchParams()
  const tab: Table = (TABLES.find(([k]) => k === params.get('by')) ?? TABLES[0])[0]
  const head = (sub?: string) => <div className="page-head"><div className="grow"><h1>Storage</h1>{sub && <p className="sub">{sub}</p>}</div></div>
  const s = useMemo(() => (q.data ? storageOf(q.data) : null), [q.data])
  const months = useMemo(() => (s ? allMonths(s.by_month) : []), [s])
  if (q.isPending) return <div className="page ph-page">{head()}<SkeletonRows rows={8} /></div>
  if (!s) return <div className="page ph-page">{head()}<ErrorBox error={q.error} retry={() => q.refetch()} /></div>
  const undated = s.undated ? [{ key: 'undated', name: 'No date', muted: true, r: s.undated }] : []
  const tables = {
    library: { first: 'Library', rows: s.by_library.map((r) => ({ key: String(r.id), name: r.name, r })), empty: 'No libraries.' },
    year: { first: 'Year', rows: [...s.by_year.map((r) => ({ key: String(r.year), name: String(r.year), r })), ...undated], empty: 'No dated items.' },
    month: { first: 'Month', rows: [...months, ...undated], empty: 'No dated items.' },
  }[tab]
  return (
    <div className="page ph-page ex-page ex-storage">
      {head(`Disk space used by optimized files and the originals kept alongside them · ${fb(s.all.total_kb)} for ${n(s.all.count)} items`)}
      {q.isError && <InlineFail what="the latest storage numbers (showing saved ones)" retry={() => q.refetch()} />}
      <div className="ex-tiles">
        <Tile swatch="photo" label="Photos storage" value={fb(s.photo.total_kb)}
          sub={<><span className="ex-nw"><strong>{fb(s.photo.optimized_kb)}</strong> optimized</span> · <span className="ex-nw"><strong>{fb(s.photo.overhead_kb)}</strong> RAW</span> · <span className="ex-nw">{n(s.photo.count)} files</span></>} />
        <Tile swatch="video" label="Videos storage" value={fb(s.video.total_kb)}
          sub={<><span className="ex-nw"><strong>{fb(s.video.optimized_kb)}</strong> optimized</span> · <span className="ex-nw"><strong>{fb(s.video.overhead_kb)}</strong> original</span> · <span className="ex-nw">{n(s.video.count)} files</span> · <span className="ex-nw">{fmtHms(s.video.length_s)}</span></>} />
        <Tile swatch="all" label="Combined library" value={fb(s.all.total_kb)}
          sub={<><span className="ex-nw"><strong>{fb(s.all.optimized_kb)}</strong> optimized</span> · <span className="ex-nw"><strong>{fb(s.all.overhead_kb)}</strong> overhead</span> · <span className="ex-nw">{n(s.all.count)} files</span></>} />
      </div>
      <section className="card ex-card ex-tablecard">
        <div className="card-head ex-card-head">
          <div className="seg" role="tablist" aria-label="Group storage">
            {TABLES.map(([k, l]) => (
              <button key={k} id={`st-tab-${k}`} role="tab" aria-selected={k === tab} aria-controls="st-panel"
                onClick={() => setParams((p) => { const x = new URLSearchParams(p); x.set('by', k); return x }, { replace: true })}>{l}</button>
            ))}
          </div>
          <div className="ex-legend" aria-label="Usage breakdown colours">
            {SERIES.map((x) => <span key={x.key}><i className={'ex-swatch ' + x.cls} aria-hidden="true" />{x.label}</span>)}
          </div>
        </div>
        <div id="st-panel" role="tabpanel" aria-labelledby={`st-tab-${tab}`}>
          <StorageTable first={tables.first} rows={tables.rows} empty={tables.empty} tall={tab === 'month'}
            total={{ name: `All (${n(tables.rows.length)} ${{ library: 'libraries', year: 'rows', month: 'rows' }[tab]})`, r: sumRows(tables.rows.map((x) => x.r)) }} />
        </div>
      </section>
      <div className="ex-grid">
        <Card title="By camera"><GroupBars rows={s.by_camera} what="camera" /></Card>
        <Card title="By type"><GroupBars rows={s.by_type} what="type" /></Card>
        <Card title="Largest items" className="wide">
          <div className="ex-largest">
            {s.largest.map((p) => {
              const src = safeHref(p.thumb_url)
              return (
                <Link key={p.id} to={`/photos?photo=${p.id}`} className="ex-big" title={p.date_taken ? fmtDate(new Date(p.date_taken), { month: 'short', day: 'numeric', year: 'numeric' }) : ''}>
                  {src && <img src={src} alt="" loading="lazy" decoding="async" />}
                  <span className="ex-big-size tabular">{p.video && <Icon name="play" size={10} />}{fmtBytes(p.size_kb)}</span>
                </Link>
              )
            })}
          </div>
        </Card>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- browse
const TABS = [
  { id: 'cities', label: 'Cities', icon: 'pin', param: 'city' },
  { id: 'countries', label: 'Countries', icon: 'globe', param: 'country' },
  { id: 'cameras', label: 'Cameras', icon: 'camera', param: 'camera' },
  { id: 'objects', label: 'Objects', icon: 'tag', param: 'objects' },
] as const

export function BrowsePage() {
  const [params, setParams] = useSearchParams()
  const tab = TABS.find((t) => t.id === params.get('tab')) ?? TABS[0]
  const [filter, setFilter] = useState('')
  const q = useQuery({ queryKey: ['photos', 'browse', tab.id], queryFn: () => get<BrowseItem[]>(`photos/browse/${tab.id}`), staleTime: HOUR })
  const needle = filter.trim().toLowerCase()
  const items = useMemo(() => (q.data ?? []).filter((i) => !needle || i.display.toLowerCase().includes(needle)), [q.data, needle])
  const max = Math.max(1, ...(q.data ?? []).map((i) => i.count))
  return (
    <div className="page ph-page">
      <div className="page-head"><div className="grow"><h1>Browse</h1><p className="sub">Find photos by place, camera or what's in them.</p></div></div>
      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={t.id === tab.id} onClick={() => (setFilter(''), setParams({ tab: t.id }, { replace: true }))}>
            <Icon name={t.icon} size={14} />{t.label}
          </button>
        ))}
      </div>
      <label className="ex-search">
        <Icon name="search" size={14} />
        <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={`Filter ${tab.label.toLowerCase()}`} aria-label={`Filter ${tab.label.toLowerCase()}`} />
        {q.data && <span className="muted xsmall tabular">{items.length}</span>}
      </label>
      {q.isPending ? <SkeletonRows rows={8} /> : !q.data ? <ErrorBox error={q.error} retry={() => q.refetch()} /> : !items.length ? (
        <div className="empty left">{needle ? 'No matches.' : tab.id === 'objects' ? 'No objects detected yet.' : 'Nothing here yet.'}</div>
      ) : (
        <ul className="ex-list">
          {items.map((i) => {
            const to = `/photos?${new URLSearchParams(tab.id === 'cities' && i.country ? { city: i.value, country: i.country } : { [tab.param]: i.value })}`
            return (
              <li key={i.value + (i.country ?? '')}>
                <Link to={to} className="ex-row">
                  <Icon name={tab.icon} size={15} />
                  <span className="grow truncate">{i.display}</span>
                  <span className="ex-bar" aria-hidden="true"><span style={{ width: `${(i.count / max) * 100}%` }} /></span>
                  <span className="muted small tabular ex-count">{n(i.count)}</span>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
