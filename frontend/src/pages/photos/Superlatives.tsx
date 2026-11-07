// Photos › Superlatives: every ranking from GET /photos/superlatives/{category}?limit= (one request per
// ranking and size, cached for an hour; the server counts an original imported as its own item once).
// Item rankings list photos with the number they're ranked by; day rankings list local days.
import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { get, safeHref } from '../../lib/api'
import { fmtDate } from '../../lib/dates'
import { Icon } from '../../components/Icon'
import { ErrorBox, SkeletonRows } from '../../components/ui'
import { usePhotoParam } from './PhotoStream'
import { Viewer } from './Viewer'
import { DeleteDialog } from './select'
import { refreshAll } from './actions'
import { PageHead, plural } from './parts'
import { fmtBytes, fmtDuration, fmtHms } from './util'
import './superlatives.css'

const HOUR = 60 * 60_000
const LIMITS = [20, 50, 100, 200] as const

type Metric = 'total' | 'length' | 'mp' | 'overhead'
const CATS = [
  { id: 'biggest-files', name: 'Disk footprint', desc: 'Items ranked by total disk space, with the originals and RAW files kept next to them.', kind: 'item', metric: 'total' },
  { id: 'longest-videos', name: 'Longest videos', desc: 'Individual videos ranked by length.', kind: 'item', metric: 'length' },
  { id: 'biggest-orig-videos', name: 'Original videos', desc: 'Videos that still have their uncompressed original, by total size.', kind: 'item', metric: 'total' },
  { id: 'biggest-resolution', name: 'Highest resolution', desc: 'Items ranked by megapixels.', kind: 'item', metric: 'mp' },
  { id: 'biggest-photos', name: 'Largest photos', desc: 'Photos (not videos) ranked by total size.', kind: 'item', metric: 'total' },
  { id: 'biggest-overhead', name: 'Overhead gap', desc: 'The biggest gaps between the optimized file and everything kept for it (originals, RAW).', kind: 'item', metric: 'overhead' },
  { id: 'biggest-raw', name: 'RAW files', desc: 'Photos with a RAW file attached, by total size.', kind: 'item', metric: 'total' },
  { id: 'day-most-photos', name: 'Most photos', desc: 'Days with the most photos taken.', kind: 'day', metric: 'photos' },
  { id: 'day-most-videos', name: 'Most videos', desc: 'Days with the most videos recorded.', kind: 'day', metric: 'videos' },
  { id: 'day-most-storage', name: 'Most storage', desc: 'Days with the largest total storage footprint.', kind: 'day', metric: 'size' },
  { id: 'day-longest-video-time', name: 'Most video time', desc: 'Days with the longest combined video length.', kind: 'day', metric: 'length' },
] as const
type Cat = (typeof CATS)[number]

interface RankedItem {
  id: string; thumb_url: string; filename: string; library: string; owner: string; video: boolean
  date_taken: string | null; size_kb: number; size_total_kb: number; length_s: number | null
  megapixels: number | null; width: number | null; height: number | null; has_raw: boolean; has_orig: boolean
}
interface RankedDay { date: string; photos: number; videos: number; size_kb: number; length_s: number }
interface Summary { count: number; photos: number; videos: number; size_kb: number; size_total_kb: number; length_s: number; max_megapixels: number | null }
interface Out { category: string; kind: 'item' | 'day'; items: RankedItem[]; days: RankedDay[]; summary: Summary | null }

export function SuperlativesPage() {
  const [params, setParams] = useSearchParams()
  const cat: Cat = CATS.find((c) => c.id === params.get('cat')) ?? CATS[0]
  const limit = LIMITS.find((n) => String(n) === params.get('limit')) ?? 50
  const set = (k: 'cat' | 'limit', v: string) => {
    const p = new URLSearchParams(params)
    p.set(k, v)
    p.delete('photo')
    setParams(p, { replace: true })
  }
  const q = useQuery({
    queryKey: ['photos', 'superlatives', cat.id, limit],
    queryFn: ({ signal }) => get<Out>(`photos/superlatives/${cat.id}`, { limit }, signal),
    staleTime: HOUR,
    placeholderData: (prev) => (prev?.category === cat.id ? prev : undefined), // a bigger top N keeps the list while it loads
  })
  const chip = (c: Cat) => (
    <button key={c.id} role="tab" aria-selected={cat.id === c.id} className={'chip' + (cat.id === c.id ? ' accent' : '')} onClick={() => set('cat', c.id)}>{c.name}</button>
  )
  return (
    <div className="page ph-page">
      <PageHead title="Superlatives" sub="Rankings across your visible libraries">
        <select className="select sm-select" value={limit} onChange={(e) => set('limit', e.target.value)} aria-label="How many to show">
          {LIMITS.map((n) => <option key={n} value={n}>Top {n}</option>)}
        </select>
      </PageHead>
      <div className="sup-cats" role="tablist" aria-label="Ranking">
        <span className="sup-group">Items</span>
        {CATS.filter((c) => c.kind === 'item').map(chip)}
        <span className="sup-group">Days</span>
        {CATS.filter((c) => c.kind === 'day').map(chip)}
      </div>
      <p className="help sup-desc">{cat.desc}</p>
      {q.data && q.data.category === cat.id ? (
        <>
          {q.isError && <ErrorBox error={q.error} retry={() => q.refetch()} />}
          {cat.kind === 'item'
            ? <Items data={q.data} metric={cat.metric as Metric} loading={q.isFetching} />
            : <Days days={q.data.days} metric={cat.metric} />}
        </>
      ) : q.isError ? <ErrorBox error={q.error} retry={() => q.refetch()} /> : <SkeletonRows rows={8} />}
    </div>
  )
}

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="card ex-tile">
      <span className="label">{label}</span>
      <span className="ex-value tabular">{value}</span>
      {sub && <span className="muted xsmall tabular ex-tile-sub">{sub}</span>}
    </div>
  )
}

const longDate = (iso: string | null) => (iso ? fmtDate(new Date(iso), { month: 'short', day: 'numeric', year: 'numeric' }) : 'Undated')

function metricOf(p: RankedItem, m: Metric): { value: string; sub: string } {
  const opt = fmtBytes(p.size_kb), tot = fmtBytes(p.size_total_kb)
  const gap = Math.max(0, p.size_total_kb - p.size_kb)
  if (m === 'length') return { value: fmtDuration(p.length_s) || '0:00', sub: tot }
  if (m === 'mp') return { value: p.megapixels ? `${p.megapixels.toFixed(1)} MP` : '—', sub: p.width && p.height ? `${p.width} × ${p.height}` : tot }
  if (m === 'overhead') return { value: fmtBytes(gap), sub: `${opt} → ${tot}` }
  return { value: tot, sub: gap > 0 ? `${opt} optimized · +${fmtBytes(gap)}` : 'no original kept' }
}

function Items({ data, metric, loading }: { data: Out; metric: Metric; loading: boolean }) {
  const viewer = usePhotoParam()
  const qc = useQueryClient()
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [confirm, setConfirm] = useState(false)
  useEffect(() => setPicked(new Set()), [data.category]) // a new ranking starts with nothing picked
  const items = data.items
  const s = data.summary
  const toggle = (id: string) => setPicked((old) => { const n = new Set(old); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const all = items.length > 0 && items.every((p) => picked.has(p.id))
  if (!items.length) return <div className="empty left">Nothing to rank here yet.</div>
  return (
    <>
      {s && (
        <div className="ph-sup-kpis">
          <Kpi label="Items" value={s.count.toLocaleString()} sub={`${plural(s.photos, 'photo')} · ${plural(s.videos, 'video')}`} />
          <Kpi label="Total on disk" value={fmtBytes(s.size_total_kb)} sub={`${fmtBytes(s.size_kb)} optimized · ${fmtBytes(Math.max(0, s.size_total_kb - s.size_kb))} overhead`} />
          {s.videos > 0 && <Kpi label="Video time" value={fmtHms(s.length_s)} sub={plural(s.videos, 'video')} />}
          {s.max_megapixels != null && <Kpi label="Highest resolution" value={`${s.max_megapixels.toFixed(1)} MP`} />}
        </div>
      )}
      <div className={'sup-bar' + (picked.size ? ' on' : '')}>
        <label className="sup-check">
          <input type="checkbox" checked={all} ref={(el) => { if (el) el.indeterminate = picked.size > 0 && !all }}
            onChange={() => setPicked(all ? new Set() : new Set(items.map((p) => p.id)))} aria-label="Select all" />
          <span>{picked.size ? `${picked.size} selected` : 'Select'}</span>
        </label>
        {picked.size > 0 && (
          <>
            <button className="btn sm ghost" onClick={() => setPicked(new Set())}>Clear</button>
            <span className="spacer" />
            <button className="btn sm danger" onClick={() => setConfirm(true)}><Icon name="trash" size={14} /><span>Delete selected</span></button>
          </>
        )}
        {loading && <span className="spinner sm" aria-label="Loading" />}
      </div>
      <ol className="ph-sup-list sup-items">
        {items.map((p, i) => {
          const src = safeHref(p.thumb_url)
          const m = metricOf(p, metric)
          const dims = p.width && p.height ? `${p.width} × ${p.height}` : ''
          return (
            <li key={p.id} className={picked.has(p.id) ? 'picked' : undefined}>
              <input type="checkbox" className="sup-row-check" checked={picked.has(p.id)} onChange={() => toggle(p.id)} aria-label={`Select ${p.filename}`} />
              <span className={'ph-rank' + (i < 3 ? ' top' : '')}>{i + 1}</span>
              <button className="ph-sup-thumb" onClick={() => viewer.open(p.id)} aria-label={`View ${p.filename}`}>
                {src && <img src={src} alt="" loading="lazy" />}
                {p.video && <span className="ph-video"><Icon name="play" size={10} />{p.length_s ? fmtDuration(p.length_s) : ''}</span>}
              </button>
              <span className="sup-main">
                <span className="sup-name truncate" title={p.filename}>{p.filename}</span>
                <span className="sup-meta muted xsmall tabular">
                  <span>{longDate(p.date_taken)}</span>
                  <span>{p.library}</span>
                  <span>@{p.owner}</span>
                  {dims && <span>{dims}{p.megapixels ? ` · ${p.megapixels.toFixed(1)} MP` : ''}</span>}
                  {p.has_raw && <span className="chip xs">RAW</span>}
                  {p.has_orig && <span className="chip xs">ORIG</span>}
                </span>
              </span>
              <span className="sup-metric">
                <strong className="tabular">{m.value}</strong>
                <span className="muted xsmall tabular">{m.sub}</span>
              </span>
            </li>
          )
        })}
      </ol>
      <p className="help">Open an item to delete it or just its original from the viewer's menu. Deleting needs owner or editor access to the library.</p>
      {confirm && <DeleteDialog ids={[...picked]} onClose={() => setConfirm(false)} onDone={() => (setPicked(new Set()), refreshAll(qc))} />}
      {viewer.current && <Viewer id={viewer.current} items={[]} onGo={viewer.go} onClose={viewer.close} />}
    </>
  )
}

function Days({ days, metric }: { days: RankedDay[]; metric: string }) {
  if (!days.length) return <div className="empty left">No days to rank yet.</div>
  const value = (d: RankedDay) =>
    metric === 'photos' ? plural(d.photos, 'photo') : metric === 'videos' ? plural(d.videos, 'video')
      : metric === 'length' ? fmtHms(d.length_s) : fmtBytes(d.size_kb)
  return (
    <ol className="ph-sup-list sup-days">
      {days.map((d, i) => {
        const [y, mo, da] = d.date.split('-').map(Number)
        const label = fmtDate(new Date(y, mo - 1, da), { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
        return (
          <li key={d.date}>
            <span className={'ph-rank' + (i < 3 ? ' top' : '')}>{i + 1}</span>
            <span className="sup-main">
              <Link className="sup-name" to={`/photos/day/${d.date}`}>{label}</Link>
              <span className="sup-meta muted xsmall tabular">
                <span>{plural(d.photos, 'photo')}</span>
                {d.videos > 0 && <span>{plural(d.videos, 'video')}</span>}
                <span>{fmtBytes(d.size_kb)}</span>
                {d.length_s > 0 && <span>{fmtHms(d.length_s)} of video</span>}
              </span>
            </span>
            <span className="sup-metric"><strong className="tabular">{value(d)}</strong></span>
            <Link className="btn sm sup-day-btn" to={`/photos/day/${d.date}`}>View day</Link>
          </li>
        )
      })}
    </ol>
  )
}
