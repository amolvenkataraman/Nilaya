// Photos explore pages: Stats (/photos/stats), Storage (/photos/storage) and Browse (/photos/browse).
// Plain-SVG charts in the shared single-hue style (components/charts.tsx).
import { useMemo, useState, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { Icon } from '../../components/Icon'
import { Columns, HBars } from '../../components/charts'
import { ErrorBox, SkeletonRows } from '../../components/ui'
import { get, safeHref } from '../../lib/api'
import { fmtDate } from '../../lib/dates'
import { fmtBytes, fmtDuration } from './util'

const HOUR = 60 * 60_000
const n = (x: number) => x.toLocaleString()

interface Stats {
  totals: { total: number; photos: number; videos: number; avg_megapixels: number | null; first: string | null; last: string | null }
  periods: Record<'week' | 'month' | 'year' | 'ytd', { count: number; previous: number }>
  by_hour: number[]
  by_weekday: number[]
  by_month: { month: string; photos: number; videos: number }[]
  cameras: { make: string; model: string; count: number }[]
  countries: { name: string; count: number }[]
  cities: { name: string; count: number }[]
}
interface Bucket { count: number; optimized_kb: number; total_kb: number; overhead_kb: number; length_s: number }
interface Storage {
  all: Bucket; photo: Bucket; video: Bucket
  by_year: { year: number; count: number; total_kb: number }[]
  by_library: { name: string; count: number; total_kb: number; optimized_kb: number }[]
  by_camera: { name: string; count: number; total_kb: number; optimized_kb: number }[]
  by_type: { name: string; count: number; total_kb: number; optimized_kb: number }[]
  largest: { id: string; thumb_url: string; size_kb: number; video: boolean; date_taken: string | null }[]
}
type BrowseItem = { display: string; value: string; count: number; country?: string }

function Card({ title, children, className = '' }: { title: string; children: ReactNode; className?: string }) {
  return (
    <section className={'card ex-card ' + className}>
      <div className="card-head"><h2>{title}</h2></div>
      <div className="card-body">{children}</div>
    </section>
  )
}

function Tile({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="card ex-tile">
      <span className="label">{label}</span>
      <span className="ex-value tabular">{value}</span>
      {sub && <span className="muted xsmall">{sub}</span>}
    </div>
  )
}

function Delta({ cur, prev }: { cur: number; prev: number }) {
  if (!prev && !cur) return <span className="muted xsmall">No photos</span>
  const d = cur - prev
  return (
    <span className="delta">
      <Icon name={d >= 0 ? 'arrowUp' : 'arrowDown'} size={12} />{n(Math.abs(d))} vs previous ({n(prev)})
    </span>
  )
}

// ---------------------------------------------------------------- stats
export function StatsPage() {
  const q = useQuery({ queryKey: ['photos', 'stats'], queryFn: () => get<Stats>('photos/stats'), staleTime: HOUR })
  if (q.isPending) return <div className="page ph-page"><SkeletonRows rows={8} /></div>
  if (!q.data) return <div className="page ph-page"><ErrorBox error={q.error} retry={() => q.refetch()} /></div>
  const s = q.data
  const t = s.totals
  const span = t.first && t.last ? `${fmtDate(new Date(t.first), { month: 'short', year: 'numeric' })} – ${fmtDate(new Date(t.last), { month: 'short', year: 'numeric' })}` : ''
  const hourLabels = s.by_hour.map((_, h) => (h % 6 === 0 ? (h === 0 ? '12a' : h === 12 ? '12p' : h < 12 ? `${h}a` : `${h - 12}p`) : ''))
  const busiestHour = s.by_hour.indexOf(Math.max(...s.by_hour))
  // Continuous month axis (empty months show as gaps), last 24 months at most.
  const months = (() => {
    if (!s.by_month.length) return []
    const byKey = new Map(s.by_month.map((m) => [m.month, m]))
    const [y0, m0] = s.by_month[0].month.split('-').map(Number)
    const [y1, m1] = s.by_month[s.by_month.length - 1].month.split('-').map(Number)
    const out: { month: string; photos: number; videos: number }[] = []
    for (let y = y0, m = m0; y < y1 || (y === y1 && m <= m1); m === 12 ? (y++, (m = 1)) : m++) {
      const k = `${y}-${String(m).padStart(2, '0')}`
      out.push(byKey.get(k) ?? { month: k, photos: 0, videos: 0 })
    }
    return out.slice(-24)
  })()
  return (
    <div className="page ph-page">
      <div className="page-head"><div className="grow"><h1>Stats</h1><p className="sub">{span}</p></div></div>
      <div className="ex-tiles">
        <Tile label="Total" value={n(t.total)} sub={`${n(t.photos)} photos · ${n(t.videos)} videos`} />
        {(['week', 'month', 'year', 'ytd'] as const).map((k) => (
          <Tile key={k} label={{ week: 'This week', month: 'This month', year: 'Last 12 months', ytd: 'Year to date' }[k]} value={n(s.periods[k].count)} sub={<Delta cur={s.periods[k].count} prev={s.periods[k].previous} />} />
        ))}
        {t.avg_megapixels ? <Tile label="Average resolution" value={`${t.avg_megapixels.toFixed(1)} MP`} /> : null}
      </div>
      <div className="ex-grid">
        <Card title="Photos per month" className="wide">
          <Columns title="Photos and videos per month" values={months.map((m) => m.photos + m.videos)}
            labels={months.map((m) => fmtDate(new Date(m.month + '-15'), { month: 'short' }))} format={(v) => n(v)} height={120} />
          <p className="help">{months.map((m) => `${fmtDate(new Date(m.month + '-15'), { month: 'short', year: 'numeric' })}: ${n(m.photos)} photos, ${n(m.videos)} videos`).join(' · ')}</p>
        </Card>
        <Card title="Time of day">
          <Columns title="Photos by hour" values={s.by_hour} labels={hourLabels} highlight={busiestHour} format={(v) => n(v)} height={110} />
          <p className="help">Most photos around {busiestHour === 0 ? '12 AM' : busiestHour < 12 ? `${busiestHour} AM` : busiestHour === 12 ? '12 PM' : `${busiestHour - 12} PM`}.</p>
        </Card>
        <Card title="Day of week">
          <Columns title="Photos by weekday" values={s.by_weekday} labels={['M', 'T', 'W', 'T', 'F', 'S', 'S']} highlight={s.by_weekday.indexOf(Math.max(...s.by_weekday))} format={(v) => n(v)} height={110} />
        </Card>
        <Card title="Cameras"><HBars items={s.cameras.slice(0, 8).map((c) => ({ key: c.make + c.model, label: c.model || c.make || 'Unknown', value: c.count, title: `${c.make} ${c.model}: ${n(c.count)}` }))} format={n} /></Card>
        <Card title="Countries"><HBars items={s.countries.slice(0, 8).map((c) => ({ key: c.name, label: c.name, value: c.count }))} format={n} /></Card>
        <Card title="Cities"><HBars items={s.cities.slice(0, 10).map((c) => ({ key: c.name, label: c.name, value: c.count }))} format={n} /></Card>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- storage
export function StoragePage() {
  const q = useQuery({ queryKey: ['photos', 'storage'], queryFn: () => get<Storage>('photos/storage'), staleTime: HOUR })
  if (q.isPending) return <div className="page ph-page"><SkeletonRows rows={8} /></div>
  if (!q.data) return <div className="page ph-page"><ErrorBox error={q.error} retry={() => q.refetch()} /></div>
  const s = q.data
  const bucket = (b: Bucket, label: string) => (
    <Tile label={label} value={fmtBytes(b.total_kb)} sub={<>{n(b.count)} items · optimized {fmtBytes(b.optimized_kb)}{b.overhead_kb ? ` · originals/RAW ${fmtBytes(b.overhead_kb)}` : ''}{b.length_s ? ` · ${fmtDuration(b.length_s)} total` : ''}</>} />
  )
  const bars = (rows: { name: string; total_kb: number; count: number }[]) =>
    <HBars items={rows.slice(0, 8).map((r) => ({ key: r.name, label: r.name, value: r.total_kb, title: `${r.name}: ${fmtBytes(r.total_kb)} in ${n(r.count)} items` }))} format={fmtBytes} />
  return (
    <div className="page ph-page">
      <div className="page-head"><div className="grow"><h1>Storage</h1><p className="sub">{fmtBytes(s.all.total_kb)} for {n(s.all.count)} items</p></div></div>
      <div className="ex-tiles">{bucket(s.all, 'Everything')}{bucket(s.photo, 'Photos')}{bucket(s.video, 'Videos')}</div>
      <div className="ex-grid">
        <Card title="By year">{bars(s.by_year.map((y) => ({ name: String(y.year), total_kb: y.total_kb, count: y.count })))}</Card>
        <Card title="By library">{bars(s.by_library)}</Card>
        <Card title="By camera">{bars(s.by_camera)}</Card>
        <Card title="By type">{bars(s.by_type)}</Card>
        <Card title="Largest items" className="wide">
          <div className="ex-largest">
            {s.largest.slice(0, 12).map((p) => {
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
