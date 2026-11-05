// An infinite, day-grouped, justified photo stream (timeline or one album) + the viewer.
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { useInfiniteQuery, useQueries } from '@tanstack/react-query'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router'
import { get, safeHref } from '../../lib/api'
import { dayKey, fmtDate, groupByDay } from '../../lib/dates'
import { dayLabel, fmtBytes, fmtDuration } from './util'
import { SelectionBar, labelText, select, selection, tileLabel, tileTitle } from './select'
import { justify } from '../../lib/justify'
import type { Photo, PhotoPage } from '../../lib/types'
import { Icon } from '../../components/Icon'
import { ErrorBox, useMediaQuery } from '../../components/ui'
import { Viewer } from './Viewer'

const PAGE = 120

export type Zoom = 's' | 'm' | 'l'
/** Target row height in rem: [phone, desktop]. */
const ROW_REM: Record<Zoom, [number, number]> = { s: [4.5, 8], m: [7, 12.5], l: [10.5, 18] }

function remPx(): number {
  return parseFloat(getComputedStyle(document.documentElement).fontSize) || 16
}

/** Width of an element, tracked with ResizeObserver. */
function useWidth<T extends HTMLElement>(): [RefObject<T | null>, number] {
  const ref = useRef<T>(null)
  const [w, setW] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    setW(el.clientWidth)
    const ro = new ResizeObserver(([e]) => setW(Math.floor(e.contentRect.width)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, w]
}

/** Open/close the viewer through ?photo=<id> so Back closes it. */
export function usePhotoParam() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const location = useLocation()
  const current = params.get('photo')
  const withPhoto = (id: string | null) => {
    const p = new URLSearchParams(location.search)
    if (id) p.set('photo', id)
    else p.delete('photo')
    const qs = p.toString()
    return location.pathname + (qs ? '?' + qs : '')
  }
  // `source` says which strip opened the viewer (e.g. 'otd'), so only that strip renders it.
  const source = (location.state as { source?: string } | null)?.source ?? null
  const open = (id: string, from?: string) => navigate(withPhoto(id), { state: { viewer: true, source: from } })
  const go = (id: string) => navigate(withPhoto(id), { replace: true, state: location.state })
  const close = () => {
    if ((location.state as { viewer?: boolean } | null)?.viewer) navigate(-1)
    else navigate(withPhoto(null), { replace: true })
  }
  return { current, source, open, go, close }
}

/** One tile. Memoized, and subscribed only to its own selected state, so selecting one photo or
 *  loading another page doesn't re-render every tile. `order` returns the stream (for Shift ranges). */
export const Thumb = memo(function Thumb({ photo, width, height, onOpen, order }: { photo: Photo; width: number; height: number; onOpen: (id: string) => void; order: () => Photo[] }) {
  const src = safeHref(photo.thumb_url)
  const [loaded, setLoaded] = useState(false)
  const mode = selection.useSelect((s) => s.mode)
  const picked = selection.useSelect((s) => s.picked.has(photo.id))
  const label = tileLabel.use()
  const press = useRef<{ t: ReturnType<typeof setTimeout>; x: number; y: number; fired: boolean } | null>(null)
  const when = photo.date_taken ? new Date(photo.date_taken) : null
  const aria = `${photo.video ? 'Video' : 'Photo'}${when ? ' from ' + fmtDate(when, { dateStyle: 'medium', timeStyle: 'short' } as Intl.DateTimeFormatOptions) : ''}${photo.city ? ', ' + photo.city : ''}`
  const text = labelText(photo, label)
  return (
    <button
      className={'ph-tile' + (loaded ? ' loaded' : '') + (mode ? ' selecting' : '') + (picked ? ' picked' : '')}
      style={{ width, height }}
      aria-label={aria}
      aria-pressed={mode ? picked : undefined}
      onPointerEnter={(e) => { e.currentTarget.title = tileTitle(photo) }}
      onClick={(e) => {
        if (press.current?.fired) return void (press.current = null)
        if (mode || e.shiftKey || e.metaKey || e.ctrlKey) {
          e.preventDefault()
          select.toggle(photo, order(), e.shiftKey)
        } else onOpen(photo.id)
      }}
      onPointerDown={(e) => {
        if (e.pointerType === 'mouse') return
        const st = { x: e.clientX, y: e.clientY, fired: false, t: setTimeout(() => { st.fired = true; select.toggle(photo, order()) }, 500) }
        press.current = st
      }}
      onPointerMove={(e) => {
        const p = press.current
        if (p && !p.fired && Math.hypot(e.clientX - p.x, e.clientY - p.y) > 10) (clearTimeout(p.t), (press.current = null))
      }}
      onPointerUp={() => press.current && !press.current.fired && (clearTimeout(press.current.t), (press.current = null))}
      onContextMenu={(e) => press.current?.fired && e.preventDefault()}
    >
      {src && <img src={src} alt="" loading="lazy" decoding="async" width={width} height={height} onLoad={() => setLoaded(true)} draggable={false} />}
      <span className="ph-pick" aria-hidden="true" onClick={(e) => { e.stopPropagation(); select.toggle(photo, order(), e.shiftKey) }}><Icon name="check" size={12} /></span>
      {(photo.has_raw || photo.has_orig) && (
        <span className="ph-badges">{photo.has_raw && <span>RAW</span>}{photo.has_orig && <span>ORIG</span>}</span>
      )}
      {text && width > 88 && <span className="ph-label">{text}</span>}
      {photo.video && (
        <span className="ph-video">
          <Icon name="play" size={10} />
          {fmtDuration(photo.length)}
        </span>
      )}
    </button>
  )
})

type DayInfo = { photos: number; videos: number; size_kb: number }

const DayGroup = memo(function DayGroup({ date, dayKeyStr, items, width, target, gap, onOpen, info, order, link }: {
  date: Date | null; dayKeyStr: string; items: Photo[]; width: number; target: number; gap: number; onOpen: (id: string) => void; info?: DayInfo; order: () => Photo[]; link: boolean
}) {
  const rows = useMemo(() => justify(items.map((p) => p.aspect), width, target, gap), [items, width, target, gap])
  const height = rows.reduce((s, r) => s + r.height, 0) + gap * Math.max(0, rows.length - 1)
  const allPicked = selection.useSelect((s) => s.picked.size > 0 && items.length > 0 && items.every((p) => s.picked.has(p.id)))
  const places = useMemo(() => {
    const counts = new Map<string, number>()
    for (const p of items) {
      const k = [p.city, p.country].filter(Boolean).join(', ')
      if (k) counts.set(k, (counts.get(k) ?? 0) + 1)
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1])
  }, [items])
  const v = info ? info.videos : items.filter((p) => p.video).length
  const ph = info ? info.photos : items.length - v
  return (
    <section className="ph-day" style={{ containIntrinsicSize: `auto ${height + 40}px` }} data-day={dayKeyStr}>
      <h2 className="ph-day-head">
        <button className={'ph-day-pick' + (allPicked ? ' on' : '')} aria-pressed={allPicked} aria-label={`Select all from ${date ? dayLabel(date) : 'this day'}`}
          onClick={() => select.setMany(items, !allPicked)}><Icon name="check" size={11} /></button>
        {date && link ? <Link to={`/photos/day/${dayKeyStr}`} className="ph-day-link" title="All photos from this day">{dayLabel(date)}</Link> : <span>{date ? dayLabel(date) : 'Undated'}</span>}
        {places.length > 0 && (
          <span className="ph-day-place" title={places.map(([k, n]) => `${k}: ${n}`).join('\n')}>
            {places.slice(0, 5).map(([k]) => k.split(',')[0]).join(' · ')}{places.length > 5 ? ` +${places.length - 5}` : ''}
          </span>
        )}
        <span className="ph-day-count tabular">
          {[ph ? `${ph} photo${ph === 1 ? '' : 's'}` : '', v ? `${v} video${v === 1 ? '' : 's'}` : '', info?.size_kb ? fmtBytes(info.size_kb) : ''].filter(Boolean).join(' · ')}
        </span>
      </h2>
      <div className="ph-rows" style={{ gap }}>
        {rows.map((row, i) => (
          <div className="ph-row" key={i} style={{ height: row.height, gap }}>
            {row.boxes.map((b) => (
              <Thumb key={items[b.index].id} photo={items[b.index]} width={b.width} height={b.height} onOpen={onOpen} order={order} />
            ))}
          </div>
        ))}
      </div>
    </section>
  )
})

type Cursor = { before?: string; before_id?: string }

export function PhotoStream({ queryKey, path, params, empty, zoom = 'm', startBefore, dayInfo = false, dayLinks = true, onItems }: {
  queryKey: readonly unknown[]
  path: string
  params?: Record<string, string | number | boolean | undefined>
  empty: string
  zoom?: Zoom
  /** Start the stream at this moment (photos taken before it), e.g. a day picked in Calendar. */
  startBefore?: string
  /** Fetch per-day totals (timeline only: they count the whole library, not a filter or album). */
  dayInfo?: boolean
  /** Day headers link to that day's page. */
  dayLinks?: boolean
  /** Told about the loaded items (e.g. the day page's places). */
  onItems?: (items: Photo[]) => void
}) {
  const q = useInfiniteQuery({
    queryKey: [...queryKey, params ?? {}, startBefore ?? ''],
    // (date_taken, id) cursor: photos can share a timestamp, so pass both back.
    queryFn: ({ pageParam, signal }) =>
      get<PhotoPage>(path, { ...params, limit: PAGE, before: pageParam.before, before_id: pageParam.before_id }, signal),
    initialPageParam: (startBefore ? { before: startBefore } : {}) as Cursor,
    getNextPageParam: (last): Cursor | undefined =>
      last.next_before ? { before: last.next_before, before_id: last.next_before_id ?? undefined } : undefined,
    staleTime: 5 * 60_000,
  })
  const items = useMemo(() => q.data?.pages.flatMap((p) => p.items) ?? [], [q.data])
  const onItemsRef = useRef(onItems)
  onItemsRef.current = onItems
  useEffect(() => onItemsRef.current?.(items), [items])
  // Per-day totals ("10 photos · 1 video · 56.6 MB"): one /photos/days request per loaded page, cached.
  const pageRanges = useMemo(() => (q.data?.pages ?? []).map((pg) => {
    const ds = pg.items.map((p) => p.date_taken).filter(Boolean) as string[]
    return ds.length ? [dayKey(new Date(ds[ds.length - 1])), dayKey(new Date(ds[0]))] as const : null
  }).filter(Boolean) as (readonly [string, string])[], [q.data])
  const dayQs = useQueries({
    queries: dayInfo ? pageRanges.map(([start, end]) => ({
      queryKey: ['photos', 'days', start, end],
      queryFn: () => get<Record<string, DayInfo>>('photos/days', { start, end }),
      staleTime: 30 * 60_000,
    })) : [],
  })
  const dayMap = useMemo(() => Object.assign({}, ...dayQs.map((d) => d.data ?? {})) as Record<string, DayInfo>, [dayQs])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && selection.get().mode && !document.querySelector('.dialog,.viewer') && select.setMode(false)
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])
  useEffect(() => () => select.setMode(false), [])
  // Reuse unchanged day groups (same photos), so a new page re-renders only the days it touched.
  type Day = ReturnType<typeof groupByDay<Photo>>[number]
  const prevDays = useRef(new Map<string, Day>())
  const days = useMemo(() => {
    const out = groupByDay(items, (p) => p.date_taken).map((d) => {
      const old = prevDays.current.get(d.key)
      return old && old.items.length === d.items.length && old.items.every((p, i) => p === d.items[i]) ? old : d
    })
    prevDays.current = new Map(out.map((d) => [d.key, d]))
    return out
  }, [items])
  const itemsRef = useRef(items)
  itemsRef.current = items
  const getOrder = useCallback(() => itemsRef.current, [])
  const [ref, width] = useWidth<HTMLDivElement>()
  const phone = useMediaQuery('(max-width: 760px)')
  const rem = remPx()
  const target = Math.round(rem * ROW_REM[zoom][phone ? 0 : 1])
  const gap = Math.max(2, Math.round(rem * (phone ? 0.125 : 0.25)))
  const viewer = usePhotoParam()
  const openRef = useRef(viewer.open)
  openRef.current = viewer.open
  const onOpen = useCallback((id: string) => openRef.current(id), [])

  // Load the next page when the sentinel comes within ~1.5 screens.
  const sentinel = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = sentinel.current
    if (!el) return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && q.hasNextPage && !q.isFetchingNextPage) q.fetchNextPage()
      },
      { rootMargin: '150% 0px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [q.hasNextPage, q.isFetchingNextPage, q.fetchNextPage, items.length])

  return (
    <div ref={ref} className="ph-stream">
      <SelectionBar />
      {q.isPending ? (
        <StreamSkeleton width={width} target={target} gap={gap} />
      ) : q.isError && !q.data ? (
        <ErrorBox error={q.error} retry={() => q.refetch()} />
      ) : !items.length ? (
        <div className="empty left">{empty}</div>
      ) : (
        width > 0 && days.map((d) => <DayGroup key={d.key} dayKeyStr={d.key} date={d.date} items={d.items} width={width} target={target} gap={gap} onOpen={onOpen} info={dayMap[d.key]} order={getOrder} link={dayLinks} />)
      )}
      <div ref={sentinel} className="ph-sentinel" aria-hidden="true" />
      {q.isFetchingNextPage && <StreamSkeleton width={width} target={target} gap={gap} rows={1} />}
      {viewer.current && !viewer.source && (
        <Viewer
          id={viewer.current}
          items={items}
          onGo={viewer.go}
          onClose={viewer.close}
          onNeedMore={() => q.hasNextPage && !q.isFetchingNextPage && q.fetchNextPage()}
        />
      )}
    </div>
  )
}

function StreamSkeleton({ width, target, gap, rows = 3 }: { width: number; target: number; gap: number; rows?: number }) {
  const pattern = [1.5, 0.75, 1.33, 1, 1.5, 0.75, 1.33, 1.78, 1, 0.75, 1.5, 1.33]
  const r = width ? justify(pattern.concat(pattern), width, target, gap).slice(0, rows) : []
  return (
    <div className="ph-day" aria-busy="true" aria-label="Loading photos">
      <span className="sk" style={{ width: '8rem', height: '0.875rem', margin: '0.25rem 0 0.75rem' }} />
      <div className="ph-rows" style={{ gap }}>
        {r.map((row, i) => (
          <div key={i} className="ph-row" style={{ height: row.height, gap }}>
            {row.boxes.map((b) => <span key={b.index} className="sk" style={{ width: b.width, height: b.height, borderRadius: 0 }} />)}
          </div>
        ))}
      </div>
    </div>
  )
}
