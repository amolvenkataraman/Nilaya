// An infinite, day-grouped, justified photo stream (the timeline, an album, a day, search results) and its
// viewer. Pages of 120 load as the end comes within ~1.5 screens; JustifiedDays keeps only the rows near the
// viewport in the DOM, so a long scroll through a big library stays light. Tiles are memoized and subscribe
// to their own selected state, so selecting one photo or loading a page doesn't re-render every tile.
import { useInfiniteQuery, useQueries } from '@tanstack/react-query'
import { memo, type ReactNode, type RefObject, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router'
import { Icon } from '../../components/Icon'
import { layerOpen } from '../../components/layers'
import { ErrorBox, useIsPhone } from '../../components/ui'
import { get, safeHref } from '../../lib/api'
import { cn } from '../../lib/cn'
import { dayKey, fmtDate, groupByDay } from '../../lib/dates'
import { fmtBytes } from '../../lib/format'
import { type Box, justify } from '../../lib/justify'
import type { Photo, PhotoPage } from '../../lib/types'
import { JustifiedDays } from './JustifiedDays'
import { type DayInfo, dayInfoQuery } from './queries'
import { SelectionBar } from './SelectionBar'
import { selection } from './selection'
import { labelText, tileLabel, tileTitle } from './tileLabel'
import { useLatest } from './useLatest'
import { useLongPress } from './useLongPress'
import { usePhotoParam } from './usePhotoParam'
import { dayLabel, fmtDuration } from './util'
import { Viewer } from './Viewer'
import { pulse } from './skeleton'

const PAGE = 120

export type Zoom = 's' | 'm' | 'l'
/** Target row height in rem: [phone, desktop]. */
const ROW_REM: Record<Zoom, [number, number]> = { s: [4.5, 8], m: [7, 12.5], l: [10.5, 18] }

function remPx(): number {
  return Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16
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

/** Shared by the video length badge here and on Superlatives thumbnails. */
export const videoBadge =
  'absolute top-1.5 right-1.5 inline-flex items-center gap-1 rounded-full bg-[rgba(0,0,0,0.55)] px-1.5 py-px text-2xs font-semibold text-white tabular-nums [&_svg]:fill-current [&_svg]:stroke-none'

/** One tile. `order` returns the stream (for Shift ranges). */
export const Thumb = memo(function Thumb({
  photo,
  width,
  height,
  onOpen,
  order,
}: {
  photo: Photo
  width: number
  height: number
  onOpen: (id: string) => void
  order: () => Photo[]
}) {
  const src = safeHref(photo.thumb_url)
  const [loaded, setLoaded] = useState(false)
  const mode = selection.useSelect((s) => s.mode)
  const picked = selection.useSelect((s) => s.picked.has(photo.id))
  const label = tileLabel.use()
  const press = useLongPress(() => selection.toggle(photo, order()))
  const when = photo.date_taken ? new Date(photo.date_taken) : null
  const aria = `${photo.video ? 'Video' : 'Photo'}${when ? ` from ${fmtDate(when, { dateStyle: 'medium', timeStyle: 'short' })}` : ''}${photo.city ? `, ${photo.city}` : ''}`
  const text = labelText(photo, label)
  return (
    <button
      type="button"
      className={cn(
        'group/tile relative flex-none cursor-zoom-in overflow-hidden rounded-none border-0 p-0',
        'focus-visible:z-1 focus-visible:rounded-none focus-visible:outline-3 focus-visible:-outline-offset-3 focus-visible:outline-accent',
        "after:pointer-events-none after:absolute after:inset-0 after:bg-[linear-gradient(180deg,rgba(0,0,0,0.18),transparent_35%)] after:opacity-0 after:transition-opacity after:duration-150 after:content-[''] hover:after:opacity-100",
        picked ? 'bg-[color-mix(in_srgb,var(--app-accent)_18%,var(--app-surface-2))]' : 'bg-surface-2',
      )}
      style={{ width, height }}
      aria-label={aria}
      aria-pressed={mode ? picked : undefined}
      onPointerEnter={(e) => {
        e.currentTarget.title = tileTitle(photo)
      }}
      onClick={(e) => {
        if (press.consumed()) return
        if (mode || e.shiftKey || e.metaKey || e.ctrlKey) {
          e.preventDefault()
          selection.toggle(photo, order(), e.shiftKey)
        } else onOpen(photo.id)
      }}
      {...press.handlers}
    >
      {src && (
        <img
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          width={width}
          height={height}
          onLoad={() => setLoaded(true)}
          draggable={false}
          className={cn(
            'size-full object-cover [transition:opacity_0.25s_ease,transform_0.25s_var(--ease)]',
            loaded ? 'opacity-100' : 'opacity-0',
            picked && 'scale-[0.88] rounded-[6px]',
          )}
        />
      )}
      <span
        className={cn(
          'absolute top-1.5 left-1.5 z-2 grid size-5 place-items-center rounded-full border-2 shadow-[0_1px_3px_rgba(0,0,0,0.35)] transition-opacity duration-120',
          picked ? 'border-accent bg-accent text-white' : 'border-[rgba(255,255,255,0.9)] bg-[rgba(0,0,0,0.25)] text-transparent',
          mode ? 'opacity-100' : 'opacity-0 group-hover/tile:opacity-100 group-focus-visible/tile:opacity-100',
        )}
        aria-hidden="true"
        onClick={(e) => {
          e.stopPropagation()
          selection.toggle(photo, order(), e.shiftKey)
        }}
      >
        <Icon name="check" size={12} />
      </span>
      {(photo.has_raw || photo.has_orig) && (
        <span className="absolute top-1.5 right-1.5 z-1 flex gap-0.5 [&>span]:rounded-[3px] [&>span]:bg-[rgba(0,0,0,0.6)] [&>span]:px-1 [&>span]:text-white [&>span]:[font:700_0.5625rem/1.5_var(--app-font)] [&>span]:tracking-[0.04em]">
          {photo.has_raw && <span>RAW</span>}
          {photo.has_orig && <span>ORIG</span>}
        </span>
      )}
      {text && width > 88 && (
        <span className="absolute bottom-1.5 left-1.5 z-1 max-w-[calc(100%-4.5rem)] truncate rounded-[3px] bg-[rgba(0,0,0,0.55)] px-1.25 text-3xs leading-normal text-white tabular-nums">
          {text}
        </span>
      )}
      {photo.video && (
        <span className={videoBadge}>
          <Icon name="play" size={10} />
          {fmtDuration(photo.length)}
        </span>
      )}
    </button>
  )
})

type Day = ReturnType<typeof groupByDay<Photo>>[number]

/** "Fri, Jul 31  Goa · Panaji  +2    10 photos · 1 video · 56.6 MB", with select-all-of-the-day. */
function DayHeader({ day, info, link }: { day: Day; info?: DayInfo; link: boolean }) {
  const { date, items, key } = day
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
    <h2 className="mb-2 flex items-center gap-2 pt-1 text-sm font-semibold tracking-[-0.005em] max-md:flex-wrap max-md:gap-y-0">
      <button
        type="button"
        className={cn(
          'grid size-4.5 flex-none place-items-center rounded-full border-[1.5px] p-0 transition-opacity duration-120',
          allPicked
            ? 'border-accent bg-accent text-white opacity-100'
            : 'border-muted bg-transparent text-transparent opacity-0 group-hover/day:opacity-100 focus-visible:opacity-100 touch:opacity-100',
        )}
        aria-pressed={allPicked}
        aria-label={`Select all from ${date ? dayLabel(date) : 'this day'}`}
        onClick={() => selection.setMany(items, !allPicked)}
      >
        <Icon name="check" size={11} />
      </button>
      {date && link ? (
        <Link to={`/photos/day/${key}`} className="text-inherit hover:text-accent hover:no-underline" title="All photos from this day">
          {dayLabel(date)}
        </Link>
      ) : (
        <span>{date ? dayLabel(date) : 'Undated'}</span>
      )}
      {places.length > 0 && (
        <span
          className="text-xs font-normal text-muted max-md:min-w-0 max-md:flex-1 max-md:truncate"
          title={places.map(([k, n]) => `${k}: ${n}`).join('\n')}
        >
          {places
            .slice(0, 5)
            .map(([k]) => k.split(',')[0])
            .join(' · ')}
          {places.length > 5 ? ` +${places.length - 5}` : ''}
        </span>
      )}
      <span className="ml-auto text-xs font-normal text-muted tabular-nums max-md:ml-0 max-md:basis-full max-md:pl-6.5">
        {[
          ph ? `${ph} photo${ph === 1 ? '' : 's'}` : '',
          v ? `${v} video${v === 1 ? '' : 's'}` : '',
          info?.size_kb ? fmtBytes(info.size_kb) : '',
        ]
          .filter(Boolean)
          .join(' · ')}
      </span>
    </h2>
  )
}

type Cursor = { before?: string; before_id?: string }

export function PhotoStream({
  queryKey,
  path,
  params,
  empty,
  zoom = 'm',
  startBefore,
  dayInfo = false,
  dayLinks = true,
  onItems,
  onFirstPage,
}: {
  queryKey: readonly unknown[]
  path: string
  params?: Record<string, string | number | boolean | undefined>
  empty: ReactNode
  zoom?: Zoom
  /** Start the stream at this moment (photos taken before it), e.g. a day picked in Calendar. */
  startBefore?: string
  /** Fetch per-day totals (timeline only: they count the whole library, not a filter or album). */
  dayInfo?: boolean
  /** Day headers link to that day's page. */
  dayLinks?: boolean
  /** Told about the loaded items (e.g. the day page's places). */
  onItems?: (items: Photo[]) => void
  /** Told about the first page as the API sent it (e.g. search's interpretation and count). */
  onFirstPage?: (page: PhotoPage) => void
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
  const onItemsRef = useLatest(onItems)
  useEffect(() => onItemsRef.current?.(items), [items, onItemsRef])
  const onFirstRef = useLatest(onFirstPage)
  const first = q.data?.pages[0]
  useEffect(() => {
    if (first) onFirstRef.current?.(first)
  }, [first, onFirstRef])
  // Per-day totals ("10 photos · 1 video · 56.6 MB"): one /photos/days request per loaded page, cached.
  const pageRanges = useMemo(
    () =>
      (q.data?.pages ?? [])
        .map((pg) => {
          const ds = pg.items.map((p) => p.date_taken).filter(Boolean) as string[]
          if (!ds.length) return null
          const a = dayKey(new Date(ds[0]))
          const b = dayKey(new Date(ds[ds.length - 1])) // newest or oldest first
          return (a < b ? [a, b] : [b, a]) as readonly [string, string]
        })
        .filter(Boolean) as (readonly [string, string])[],
    [q.data],
  )
  const dayQs = useQueries({ queries: dayInfo ? pageRanges.map(([start, end]) => dayInfoQuery(start, end)) : [] })
  const dayMap = useMemo(() => Object.assign({}, ...dayQs.map((d) => d.data ?? {})) as Record<string, DayInfo>, [dayQs])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && selection.get().mode && !layerOpen(['dialog', 'viewer'])) selection.setMode(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])
  useEffect(() => () => selection.setMode(false), [])
  // Reuse unchanged day groups (same photos), so a new page re-lays out only the days it touched.
  const prevDays = useRef(new Map<string, Day>())
  const days = useMemo(() => {
    const out = groupByDay(items, (p) => p.date_taken).map((d) => {
      const old = prevDays.current.get(d.key)
      return old && old.items.length === d.items.length && old.items.every((p, i) => p === d.items[i]) ? old : d
    })
    prevDays.current = new Map(out.map((d) => [d.key, d]))
    return out
  }, [items])
  const itemsRef = useLatest(items)
  const getOrder = useCallback(() => itemsRef.current, [itemsRef])
  const [ref, width] = useWidth<HTMLDivElement>()
  const phone = useIsPhone()
  const rem = remPx()
  const target = Math.round(rem * ROW_REM[zoom][phone ? 0 : 1])
  const gap = Math.max(2, Math.round(rem * (phone ? 0.125 : 0.25)))
  const viewer = usePhotoParam()
  const openRef = useLatest(viewer.open)
  const onOpen = useCallback((id: string) => openRef.current(id), [openRef])
  const renderTile = useCallback(
    (p: Photo, b: Box) => <Thumb key={p.id} photo={p} width={b.width} height={b.height} onOpen={onOpen} order={getOrder} />,
    [onOpen, getOrder],
  )
  const renderHeader = useCallback((d: Day) => <DayHeader day={d} info={dayMap[d.key]} link={dayLinks} />, [dayMap, dayLinks])

  // Load the next page when the sentinel comes within ~1.5 screens.
  const sentinel = useRef<HTMLDivElement>(null)
  // biome-ignore lint/correctness/useExhaustiveDependencies: items.length re-arms the observer after each page
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
    <div ref={ref} className="min-h-[50vh]">
      <SelectionBar />
      {q.isPending ? (
        <StreamSkeleton width={width} target={target} gap={gap} />
      ) : q.isError && !q.data ? (
        <ErrorBox error={q.error} retry={() => q.refetch()} />
      ) : !items.length ? (
        <div className="p-4 text-sm text-muted">{empty}</div>
      ) : (
        width > 0 && (
          <JustifiedDays
            sections={days}
            width={width}
            target={target}
            gap={gap}
            sectionGap={Math.round(rem * 1.25)}
            headerGuess={Math.round(rem * (phone ? 3 : 1.93))}
            renderHeader={renderHeader}
            renderTile={renderTile}
            sectionClassName="group/day"
          />
        )
      )}
      <div ref={sentinel} className="h-px" aria-hidden="true" />
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

const PATTERN = [1.5, 0.75, 1.33, 1, 1.5, 0.75, 1.33, 1.78, 1, 0.75, 1.5, 1.33]

function StreamSkeleton({ width, target, gap, rows = 3 }: { width: number; target: number; gap: number; rows?: number }) {
  const r = width ? justify(PATTERN.concat(PATTERN), width, target, gap).slice(0, rows) : []
  return (
    <div className="mb-5" role="status" aria-busy="true" aria-label="Loading photos">
      <span className={cn(pulse, 'mt-1 mb-3 h-3.5 w-32 rounded-xs')} />
      <div className="flex flex-col" style={{ gap }}>
        {r.map((row, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: placeholder rows have no identity
          <div key={i} className="flex" style={{ height: row.height, gap }}>
            {row.boxes.map((b) => (
              <span key={b.index} className={pulse} style={{ width: b.width, height: b.height }} />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
