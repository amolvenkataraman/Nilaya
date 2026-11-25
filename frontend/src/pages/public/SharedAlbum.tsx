// /shared/albums/:id: a shared album for anyone with the link (public albums), or its owner and
// members. Read-only: a justified grid paged by (date_taken, id) and a lightweight viewer. Only the
// signed thumbnail and original URLs are used; nothing is generated per photo. The grid is Photos'
// JustifiedDays (one section), so a big album keeps only the rows near the viewport in the DOM.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { ApiError, get, safeHref } from '../../lib/api'
import type { Box } from '../../lib/justify'
import { dateFormatter } from '../../lib/dates'
import type { Photo, PhotoPage, Schemas } from '../../lib/types'
import { Icon } from '../../components/Icon'
import { buttonClass, ErrorBox, SkeletonRows, useMediaQuery } from '../../components/ui'
import { cn } from '../../lib/cn'
import { JustifiedDays } from '../photos/JustifiedDays'
import { fmtDuration } from '../photos/util'
import { fmtBytes, plural, placeText } from '../../lib/format'
import { PublicFrame, PublicNotice, loginHere, usePublicTitle } from './PublicFrame'
import { useLayer } from '../../components/layers'

type PublicAlbum = Schemas['PublicAlbumOut']
type Cursor = { before?: string; before_id?: string }

const PAGE = 120
/** The old global .card look (white panel, hairline border, radius). */
const card = 'min-w-0 rounded-md border border-border bg-surface shadow-card'
const GAP = 4
const span = dateFormatter({ month: 'short', day: 'numeric', year: 'numeric' })
const caption = dateFormatter({ weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })

function dateRange(a: string | null, b: string | null): string {
  if (!a || !b) return ''
  const x = span.format(new Date(a))
  const y = span.format(new Date(b))
  return x === y ? x : `${x} – ${y}`
}

export default function SharedAlbum() {
  const { id = '' } = useParams()
  const loc = useLocation()
  const valid = /^[0-9a-f-]{36}$/i.test(id)
  const album = useQuery({
    queryKey: ['public', 'album', id],
    queryFn: () => get<PublicAlbum>(`photos/public/albums/${id}`),
    enabled: valid,
    staleTime: 5 * 60_000,
    retry: (n, e) => !(e instanceof ApiError && e.status === 404) && n < 3,
  })
  const photos = useInfiniteQuery({
    queryKey: ['public', 'album', id, 'photos'],
    queryFn: ({ pageParam, signal }) =>
      get<PhotoPage>(
        `photos/public/albums/${id}/photos`,
        { limit: PAGE, before: pageParam.before, before_id: pageParam.before_id },
        signal,
      ),
    initialPageParam: {} as Cursor,
    getNextPageParam: (last): Cursor | undefined =>
      last.next_before ? { before: last.next_before, before_id: last.next_before_id ?? undefined } : undefined,
    enabled: album.isSuccess,
    staleTime: 5 * 60_000,
  })
  const items = useMemo(() => photos.data?.pages.flatMap((p) => p.items) ?? [], [photos.data])
  const [open, setOpen] = useState<number | null>(null)
  usePublicTitle(album.data?.name ?? 'Shared album')

  if (!valid || (album.isError && album.error instanceof ApiError && album.error.status === 404)) {
    return (
      <PublicFrame>
        <PublicNotice icon="album" title="This album isn't shared publicly">
          <p className="text-sm text-muted">It doesn't exist, or its owner shares it only with people they added.</p>
          <Link className={buttonClass({ variant: 'primary' })} to={loginHere(loc)}>
            Sign in
          </Link>
        </PublicNotice>
      </PublicFrame>
    )
  }
  if (album.isPending)
    return (
      <PublicFrame wide>
        <div className={card}>
          <SkeletonRows rows={5} />
        </div>
      </PublicFrame>
    )
  if (!album.data)
    return (
      <PublicFrame wide>
        <div className={card}>
          <ErrorBox error={album.error} retry={() => album.refetch()} />
        </div>
      </PublicFrame>
    )
  const a = album.data
  const cover = safeHref(a.cover_url)
  const range = dateRange(a.first, a.last)

  return (
    <PublicFrame wide>
      <header className="flex items-center gap-4 max-[640px]:flex-wrap">
        <span className="grid size-22 flex-none place-items-center overflow-hidden rounded-md bg-surface-2 text-muted max-[640px]:size-16">
          {cover ? <img src={cover} alt="" className="size-full object-cover" /> : <Icon name="album" size={30} />}
        </span>
        <div className="grid min-w-0 flex-1 gap-0.5">
          <h1 className="truncate text-xl font-semibold tracking-[-0.015em]">{a.name}</h1>
          <p className="text-sm text-muted">{[`by ${a.owner}`, a.public ? 'Public album' : 'Shared album'].join(' · ')}</p>
          {a.description && <p className="mt-0.5 text-sm whitespace-pre-line [overflow-wrap:anywhere]">{a.description}</p>}
          <p className="mt-1 text-xs text-muted tabular-nums">
            {[plural(a.photos, 'photo'), a.videos ? plural(a.videos, 'video') : '', a.size_kb ? fmtBytes(a.size_kb) : '', range]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
        {a.member && (
          <a className={buttonClass({ className: 'max-[640px]:w-full' })} href={`/photos/albums/${a.id}`}>
            <Icon name="photo" size={14} />
            Open in Photos
          </a>
        )}
      </header>
      {photos.isError && !items.length ? (
        <div className={card}>
          <ErrorBox error={photos.error} retry={() => photos.refetch()} />
        </div>
      ) : photos.isPending ? (
        <div className={card}>
          <SkeletonRows rows={6} />
        </div>
      ) : items.length === 0 ? (
        <p className="p-4 text-center text-sm text-muted">This album is empty.</p>
      ) : (
        <Grid
          items={items}
          onOpen={setOpen}
          more={photos.hasNextPage ? () => !photos.isFetchingNextPage && photos.fetchNextPage() : null}
          loading={photos.isFetchingNextPage}
        />
      )}
      {photos.isError && items.length > 0 && <ErrorBox error={photos.error} retry={() => photos.fetchNextPage()} />}
      {open !== null && items[open] && (
        <Lightbox
          items={items}
          index={open}
          onGo={(i) => {
            setOpen(i)
            if (i >= items.length - 3 && photos.hasNextPage && !photos.isFetchingNextPage) photos.fetchNextPage()
          }}
          onClose={() => setOpen(null)}
        />
      )}
    </PublicFrame>
  )
}

function Grid({
  items,
  onOpen,
  more,
  loading,
}: {
  items: Photo[]
  onOpen: (i: number) => void
  more: (() => unknown) | null
  loading: boolean
}) {
  const box = useRef<HTMLDivElement>(null)
  const sentinel = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const phone = useMediaQuery('(max-width: 640px)')
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setWidth(Math.floor(e.contentRect.width)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const sections = useMemo(() => [{ key: 'all', items }], [items])
  const indexOf = useMemo(() => new Map(items.map((p, i) => [p.id, i])), [items])
  const onOpenRef = useRef(onOpen)
  onOpenRef.current = onOpen
  const renderTile = useCallback(
    (p: Photo, b: Box) => {
      const src = safeHref(p.thumb_url)
      return (
        <button
          key={p.id}
          type="button"
          className="group/tile relative flex-none cursor-zoom-in overflow-hidden rounded-[2px] border-0 bg-surface-2 p-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          style={{ width: b.width, height: b.height }}
          onClick={() => onOpenRef.current(indexOf.get(p.id) ?? 0)}
          aria-label={(p.video ? 'Video' : 'Photo') + (p.date_taken ? `, ${caption.format(new Date(p.date_taken))}` : '')}
        >
          {src && (
            <img
              src={src}
              alt=""
              loading="lazy"
              decoding="async"
              className="block size-full object-cover transition-transform duration-200 ease-out group-hover/tile:scale-[1.03]"
            />
          )}
          {p.video && (
            <span className="absolute right-1.5 bottom-1.5 inline-flex items-center gap-1 rounded-full bg-[rgba(0,0,0,0.55)] px-1.5 py-0.5 text-2xs text-white">
              <Icon name="play" size={10} />
              {p.length ? fmtDuration(p.length) : ''}
            </span>
          )}
        </button>
      )
    },
    [indexOf],
  )
  useEffect(() => {
    const el = sentinel.current
    if (!el || !more) return
    const io = new IntersectionObserver(([e]) => e.isIntersecting && more(), { rootMargin: '800px 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [more])
  return (
    <div ref={box}>
      {width > 0 && <JustifiedDays sections={sections} width={width} target={phone ? 120 : 200} gap={GAP} renderTile={renderTile} />}
      <div ref={sentinel} className="mt-1 grid min-h-12 place-items-center">
        {loading && <span className="spinner" role="status" aria-label="Loading more" />}
      </div>
    </div>
  )
}

const dimWhite = 'text-[rgba(255,255,255,0.7)]'
const barBtn = buttonClass({
  variant: 'ghost',
  icon: true,
  className: 'text-[rgba(255,255,255,0.8)]! hover:not-disabled:bg-white/12! hover:not-disabled:text-white!',
})
const lbNav =
  'absolute top-1/2 grid size-11 -translate-y-1/2 place-items-center rounded-full border-0 bg-white/12 text-white hover:bg-white/22 max-[640px]:hidden'

function Lightbox({ items, index, onGo, onClose }: { items: Photo[]; index: number; onGo: (i: number) => void; onClose: () => void }) {
  useLayer('viewer', true)
  const p = items[index]
  const prev = index > 0 ? index - 1 : null
  const next = index < items.length - 1 ? index + 1 : null
  const touch = useRef<number | null>(null)
  const go = useCallback((i: number | null) => i !== null && onGo(i), [onGo])
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowLeft') go(prev)
      else if (e.key === 'ArrowRight') go(next)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [prev, next, go, onClose])
  useEffect(() => {
    ref.current?.focus()
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = overflow
    }
  }, [])
  const full = safeHref(p.url)
  const thumb = safeHref(p.thumb_url)
  const place = placeText([p.city, p.country].filter(Boolean).join(', '))
  return (
    <div
      ref={ref}
      className="fixed inset-0 z-100 flex flex-col bg-[rgba(8,10,14,0.96)] text-white outline-none"
      role="dialog"
      aria-modal="true"
      aria-label="Photo viewer"
      tabIndex={-1}
      onTouchStart={(e) => (touch.current = e.touches[0].clientX)}
      onTouchEnd={(e) => {
        if (touch.current === null) return
        const dx = e.changedTouches[0].clientX - touch.current
        touch.current = null
        if (Math.abs(dx) > 50) go(dx > 0 ? prev : next)
      }}
    >
      <div className="flex items-center gap-2 px-3 pt-[calc(0.5rem+env(safe-area-inset-top,0px))] pb-2">
        <span className="grid min-w-0 flex-1 text-sm">
          <span>{p.date_taken ? caption.format(new Date(p.date_taken)) : 'Undated'}</span>
          {place && (
            <span className={cn('inline-flex items-center gap-1 text-xs', dimWhite)}>
              <Icon name="location" size={12} />
              {place}
            </span>
          )}
        </span>
        <span className={cn('text-xs tabular-nums', dimWhite)}>
          {index + 1} / {items.length}
        </span>
        {full && (
          <a className={barBtn} href={full} target="_blank" rel="noopener" aria-label="Open original" title="Open original">
            <Icon name="external" />
          </a>
        )}
        <button type="button" className={barBtn} onClick={onClose} aria-label="Close" title="Close (Esc)">
          <Icon name="x" />
        </button>
      </div>
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: a click beside the photo closes, as Escape does */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: same */}
      <div
        className="grid min-h-0 flex-1 place-items-center px-2 pb-3 [&>img,&>video]:max-h-full [&>img,&>video]:max-w-full [&>img,&>video]:bg-contain [&>img,&>video]:bg-center [&>img,&>video]:bg-no-repeat [&>img,&>video]:object-contain"
        onClick={(e) => e.target === e.currentTarget && onClose()}
      >
        {p.video ? (
          full && <video key={p.id} src={full} poster={thumb ?? undefined} controls autoPlay playsInline />
        ) : (
          <img key={p.id} src={full ?? thumb ?? ''} alt="" style={thumb ? { backgroundImage: `url("${thumb}")` } : undefined} />
        )}
      </div>
      {prev !== null && (
        <button type="button" className={cn(lbNav, 'left-3')} onClick={() => go(prev)} aria-label="Previous">
          <Icon name="chevronLeft" size={22} />
        </button>
      )}
      {next !== null && (
        <button type="button" className={cn(lbNav, 'right-3')} onClick={() => go(next)} aria-label="Next">
          <Icon name="chevronRight" size={22} />
        </button>
      )}
    </div>
  )
}
