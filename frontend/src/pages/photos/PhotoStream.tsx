// An infinite, day-grouped, justified photo stream (timeline or one album) + the viewer.
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { useLocation, useNavigate, useSearchParams } from 'react-router'
import { get, safeHref } from '../../lib/api'
import { fmtDate, groupByDay } from '../../lib/dates'
import { dayLabel, fmtDuration } from './util'
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
  const open = (id: string) => navigate(withPhoto(id), { state: { viewer: true } })
  const go = (id: string) => navigate(withPhoto(id), { replace: true, state: location.state })
  const close = () => {
    if ((location.state as { viewer?: boolean } | null)?.viewer) navigate(-1)
    else navigate(withPhoto(null), { replace: true })
  }
  return { current, open, go, close }
}

export function Thumb({ photo, width, height, onOpen }: { photo: Photo; width: number; height: number; onOpen: (id: string) => void }) {
  const src = safeHref(photo.thumb_url)
  const [loaded, setLoaded] = useState(false)
  const when = photo.date_taken ? new Date(photo.date_taken) : null
  const label = `${photo.video ? 'Video' : 'Photo'}${when ? ' from ' + fmtDate(when, { dateStyle: 'medium', timeStyle: 'short' } as Intl.DateTimeFormatOptions) : ''}${photo.city ? ', ' + photo.city : ''}`
  return (
    <button className={'ph-tile' + (loaded ? ' loaded' : '')} style={{ width, height }} onClick={() => onOpen(photo.id)} aria-label={label}>
      {src && <img src={src} alt="" loading="lazy" decoding="async" width={width} height={height} onLoad={() => setLoaded(true)} draggable={false} />}
      {photo.video && (
        <span className="ph-video">
          <Icon name="play" size={10} />
          {fmtDuration(photo.length)}
        </span>
      )}
    </button>
  )
}

const DayGroup = memo(function DayGroup({ date, items, width, target, gap, onOpen }: {
  date: Date | null; items: Photo[]; width: number; target: number; gap: number; onOpen: (id: string) => void
}) {
  const rows = useMemo(() => justify(items.map((p) => p.aspect), width, target, gap), [items, width, target, gap])
  const height = rows.reduce((s, r) => s + r.height, 0) + gap * Math.max(0, rows.length - 1)
  const places = useMemo(() => {
    const counts = new Map<string, number>()
    for (const p of items) if (p.city) counts.set(p.city, (counts.get(p.city) ?? 0) + 1)
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([c]) => c)
  }, [items])
  return (
    <section className="ph-day" style={{ containIntrinsicSize: `auto ${height + 40}px` }}>
      <h2 className="ph-day-head">
        <span>{date ? dayLabel(date) : 'Undated'}</span>
        {places.length > 0 && <span className="ph-day-place">{places.join(' · ')}</span>}
        <span className="ph-day-count tabular">
          {(() => {
            const v = items.filter((p) => p.video).length
            const ph = items.length - v
            return [ph ? `${ph} photo${ph === 1 ? '' : 's'}` : '', v ? `${v} video${v === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · ')
          })()}
        </span>
      </h2>
      <div className="ph-rows" style={{ gap }}>
        {rows.map((row, i) => (
          <div className="ph-row" key={i} style={{ height: row.height, gap }}>
            {row.boxes.map((b) => (
              <Thumb key={items[b.index].id} photo={items[b.index]} width={b.width} height={b.height} onOpen={onOpen} />
            ))}
          </div>
        ))}
      </div>
    </section>
  )
})

type Cursor = { before?: string; before_id?: string }

export function PhotoStream({ queryKey, path, params, empty, zoom = 'm', startBefore }: {
  queryKey: readonly unknown[]
  path: string
  params?: Record<string, string | number | boolean | undefined>
  empty: string
  zoom?: Zoom
  /** Start the stream at this moment (photos taken before it), e.g. a day picked in Calendar. */
  startBefore?: string
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
  const days = useMemo(() => groupByDay(items, (p) => p.date_taken), [items])
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
      {q.isPending ? (
        <StreamSkeleton width={width} target={target} gap={gap} />
      ) : q.isError && !q.data ? (
        <ErrorBox error={q.error} retry={() => q.refetch()} />
      ) : !items.length ? (
        <div className="empty left">{empty}</div>
      ) : (
        width > 0 && days.map((d) => <DayGroup key={d.key} date={d.date} items={d.items} width={width} target={target} gap={gap} onOpen={onOpen} />)
      )}
      <div ref={sentinel} className="ph-sentinel" aria-hidden="true" />
      {q.isFetchingNextPage && <StreamSkeleton width={width} target={target} gap={gap} rows={1} />}
      {viewer.current && (
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
