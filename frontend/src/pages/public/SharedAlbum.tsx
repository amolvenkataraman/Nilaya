// /shared/albums/:id: a shared album for anyone with the link (public albums), or its owner and
// members. Read-only: a justified grid paged by (date_taken, id) and a lightweight viewer. Only the
// signed thumbnail and original URLs are used; nothing is generated per photo.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { ApiError, get, safeHref } from '../../lib/api'
import { justify } from '../../lib/justify'
import { dateFormatter } from '../../lib/dates'
import type { Photo, PhotoPage } from '../../lib/types'
import { Icon } from '../../components/Icon'
import { ErrorBox, SkeletonRows, useMediaQuery } from '../../components/ui'
import { fmtBytes, fmtDuration } from '../photos/util'
import { PublicFrame, PublicNotice, loginHere, usePublicTitle } from './PublicFrame'

interface PublicAlbum {
  id: string; name: string; description: string; owner: string; public: boolean; photos: number; videos: number
  size_kb: number; first: string | null; last: string | null; cover_url: string | null; member: boolean
}
type Cursor = { before?: string; before_id?: string }

const PAGE = 120
const GAP = 4
const span = dateFormatter({ month: 'short', day: 'numeric', year: 'numeric' })
const caption = dateFormatter({ weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
const plural = (n: number, w: string) => `${n.toLocaleString()} ${w}${n === 1 ? '' : 's'}`

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
    queryFn: ({ pageParam, signal }) => get<PhotoPage>(`photos/public/albums/${id}/photos`,
      { limit: PAGE, before: pageParam.before, before_id: pageParam.before_id }, signal),
    initialPageParam: {} as Cursor,
    getNextPageParam: (last): Cursor | undefined => (last.next_before ? { before: last.next_before, before_id: last.next_before_id ?? undefined } : undefined),
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
          <p className="muted small">It doesn't exist, or its owner shares it only with people they added.</p>
          <Link className="btn primary" to={loginHere(loc)}>Sign in</Link>
        </PublicNotice>
      </PublicFrame>
    )
  }
  if (album.isPending) return <PublicFrame wide><div className="card"><SkeletonRows rows={5} /></div></PublicFrame>
  if (!album.data) return <PublicFrame wide><div className="card"><ErrorBox error={album.error} retry={() => album.refetch()} /></div></PublicFrame>
  const a = album.data
  const cover = safeHref(a.cover_url)
  const range = dateRange(a.first, a.last)

  return (
    <PublicFrame wide>
      <header className="sa-banner">
        <span className="sa-cover">{cover ? <img src={cover} alt="" /> : <Icon name="album" size={30} />}</span>
        <div className="sa-info">
          <h1 className="truncate">{a.name}</h1>
          <p className="muted small">{[`by ${a.owner}`, a.public ? 'Public album' : 'Shared album'].join(' · ')}</p>
          {a.description && <p className="sa-desc small">{a.description}</p>}
          <p className="sa-meta xsmall muted tabular">
            {[plural(a.photos, 'photo'), a.videos ? plural(a.videos, 'video') : '', a.size_kb ? fmtBytes(a.size_kb) : '', range].filter(Boolean).join(' · ')}
          </p>
        </div>
        {a.member && <a className="btn sa-open" href={`/photos/albums/${a.id}`}><Icon name="photo" size={14} />Open in Photos</a>}
      </header>
      {photos.isError && !items.length ? <div className="card"><ErrorBox error={photos.error} retry={() => photos.refetch()} /></div>
        : photos.isPending ? <div className="card"><SkeletonRows rows={6} /></div>
        : items.length === 0 ? <p className="empty">This album is empty.</p>
        : <Grid items={items} onOpen={setOpen} more={photos.hasNextPage ? () => !photos.isFetchingNextPage && photos.fetchNextPage() : null} loading={photos.isFetchingNextPage} />}
      {photos.isError && items.length > 0 && <ErrorBox error={photos.error} retry={() => photos.fetchNextPage()} />}
      {open !== null && items[open] && (
        <Lightbox items={items} index={open} onGo={(i) => {
          setOpen(i)
          if (i >= items.length - 3 && photos.hasNextPage && !photos.isFetchingNextPage) photos.fetchNextPage()
        }} onClose={() => setOpen(null)} />
      )}
    </PublicFrame>
  )
}

function Grid({ items, onOpen, more, loading }: { items: Photo[]; onOpen: (i: number) => void; more: (() => unknown) | null; loading: boolean }) {
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
  const rows = useMemo(() => justify(items.map((p) => p.aspect), width, phone ? 120 : 200, GAP), [items, width, phone])
  useEffect(() => {
    const el = sentinel.current
    if (!el || !more) return
    const io = new IntersectionObserver(([e]) => e.isIntersecting && more(), { rootMargin: '800px 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [more])
  return (
    <div ref={box} className="sa-grid">
      {rows.map((r, ri) => (
        <div key={ri} className="sa-row" style={{ height: r.height }}>
          {r.boxes.map((b) => {
            const p = items[b.index]
            const src = safeHref(p.thumb_url)
            return (
              <button key={p.id} className="sa-tile" style={{ width: b.width, height: b.height }} onClick={() => onOpen(b.index)}
                aria-label={(p.video ? 'Video' : 'Photo') + (p.date_taken ? ', ' + caption.format(new Date(p.date_taken)) : '')}>
                {src && <img src={src} alt="" loading="lazy" decoding="async" />}
                {p.video && <span className="sa-vid"><Icon name="play" size={10} />{p.length ? fmtDuration(p.length) : ''}</span>}
              </button>
            )
          })}
        </div>
      ))}
      <div ref={sentinel} className="sa-sentinel">{loading && <span className="spinner" aria-label="Loading more" />}</div>
    </div>
  )
}

function Lightbox({ items, index, onGo, onClose }: { items: Photo[]; index: number; onGo: (i: number) => void; onClose: () => void }) {
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
    return () => { document.body.style.overflow = overflow }
  }, [])
  const full = safeHref(p.url)
  const thumb = safeHref(p.thumb_url)
  const place = [p.city, p.country].filter(Boolean).join(', ')
  return (
    <div ref={ref} className="sa-lb" role="dialog" aria-modal="true" aria-label="Photo viewer" tabIndex={-1}
      onTouchStart={(e) => (touch.current = e.touches[0].clientX)}
      onTouchEnd={(e) => {
        if (touch.current === null) return
        const dx = e.changedTouches[0].clientX - touch.current
        touch.current = null
        if (Math.abs(dx) > 50) go(dx > 0 ? prev : next)
      }}>
      <div className="sa-lb-bar">
        <span className="sa-lb-cap">
          <span>{p.date_taken ? caption.format(new Date(p.date_taken)) : 'Undated'}</span>
          {place && <span className="sa-lb-place"><Icon name="location" size={12} />{place}</span>}
        </span>
        <span className="tabular sa-lb-count">{index + 1} / {items.length}</span>
        {full && <a className="btn ghost icon" href={full} target="_blank" rel="noopener" aria-label="Open original" title="Open original"><Icon name="external" /></a>}
        <button className="btn ghost icon" onClick={onClose} aria-label="Close" title="Close (Esc)"><Icon name="x" /></button>
      </div>
      <div className="sa-lb-stage" onClick={(e) => e.target === e.currentTarget && onClose()}>
        {p.video
          ? full && <video key={p.id} src={full} poster={thumb ?? undefined} controls autoPlay playsInline />
          : <img key={p.id} src={full ?? thumb ?? ''} alt="" style={thumb ? { backgroundImage: `url("${thumb}")` } : undefined} />}
      </div>
      {prev !== null && <button className="sa-lb-nav prev" onClick={() => go(prev)} aria-label="Previous"><Icon name="chevronLeft" size={22} /></button>}
      {next !== null && <button className="sa-lb-nav next" onClick={() => go(next)} aria-label="Next"><Icon name="chevronRight" size={22} /></button>}
    </div>
  )
}
