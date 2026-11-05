// Photos › Superlatives. There's no superlatives endpoint: "Disk footprint" comes from /photos/storage
// (its top 12 largest items) and the single-day rankings from /photos/days, one request per year with
// photos (cached for an hour). The other classic rankings link to the classic page.
import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { useQueries, useQuery } from '@tanstack/react-query'
import { get, safeHref } from '../../lib/api'
import { photoSummaryQuery } from '../../lib/photoQueries'
import { fmtDate, parseDayKey } from '../../lib/dates'
import type { PhotoSummary } from '../../lib/types'
import { Icon } from '../../components/Icon'
import { ErrorBox, SkeletonRows } from '../../components/ui'
import { usePhotoParam } from './PhotoStream'
import { Viewer } from './Viewer'
import { PageHead, plural } from './parts'
import { fmtBytes } from './util'

const HOUR = 60 * 60_000
type Largest = { id: string; thumb_url: string; size_kb: number; video: boolean; date_taken: string | null }
type DayInfo = { photos: number; videos: number; size_kb: number }

const CATS = [
  { id: 'biggest-files', name: 'Disk footprint', desc: 'Media items ranked by total disk space (with originals and RAW).', kind: 'item' },
  { id: 'day-most-photos', name: 'Most photos in a day', desc: 'Days with the most photos taken.', kind: 'day' },
  { id: 'day-most-videos', name: 'Most videos in a day', desc: 'Days with the most videos recorded.', kind: 'day' },
  { id: 'day-most-storage', name: 'Most storage in a day', desc: 'Days with the largest total storage footprint.', kind: 'day' },
] as const
type CatId = (typeof CATS)[number]['id']
// Classic rankings the API can't compute yet.
const CLASSIC_ONLY = [
  ['longest-videos', 'Longest videos'], ['biggest-orig-videos', 'Original videos'], ['biggest-resolution', 'Highest resolution'],
  ['biggest-photos', 'Largest photos'], ['biggest-overhead', 'Overhead gap'], ['biggest-raw', 'RAW files'], ['day-longest-video-time', 'Most video time in a day'],
] as const

export function SuperlativesPage() {
  const [params, setParams] = useSearchParams()
  const cat = CATS.find((c) => c.id === params.get('cat')) ?? CATS[0]
  const go = (id: CatId) => {
    const p = new URLSearchParams(params)
    p.set('cat', id)
    p.delete('photo')
    setParams(p, { replace: true })
  }
  return (
    <div className="page ph-page">
      <PageHead title="Superlatives" sub="Rankings across your visible libraries" />
      <div className="ph-sup-cats" role="tablist" aria-label="Ranking">
        {CATS.map((c) => (
          <button key={c.id} role="tab" aria-selected={cat.id === c.id} className={'chip' + (cat.id === c.id ? ' accent' : '')} onClick={() => go(c.id)}>{c.name}</button>
        ))}
        {CLASSIC_ONLY.map(([id, name]) => (
          <a key={id} className="chip ph-sup-classic" href={`/photos/superlatives/${id}/`} title="Not in the new API yet: opens the classic page">{name}<Icon name="external" size={10} /></a>
        ))}
      </div>
      <p className="help" style={{ margin: '0 0 0.75rem' }}>{cat.desc}</p>
      {cat.kind === 'item' ? <Largest /> : <TopDays metric={cat.id as Exclude<CatId, 'biggest-files'>} />}
    </div>
  )
}

function Largest() {
  const q = useQuery({ queryKey: ['photos', 'storage'], queryFn: () => get<{ largest: Largest[] }>('photos/storage'), staleTime: HOUR })
  const viewer = usePhotoParam()
  if (q.isPending) return <SkeletonRows rows={6} />
  if (!q.data) return <ErrorBox error={q.error} retry={() => q.refetch()} />
  const total = q.data.largest.reduce((t, p) => t + p.size_kb, 0)
  return (
    <>
      <div className="ph-sup-kpis">
        <div className="card ex-tile"><span className="label">Top {q.data.largest.length} together</span><span className="ex-value tabular">{fmtBytes(total)}</span></div>
        <div className="card ex-tile"><span className="label">Photos · videos</span><span className="ex-value tabular">{q.data.largest.filter((p) => !p.video).length} · {q.data.largest.filter((p) => p.video).length}</span></div>
      </div>
      <ol className="ph-sup-list">
        {q.data.largest.map((p, i) => {
          const src = safeHref(p.thumb_url)
          return (
            <li key={p.id}>
              <span className={'ph-rank' + (i < 3 ? ' top' : '')}>{i + 1}</span>
              <button className="ph-sup-thumb" onClick={() => viewer.open(p.id)} aria-label="View">{src && <img src={src} alt="" loading="lazy" />}{p.video && <span className="ph-video"><Icon name="play" size={10} /></span>}</button>
              <span className="grow" style={{ minWidth: 0 }}>
                <span style={{ display: 'block' }}>{p.date_taken ? fmtDate(new Date(p.date_taken), { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) : 'Undated'}</span>
                <span className="muted xsmall">{p.video ? 'Video' : 'Photo'}</span>
              </span>
              <strong className="tabular">{fmtBytes(p.size_kb)}</strong>
              <button className="btn sm" onClick={() => viewer.open(p.id)}>View</button>
            </li>
          )
        })}
      </ol>
      <p className="help">The API returns the 12 largest items. Open one to delete it or its original from the viewer's menu.</p>
      {viewer.current && <Viewer id={viewer.current} items={[]} onGo={viewer.go} onClose={viewer.close} />}
    </>
  )
}

function TopDays({ metric }: { metric: 'day-most-photos' | 'day-most-videos' | 'day-most-storage' }) {
  const [limit, setLimit] = useState(20)
  const summary = useQuery(photoSummaryQuery<PhotoSummary>())
  const years = (summary.data?.per_year ?? []).map((y) => y.year).filter((y) => y > 1900)
  const qs = useQueries({
    queries: years.map((y) => ({
      queryKey: ['photos', 'days', `${y}-01-01`, `${y}-12-31`],
      queryFn: () => get<Record<string, DayInfo>>('photos/days', { start: `${y}-01-01`, end: `${y}-12-31` }),
      staleTime: HOUR,
    })),
  })
  const loading = summary.isPending || qs.some((q) => q.isPending)
  const ranked = useMemo(() => {
    const all: [string, DayInfo][] = qs.flatMap((q) => Object.entries(q.data ?? {}))
    const val = (d: DayInfo) => (metric === 'day-most-photos' ? d.photos : metric === 'day-most-videos' ? d.videos : d.size_kb)
    return all.filter(([, d]) => val(d) > 0).sort((a, b) => val(b[1]) - val(a[1]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metric, qs.map((q) => q.dataUpdatedAt).join()])
  if (loading && !ranked.length) return <SkeletonRows rows={8} />
  const err = qs.find((q) => q.isError)
  return (
    <>
      {err && <ErrorBox error={err.error} retry={() => err.refetch()} />}
      <ol className="ph-sup-list">
        {ranked.slice(0, limit).map(([key, d], i) => (
          <li key={key}>
            <span className={'ph-rank' + (i < 3 ? ' top' : '')}>{i + 1}</span>
            <span className="grow" style={{ minWidth: 0 }}>
              <Link to={`/photos/day/${key}`} style={{ display: 'block' }}>{fmtDate(parseDayKey(key), { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}</Link>
              <span className="muted xsmall tabular">{[plural(d.photos, 'photo'), d.videos ? plural(d.videos, 'video') : '', fmtBytes(d.size_kb)].filter(Boolean).join(' · ')}</span>
            </span>
            <strong className="tabular">{metric === 'day-most-photos' ? plural(d.photos, 'photo') : metric === 'day-most-videos' ? plural(d.videos, 'video') : fmtBytes(d.size_kb)}</strong>
            <Link className="btn sm" to={`/photos/day/${key}`}>View day</Link>
          </li>
        ))}
      </ol>
      {!ranked.length && !loading && <div className="empty left">No days to rank yet.</div>}
      {ranked.length > limit && <button className="btn sm" onClick={() => setLimit((l) => l + 30)}>Show more</button>}
    </>
  )
}
