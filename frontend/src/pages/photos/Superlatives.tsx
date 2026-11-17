// Photos › Superlatives: every ranking from GET /photos/superlatives/{category}?limit= (one request per
// ranking and size, cached for an hour; the server counts an original imported as its own item once).
// Item rankings list photos with the number they're ranked by (select some to delete, Shift for a range;
// the viewer steps through the ranking); day rankings list local days.
import { memo, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Icon } from '../../components/Icon'
import { Button, ErrorBox, SkeletonRows, buttonClass, fieldClass } from '../../components/ui'
import { get, safeHref } from '../../lib/api'
import { cn } from '../../lib/cn'
import { fmtDate } from '../../lib/dates'
import { fmtBytes, plural } from '../../lib/format'
import type { Photo } from '../../lib/types'
import { refreshAll } from './actions'
import { DeleteDialog } from './DeleteDialog'
import { PageHead, pageClass } from './PageHead'
import { photoQuery } from './queries'
import { StatTile, helpClass } from './StatCards'
import { createSelection } from './store'
import { useParamSetter } from './useParamSetter'
import { usePhotoParam } from './usePhotoParam'
import { fmtDuration, fmtHms } from './util'
import { Viewer } from './Viewer'

const HOUR = 60 * 60_000
const LIMITS = [20, 50, 100, 200] as const

type Metric = 'total' | 'length' | 'mp' | 'overhead'
const CATS = [
  {
    id: 'biggest-files',
    name: 'Disk footprint',
    desc: 'Items ranked by total disk space, with the originals and RAW files kept next to them.',
    kind: 'item',
    metric: 'total',
  },
  { id: 'longest-videos', name: 'Longest videos', desc: 'Individual videos ranked by length.', kind: 'item', metric: 'length' },
  {
    id: 'biggest-orig-videos',
    name: 'Original videos',
    desc: 'Videos that still have their uncompressed original, by total size.',
    kind: 'item',
    metric: 'total',
  },
  { id: 'biggest-resolution', name: 'Highest resolution', desc: 'Items ranked by megapixels.', kind: 'item', metric: 'mp' },
  { id: 'biggest-photos', name: 'Largest photos', desc: 'Photos (not videos) ranked by total size.', kind: 'item', metric: 'total' },
  {
    id: 'biggest-overhead',
    name: 'Overhead gap',
    desc: 'The biggest gaps between the optimized file and everything kept for it (originals, RAW).',
    kind: 'item',
    metric: 'overhead',
  },
  { id: 'biggest-raw', name: 'RAW files', desc: 'Photos with a RAW file attached, by total size.', kind: 'item', metric: 'total' },
  { id: 'day-most-photos', name: 'Most photos', desc: 'Days with the most photos taken.', kind: 'day', metric: 'photos' },
  { id: 'day-most-videos', name: 'Most videos', desc: 'Days with the most videos recorded.', kind: 'day', metric: 'videos' },
  { id: 'day-most-storage', name: 'Most storage', desc: 'Days with the largest total storage footprint.', kind: 'day', metric: 'size' },
  {
    id: 'day-longest-video-time',
    name: 'Most video time',
    desc: 'Days with the longest combined video length.',
    kind: 'day',
    metric: 'length',
  },
] as const
type Cat = (typeof CATS)[number]

interface RankedItem {
  id: string
  thumb_url: string
  filename: string
  library: string
  owner: string
  video: boolean
  date_taken: string | null
  size_kb: number
  size_total_kb: number
  length_s: number | null
  megapixels: number | null
  width: number | null
  height: number | null
  has_raw: boolean
  has_orig: boolean
}
interface RankedDay {
  date: string
  photos: number
  videos: number
  size_kb: number
  length_s: number
}
interface Summary {
  count: number
  photos: number
  videos: number
  size_kb: number
  size_total_kb: number
  length_s: number
  max_megapixels: number | null
}
interface Out {
  category: string
  kind: 'item' | 'day'
  items: RankedItem[]
  days: RankedDay[]
  summary: Summary | null
}

/** The picked items of the ranking on screen (one ranking at a time, so one store). */
const picks = createSelection<RankedItem>((p) => p.id)

export function SuperlativesPage() {
  const [params, setParam] = useParamSetter()
  const cat: Cat = CATS.find((c) => c.id === params.get('cat')) ?? CATS[0]
  const limit = LIMITS.find((n) => String(n) === params.get('limit')) ?? 50
  const q = useQuery({
    queryKey: ['photos', 'superlatives', cat.id, limit],
    queryFn: ({ signal }) => get<Out>(`photos/superlatives/${cat.id}`, { limit }, signal),
    staleTime: HOUR,
    placeholderData: (prev) => (prev?.category === cat.id ? prev : undefined), // a bigger top N keeps the list while it loads
  })
  const chip = (c: Cat) => (
    <button
      key={c.id}
      type="button"
      role="tab"
      aria-selected={cat.id === c.id}
      className={cn(
        'inline-flex h-7 cursor-pointer items-center gap-1 rounded-full border px-3 text-sm font-medium whitespace-nowrap',
        cat.id === c.id ? 'border-transparent bg-accent-soft text-accent' : 'border-border bg-surface-2 text-muted hover:text-fg',
      )}
      onClick={() => setParam('cat', c.id)}
    >
      {c.name}
    </button>
  )
  const group =
    'mr-0.5 ml-1 text-xs font-semibold tracking-[0.04em] text-muted uppercase md:not-first:ml-3 max-md:not-first:mt-1 max-md:not-first:basis-full'
  return (
    <div className={pageClass(true)}>
      <PageHead title="Superlatives" sub="Rankings across your visible libraries">
        <select
          className={cn(fieldClass.select, 'w-auto! text-xs!')}
          value={limit}
          onChange={(e) => setParam('limit', e.target.value)}
          aria-label="How many to show"
        >
          {LIMITS.map((n) => (
            <option key={n} value={n}>
              Top {n}
            </option>
          ))}
        </select>
      </PageHead>
      <div className="mb-2 flex flex-wrap items-center gap-1.5" role="tablist" aria-label="Ranking">
        <span className={group}>Items</span>
        {CATS.filter((c) => c.kind === 'item').map(chip)}
        <span className={group}>Days</span>
        {CATS.filter((c) => c.kind === 'day').map(chip)}
      </div>
      <p className={cn(helpClass, 'mb-3')}>{cat.desc}</p>
      {q.data && q.data.category === cat.id ? (
        <>
          {q.isError && <ErrorBox error={q.error} retry={() => q.refetch()} />}
          {cat.kind === 'item' ? (
            <Items data={q.data} metric={cat.metric as Metric} loading={q.isFetching} />
          ) : (
            <Days days={q.data.days} metric={cat.metric} />
          )}
        </>
      ) : q.isError ? (
        <ErrorBox error={q.error} retry={() => q.refetch()} />
      ) : (
        <SkeletonRows rows={8} />
      )}
    </div>
  )
}

const longDate = (iso: string | null) => (iso ? fmtDate(new Date(iso), { month: 'short', day: 'numeric', year: 'numeric' }) : 'Undated')

function metricOf(p: RankedItem, m: Metric): { value: string; sub: string } {
  const opt = fmtBytes(p.size_kb)
  const tot = fmtBytes(p.size_total_kb)
  const gap = Math.max(0, p.size_total_kb - p.size_kb)
  if (m === 'length') return { value: fmtDuration(p.length_s) || '0:00', sub: tot }
  if (m === 'mp')
    return { value: p.megapixels ? `${p.megapixels.toFixed(1)} MP` : '—', sub: p.width && p.height ? `${p.width} × ${p.height}` : tot }
  if (m === 'overhead') return { value: fmtBytes(gap), sub: `${opt} → ${tot}` }
  return { value: tot, sub: gap > 0 ? `${opt} optimized · +${fmtBytes(gap)}` : 'no original kept' }
}

/** A ranked item as the viewer needs it until its full record loads (thumbnail as the placeholder). */
const asPhoto = (p: RankedItem): Photo => ({
  id: p.id,
  thumb_url: p.thumb_url,
  url: '',
  width: p.width,
  height: p.height,
  aspect: p.width && p.height ? p.width / p.height : 1,
  date_taken: p.date_taken,
  video: p.video,
  length: p.length_s,
  city: null,
  country: null,
  lat: null,
  lon: null,
  camera: null,
  album_id: 0,
  size_kb: p.size_kb,
  size_total_kb: p.size_total_kb,
  megapixels: p.megapixels,
  has_raw: p.has_raw,
  has_orig: p.has_orig,
})

/** The viewer over the ranking, in rank order: the open item is its full record (GET /photos/{id}). */
function RankingViewer({ items, id, onGo, onClose }: { items: RankedItem[]; id: string; onGo: (id: string) => void; onClose: () => void }) {
  const full = useQuery(photoQuery(id)).data
  const photos = useMemo(() => items.map((p) => (p.id === id && full?.id === id ? full : asPhoto(p))), [items, id, full])
  return <Viewer id={id} items={photos} onGo={onGo} onClose={onClose} />
}

const listClass = 'm-0 mb-3 grid max-w-[64rem] list-none gap-px rounded-md border border-border bg-surface p-1'
const rowClass = 'flex items-center gap-3 rounded-sm px-2 py-1.5 text-sm max-md:gap-2'
const rankClass = (top: boolean) =>
  cn(
    'flex-none text-center text-xs font-semibold tabular-nums',
    top ? 'mx-0.5 inline-grid size-6 place-items-center rounded-full bg-accent-soft text-accent' : 'w-7 text-muted',
  )
const metaClass = 'flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-xs text-muted tabular-nums'
const metaChip =
  'inline-flex h-[1.125rem] items-center gap-1 rounded-full border border-border bg-surface-2 px-1.5 text-2xs font-semibold whitespace-nowrap text-muted'
const metricClass = 'grid max-w-48 flex-none justify-items-end gap-0.5 text-right max-md:max-w-28'
const metricValue = 'text-md whitespace-nowrap tabular-nums max-md:text-sm'

function Items({ data, metric, loading }: { data: Out; metric: Metric; loading: boolean }) {
  const viewer = usePhotoParam()
  const qc = useQueryClient()
  const [confirm, setConfirm] = useState(false)
  const items = data.items
  const s = data.summary
  // A new ranking starts with nothing picked; leaving the page drops the selection.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the category is the trigger
  useEffect(() => {
    picks.setMode(false)
    return () => picks.setMode(false)
  }, [data.category])
  const count = picks.useSelect((x) => x.picked.size)
  const all = count > 0 && items.every((p) => picks.get().picked.has(p.id))
  if (!items.length) return <div className="p-4 text-sm text-muted">Nothing to rank here yet.</div>
  return (
    <>
      {s && (
        <div className="mb-3 grid max-w-[64rem] grid-cols-[repeat(auto-fill,minmax(12rem,1fr))] gap-3 max-md:grid-cols-2">
          <StatTile label="Items" value={s.count.toLocaleString()} sub={`${plural(s.photos, 'photo')} · ${plural(s.videos, 'video')}`} />
          <StatTile
            label="Total on disk"
            value={fmtBytes(s.size_total_kb)}
            sub={`${fmtBytes(s.size_kb)} optimized · ${fmtBytes(Math.max(0, s.size_total_kb - s.size_kb))} overhead`}
          />
          {s.videos > 0 && <StatTile label="Video time" value={fmtHms(s.length_s)} sub={plural(s.videos, 'video')} />}
          {s.max_megapixels != null && <StatTile label="Highest resolution" value={`${s.max_megapixels.toFixed(1)} MP`} />}
        </div>
      )}
      <div className={cn('mb-1 flex min-h-9 max-w-[64rem] items-center gap-2 rounded-md px-2', count > 0 && 'bg-accent-soft')}>
        <label className="inline-flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="m-0 size-4 flex-none cursor-pointer"
            checked={all}
            ref={(el) => {
              if (el) el.indeterminate = count > 0 && !all
            }}
            onChange={() => (all ? picks.clear() : picks.setMany(items, true))}
            aria-label="Select all"
          />
          <span>{count ? `${count} selected` : 'Select'}</span>
        </label>
        {count > 0 && (
          <>
            <Button size="sm" variant="ghost" onClick={picks.clear}>
              Clear
            </Button>
            <span className="flex-1" />
            <Button size="sm" variant="danger" onClick={() => setConfirm(true)}>
              <Icon name="trash" size={14} />
              <span>Delete selected</span>
            </Button>
          </>
        )}
        {loading && <span className="spinner" role="status" aria-label="Loading" />}
      </div>
      <ol className={listClass}>
        {items.map((p, i) => (
          <ItemRow key={p.id} p={p} rank={i + 1} metric={metric} items={items} onOpen={viewer.open} />
        ))}
      </ol>
      <p className={helpClass}>
        Open an item to delete it or just its original from the viewer's menu. Deleting needs owner or editor access to the library.
      </p>
      {confirm && (
        <DeleteDialog
          ids={[...picks.get().picked.keys()]}
          onClose={() => setConfirm(false)}
          onDone={() => {
            picks.setMode(false)
            refreshAll(qc)
          }}
        />
      )}
      {viewer.current && <RankingViewer items={items} id={viewer.current} onGo={viewer.go} onClose={viewer.close} />}
    </>
  )
}

/** One ranked item; subscribed only to its own picked state, so ticking one row re-renders that row. */
const ItemRow = memo(function ItemRow({
  p,
  rank,
  metric,
  items,
  onOpen,
}: {
  p: RankedItem
  rank: number
  metric: Metric
  items: RankedItem[]
  onOpen: (id: string) => void
}) {
  const picked = picks.useSelect((x) => x.picked.has(p.id))
  const src = safeHref(p.thumb_url)
  const m = metricOf(p, metric)
  const dims = p.width && p.height ? `${p.width} × ${p.height}` : ''
  return (
    <li className={cn(rowClass, picked ? 'bg-accent-soft' : 'hover:bg-hover')}>
      <input
        type="checkbox"
        className="m-0 size-4 flex-none cursor-pointer"
        checked={picked}
        onChange={() => undefined}
        onClick={(e) => picks.toggle(p, items, e.shiftKey)}
        aria-label={`Select ${p.filename}`}
      />
      {/* On phones only the top three keep their badge (the classic layout); the rest give the name room. */}
      <span className={cn(rankClass(rank <= 3), rank > 3 && 'max-md:hidden')}>{rank}</span>
      <button
        type="button"
        className="relative size-12 flex-none cursor-zoom-in overflow-hidden rounded-sm border-0 bg-surface-2 p-0"
        onClick={() => onOpen(p.id)}
        aria-label={`View ${p.filename}`}
      >
        {src && <img src={src} alt="" loading="lazy" className="size-full object-cover" />}
        {p.video && (
          <span className="absolute right-0.5 bottom-0.5 inline-flex items-center gap-0.5 rounded-full bg-black/55 px-1 py-px text-3xs font-semibold text-white tabular-nums [&_svg]:fill-current [&_svg]:stroke-none">
            <Icon name="play" size={10} />
            {p.length_s ? fmtDuration(p.length_s) : ''}
          </span>
        )}
      </button>
      <span className="grid min-w-0 flex-1 gap-0.5">
        <span className="truncate font-medium" title={p.filename}>
          {p.filename}
        </span>
        <span className={metaClass}>
          <span>{longDate(p.date_taken)}</span>
          <span>{p.library}</span>
          <span>@{p.owner}</span>
          {dims && (
            <span>
              {dims}
              {p.megapixels ? ` · ${p.megapixels.toFixed(1)} MP` : ''}
            </span>
          )}
          {p.has_raw && <span className={metaChip}>RAW</span>}
          {p.has_orig && <span className={metaChip}>ORIG</span>}
        </span>
      </span>
      <span className={metricClass}>
        <strong className={metricValue}>{m.value}</strong>
        <span className="text-xs text-muted tabular-nums">{m.sub}</span>
      </span>
    </li>
  )
})

function Days({ days, metric }: { days: RankedDay[]; metric: string }) {
  if (!days.length) return <div className="p-4 text-sm text-muted">No days to rank yet.</div>
  const value = (d: RankedDay) =>
    metric === 'photos'
      ? plural(d.photos, 'photo')
      : metric === 'videos'
        ? plural(d.videos, 'video')
        : metric === 'length'
          ? fmtHms(d.length_s)
          : fmtBytes(d.size_kb)
  return (
    <ol className={listClass}>
      {days.map((d, i) => {
        const [y, mo, da] = d.date.split('-').map(Number)
        const label = fmtDate(new Date(y, mo - 1, da), { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
        return (
          <li key={d.date} className={cn(rowClass, 'hover:bg-hover')}>
            <span className={rankClass(i < 3)}>{i + 1}</span>
            <span className="grid min-w-0 flex-1 gap-0.5">
              <Link className="font-medium text-fg" to={`/photos/day/${d.date}`}>
                {label}
              </Link>
              <span className={metaClass}>
                <span>{plural(d.photos, 'photo')}</span>
                {d.videos > 0 && <span>{plural(d.videos, 'video')}</span>}
                <span>{fmtBytes(d.size_kb)}</span>
                {d.length_s > 0 && <span>{fmtHms(d.length_s)} of video</span>}
              </span>
            </span>
            <span className={metricClass}>
              <strong className={metricValue}>{value(d)}</strong>
            </span>
            <Link className={buttonClass({ size: 'sm', className: 'max-md:hidden' })} to={`/photos/day/${d.date}`}>
              View day
            </Link>
          </li>
        )
      })}
    </ol>
  )
}
