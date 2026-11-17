// Full-screen photo/video viewer: arrows or swipe to move, Esc to close, "i" for details, wheel/pinch/keys to
// zoom (useZoom). Always dark, whatever the app theme, so its colours are fixed values, not tokens.
// The root keeps the class `viewer`: dialogs opened from it check `body:has(.viewer)` to stack above it.
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '../../components/Icon'
import { useLayer } from '../../components/layers'
import { toast } from '../../components/toast'
import { Confirm, isTyping, Menu, MenuItem, MenuSeparator, PHONE_QUERY } from '../../components/ui'
import { safeHref } from '../../lib/api'
import { cn } from '../../lib/cn'
import { fmtDate, fmtTime } from '../../lib/dates'
import { fmtBytes } from '../../lib/format'
import { usePref } from '../../lib/storage'
import type { Photo } from '../../lib/types'
import { copyLinks, deleteOriginal, downloadFiles, setAlbumCover, setPhotosHidden, undoHide, useHiddenMode, useLibraries } from './actions'
import { DeleteDialog } from './DeleteDialog'
import { InfoPanel } from './InfoPanel'
import { type PhotoDetails, photoDetailsQuery, photoQuery } from './queries'
import { albumContext } from './selection'
import { type Fit, layerTransform, type ZoomState, useZoom } from './useZoom'

const dim = 'text-[rgba(232,234,237,0.7)]'
const roundBtn =
  'inline-grid size-10 place-items-center rounded-full border-0 bg-transparent text-[#e8eaed] hover:bg-white/12 hover:no-underline ' +
  'focus-visible:rounded-full focus-visible:outline-[#8ab4f8]'
const spin = 'absolute inline-block animate-[spin_0.7s_linear_infinite] rounded-full border-2 border-white/20 border-t-white'

export function Viewer({
  id,
  items,
  onGo,
  onClose,
  onNeedMore,
}: {
  id: string
  items: Photo[]
  onGo: (id: string) => void
  onClose: () => void
  onNeedMore?: () => void
}) {
  const isTop = useLayer('viewer', true)
  const index = items.findIndex((p) => p.id === id)
  // Deep link to a photo that isn't in the loaded pages: fetch it on its own.
  const single = useQuery({ ...photoQuery(id), enabled: index < 0 })
  const photo = index >= 0 ? items[index] : single.data
  const prev = index > 0 ? items[index - 1] : null
  const next = index >= 0 && index < items.length - 1 ? items[index + 1] : null
  const [info, setInfo] = usePref<boolean>('app.photos.info', false)
  const root = useRef<HTMLDivElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  // The image is laid out at its natural pixel size and scaled down to fit, so zooming in
  // rasterises from the full-resolution pixels instead of upscaling a screen-sized bitmap.
  const [natural, setNatural] = useState<{ id: string; w: number; h: number } | null>(null)
  const dims = photo && !photo.video ? naturalSize(photo, natural) : null
  const fit = useFit(stage, dims?.w ?? 0, dims?.h ?? 0)
  const zoom = useZoom(stage, !!photo && !photo.video, photo?.id ?? '', fit)
  const toggleInfo = () => setInfo((v) => !v)

  // Near the end of what's loaded: ask the stream for the next page.
  useEffect(() => {
    if (index >= 0 && index >= items.length - 3) onNeedMore?.()
  }, [index, items.length, onNeedMore])

  useEffect(() => {
    const prevFocus = document.activeElement as HTMLElement | null
    root.current?.focus()
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = overflow
      prevFocus?.focus?.({ preventScroll: true })
    }
  }, [])

  // One listener for the viewer's life; it reads the current photo, neighbours and zoom through a ref.
  const keys = useRef({ prev, next, onGo, onClose, toggleInfo, zoom, isTop })
  keys.current = { prev, next, onGo, onClose, toggleInfo, zoom, isTop }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = keys.current
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (isTyping(e) || !k.isTop()) return // a dialog or menu on top of the viewer owns the keys
      if ((e.target as HTMLElement)?.tagName === 'VIDEO' && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) return
      const z = k.zoom.get()
      const handled = () => e.preventDefault()
      if (e.key === 'Escape') {
        handled()
        e.stopPropagation()
        if (z.s > 1) k.zoom.reset()
        else k.onClose()
      } else if (z.s > 1 && e.key.startsWith('Arrow')) {
        handled()
        const d = 80
        k.zoom.panBy(e.key === 'ArrowLeft' ? d : e.key === 'ArrowRight' ? -d : 0, e.key === 'ArrowUp' ? d : e.key === 'ArrowDown' ? -d : 0)
      } else if (e.key === '+' || e.key === '=') {
        handled()
        k.zoom.step(1.5)
      } else if (e.key === '-' || e.key === '_') {
        handled()
        k.zoom.step(1 / 1.5)
      } else if (e.key === '0') {
        handled()
        k.zoom.reset()
      } else if (e.key === 'ArrowLeft' && k.prev) {
        handled()
        k.onGo(k.prev.id)
      } else if (e.key === 'ArrowRight' && k.next) {
        handled()
        k.onGo(k.next.id)
      } else if (e.key === 'i') {
        handled()
        k.toggleInfo()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  // Prefetch only the next original, when idle and on a fast connection; never more than one.
  const prefetch = useRef<HTMLImageElement | null>(null)
  const currentSrc = photo && !photo.video ? safeHref(photo.url) : null
  useEffect(() => {
    const src = next && !next.video ? safeHref(next.url) : null
    const old = prefetch.current
    if (old && old.src !== (src && new URL(src, location.href).href)) {
      // Cancel an unfinished prefetch we no longer need (unless it is the photo now on screen).
      if (!old.complete && old.src !== (currentSrc && new URL(currentSrc, location.href).href)) old.src = ''
      prefetch.current = null
    }
    if (!src || prefetch.current || !fastConnection()) return
    const run = () => {
      const im = new Image()
      im.decoding = 'async'
      im.src = src
      prefetch.current = im
    }
    const idle = 'requestIdleCallback' in window // not in older Safari
    const handle = idle ? window.requestIdleCallback(run, { timeout: 2000 }) : window.setTimeout(run, 300)
    return () => (idle ? window.cancelIdleCallback(handle) : window.clearTimeout(handle))
  }, [next, currentSrc])
  useEffect(
    () => () => {
      if (prefetch.current && !prefetch.current.complete) prefetch.current.src = ''
      prefetch.current = null
    },
    [],
  )

  // Swipe left/right on touch screens; down closes.
  const touch = useRef<{ x: number; y: number } | null>(null)
  const onPointerDown = (e: ReactPointerEvent) => {
    if (e.pointerType !== 'mouse' && e.isPrimary) touch.current = { x: e.clientX, y: e.clientY }
  }
  const onPointerUp = (e: ReactPointerEvent) => {
    const t = touch.current
    touch.current = null
    if (!t || zoom.get().s > 1 || zoom.wasPinching()) return
    const dx = e.clientX - t.x
    const dy = e.clientY - t.y
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      if (dx < 0 && next) onGo(next.id)
      if (dx > 0 && prev) onGo(prev.id)
    } else if (dy > 90 && Math.abs(dy) > Math.abs(dx) * 1.5) onClose()
  }

  const when = photo?.date_taken ? new Date(photo.date_taken) : null
  const position = index >= 0 ? `${index + 1} of ${items.length}${onNeedMore ? '+' : ''}` : ''
  const nav =
    'absolute top-1/2 z-2 grid size-12 -translate-y-1/2 place-items-center rounded-full border-0 bg-[rgba(32,33,36,0.55)] text-[#e8eaed] opacity-75 ' +
    'transition-[opacity,background] duration-150 hover:bg-[rgba(60,64,67,0.8)] hover:opacity-100 focus-visible:rounded-full focus-visible:outline-[#8ab4f8] ' +
    'group-data-zoomed/stage:pointer-events-none group-data-zoomed/stage:opacity-0 max-md:hidden touch:hidden'

  return createPortal(
    <div
      ref={root}
      className="viewer fixed inset-0 z-85 flex animate-[fade-in_0.15s_ease] bg-black text-[#e8eaed] outline-none max-md:flex-col"
      role="dialog"
      aria-modal="true"
      aria-label={photo?.video ? 'Video viewer' : 'Photo viewer'}
      tabIndex={-1}
    >
      {/* The zoomed photo stays inside its stage (clipped, own stacking context): it never paints over the info panel. */}
      <div
        ref={stage}
        className="group/stage relative isolate flex min-h-0 min-w-0 flex-1 touch-pan-y items-center justify-center overflow-hidden data-zoomed:cursor-grab data-zoomed:touch-none data-zoomed:data-dragging:cursor-grabbing"
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
      >
        <div
          data-viewer-chrome
          className="absolute inset-x-0 top-0 z-2 flex items-center gap-1 bg-[linear-gradient(rgba(0,0,0,0.6),transparent)] px-2 pt-[max(0.5rem,env(safe-area-inset-top,0px))] pb-6"
        >
          <button type="button" className={roundBtn} onClick={onClose} aria-label="Close (Esc)" title="Close (Esc)">
            <Icon name="x" size={20} />
          </button>
          <div className="grid min-w-0 flex-1 px-2 text-sm font-medium [&>span]:truncate">
            {when && <span>{fmtDate(when, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}</span>}
            {when && (
              <span className={cn('text-xs font-normal', dim)}>
                {fmtTime(when)}
                {photo?.city ? ` · ${photo.city}` : ''}
              </span>
            )}
          </div>
          <span className={cn('px-2 text-xs tabular-nums', dim)} aria-live="polite">
            {position}
          </span>
          {photo && <ViewerActions photo={photo} onLeave={() => (next ? onGo(next.id) : prev ? onGo(prev.id) : onClose())} />}
          <button
            type="button"
            className={cn(roundBtn, info && 'bg-white/12')}
            onClick={toggleInfo}
            aria-pressed={info}
            aria-label="Details (I)"
            title="Details (I)"
          >
            <Icon name="info" size={20} />
          </button>
        </div>
        {zoom.badge && (
          <span
            ref={zoom.badgeEl}
            className="pointer-events-none absolute bottom-5 left-1/2 z-5 -translate-x-1/2 animate-[fade-in_0.1s_ease] rounded-full bg-black/60 px-2.5 py-1 text-xs text-white tabular-nums"
            aria-live="polite"
          >
            {Math.round(zoom.state.s * 100)}%
          </span>
        )}
        {photo ? (
          <Media key={photo.id} photo={photo} view={zoom.state} fit={fit} onNatural={(w, h) => setNatural({ id: photo.id, w, h })} />
        ) : single.isError ? (
          <p className={dim}>This photo isn't available.</p>
        ) : (
          <span className={cn(spin, 'top-1/2 left-1/2 -m-3.5 size-7')} />
        )}
        {prev && (
          <button
            type="button"
            data-viewer-chrome
            className={cn(nav, 'left-3')}
            onClick={() => onGo(prev.id)}
            aria-label="Previous (Left arrow)"
          >
            <Icon name="chevronLeft" size={26} />
          </button>
        )}
        {next && (
          <button
            type="button"
            data-viewer-chrome
            className={cn(nav, 'right-3')}
            onClick={() => onGo(next.id)}
            aria-label="Next (Right arrow)"
          >
            <Icon name="chevronRight" size={26} />
          </button>
        )}
      </div>
      {info && photo && <InfoPanel photo={photo} onClose={toggleInfo} />}
    </div>,
    document.body,
  )
}

/** Share, download, hide and the "more" menu (open original, set as cover, delete original, delete). */
function ViewerActions({ photo, onLeave }: { photo: Photo; onLeave: () => void }) {
  const qc = useQueryClient()
  const album = albumContext.use()
  const hiddenMode = useHiddenMode().data?.show ?? false
  const libs = useLibraries().data
  const role = libs?.find((l) => l.id === photo.album_id)?.role
  const canEdit = role === 'owner' || role === 'editor'
  // Only hidden mode needs to know whether this photo is hidden (the info panel fills the same cache entry).
  const details = useQuery({ ...photoDetailsQuery(photo.id), enabled: hiddenMode }).data
  const isHidden = hiddenMode && !!details?.hidden
  const [del, setDel] = useState(false)
  const [delOrig, setDelOrig] = useState(false)
  const href = safeHref(photo.url)
  const freed = photo.size_total_kb && photo.size_kb && photo.size_total_kb > photo.size_kb ? photo.size_total_kb - photo.size_kb : 0
  const refresh = () => qc.invalidateQueries({ queryKey: ['photos'] })

  const hide = async () => {
    const hidden = !isHidden
    try {
      if (!(await setPhotosHidden([photo.id], hidden))) return toast.error('You can only hide your own photos.')
      // Outside hidden mode the photo leaves the timeline: move on first.
      if (hidden && !hiddenMode) onLeave()
      qc.setQueryData<PhotoDetails>(photoDetailsQuery(photo.id).queryKey, (old) => (old ? { ...old, hidden } : old))
      toast.show(hidden ? 'Hidden. Only you can reveal hidden items.' : 'Visible again', { action: undoHide(qc, [photo.id], hidden) })
      refresh()
    } catch (e) {
      toast.fail(e)
    }
  }
  const removeOriginal = async () => {
    try {
      const r = await deleteOriginal(photo.id)
      toast.show(r.freed_kb ? `Original deleted, ${fmtBytes(r.freed_kb)} freed` : 'Original removed')
      refresh()
    } catch (e) {
      toast.fail(e)
    }
  }
  return (
    <>
      <button type="button" className={roundBtn} onClick={() => copyLinks([href])} aria-label="Copy link" title="Copy link">
        <Icon name="link" size={18} />
      </button>
      {href && (
        <a className={cn(roundBtn, 'max-md:hidden')} href={href} download aria-label="Download original" title="Download">
          <Icon name="arrowDown" size={20} />
        </a>
      )}
      {role === 'owner' && (
        <button
          type="button"
          className={cn(roundBtn, isHidden && 'bg-white/12')}
          onClick={hide}
          aria-label={isHidden ? 'Unhide' : 'Hide'}
          title={isHidden ? 'Unhide' : 'Hide (only you can reveal it)'}
        >
          <Icon name="ban" size={18} />
        </button>
      )}
      <Menu
        align="end"
        label="More actions"
        trigger={(p) => (
          <button {...p} type="button" className={roundBtn} aria-label="More actions" title="More">
            <Icon name="moreV" size={20} />
          </button>
        )}
      >
        {(close) => (
          <>
            {href && (
              <MenuItem icon="external" href={href} onClick={close}>
                Open original
              </MenuItem>
            )}
            {href && (
              <MenuItem
                icon="arrowDown"
                onClick={() => {
                  close()
                  downloadFiles([href])
                }}
              >
                Download
              </MenuItem>
            )}
            <MenuItem
              icon="link"
              onClick={() => {
                close()
                copyLinks([href])
              }}
            >
              Copy link
            </MenuItem>
            {album?.mine && (
              <MenuItem
                icon="photo"
                onClick={() => {
                  close()
                  setAlbumCover(qc, album, photo.id)
                }}
              >
                Set as album cover
              </MenuItem>
            )}
            {canEdit && photo.has_orig && (
              <MenuItem
                icon="layers"
                onClick={() => {
                  close()
                  setDelOrig(true)
                }}
                end={freed ? fmtBytes(freed) : undefined}
              >
                Delete original
              </MenuItem>
            )}
            {canEdit && (
              <>
                <MenuSeparator />
                <MenuItem
                  icon="trash"
                  danger
                  onClick={() => {
                    close()
                    setDel(true)
                  }}
                >
                  Delete…
                </MenuItem>
              </>
            )}
          </>
        )}
      </Menu>
      <Confirm
        open={delOrig}
        onClose={() => setDelOrig(false)}
        title={photo.video ? 'Delete the original video?' : 'Delete the original file?'}
        confirmLabel="Delete original"
        body={
          <>
            This frees {freed ? <strong>about {fmtBytes(freed)}</strong> : 'disk space'} and keeps the optimized{' '}
            {photo.video ? 'video' : 'photo'} ({photo.size_kb ? fmtBytes(photo.size_kb) : 'smaller copy'}) in your library. It can't be
            undone.
          </>
        }
        onConfirm={removeOriginal}
      />
      {del && (
        <DeleteDialog
          ids={[photo.id]}
          onClose={() => setDel(false)}
          onDone={() => {
            onLeave()
            refresh()
          }}
        />
      )}
    </>
  )
}

function Media({
  photo,
  view,
  fit,
  onNatural,
}: {
  photo: Photo
  view: ZoomState
  fit: Fit | null
  onNatural: (w: number, h: number) => void
}) {
  const full = safeHref(photo.url)
  const thumb = safeHref(photo.thumb_url)
  const [loaded, setLoaded] = useState(false)
  const ratio = photo.aspect > 0 ? photo.aspect : 1
  const media = 'absolute inset-0 grid place-items-center px-18 pt-14 pb-6 [container-type:size] max-md:px-0 max-md:pb-4'
  if (photo.video) {
    return (
      <div className={media}>
        {full ? (
          <video
            className="relative grid aspect-[var(--ar,1)] w-[min(100cqw,100cqh*var(--ar,1))] overflow-hidden bg-black"
            src={full}
            poster={thumb ?? undefined}
            controls
            autoPlay
            playsInline
            preload="metadata"
            style={{ '--ar': ratio } as CSSProperties}
          />
        ) : (
          <p className={dim}>This video isn't available.</p>
        )}
      </div>
    )
  }
  // No permanent will-change: a promoted layer keeps its first raster scale and goes soft when zoomed.
  const layer = cn(
    'absolute top-0 left-0 max-w-none origin-top-left select-none [-webkit-user-drag:none]',
    view.animate && 'transition-transform duration-200 ease-out',
  )
  return (
    <div className={media}>
      {fit && (
        <>
          {/* Blurred placeholder at fit size (a filter on a natural-size layer would be costly). */}
          {/* Kept until the original has decoded, then swapped in one frame (no fade, no black gap). */}
          {thumb && !loaded && (
            <img
              className={cn(layer, 'object-cover blur-[8px]')}
              data-zoom-layer="thumb"
              src={thumb}
              alt=""
              aria-hidden="true"
              draggable={false}
              style={{ width: fit.w, height: fit.h, transform: layerTransform('thumb', fit, view) }}
            />
          )}
          {full && (
            <img
              className={cn(layer, 'group-data-dragging/stage:will-change-transform', !loaded && 'opacity-0')}
              data-zoom-layer="img"
              src={full}
              alt={photo.city ? `Photo in ${photo.city}` : 'Photo'}
              draggable={false}
              decoding="async"
              style={{ width: fit.W, height: fit.H, transform: layerTransform('img', fit, view) }}
              onLoad={(e) => {
                const im = e.currentTarget
                if (im.naturalWidth && im.naturalHeight) onNatural(im.naturalWidth, im.naturalHeight)
                // Decode off the main thread before showing, so the swap doesn't jank.
                im.decode()
                  .catch(() => undefined)
                  .then(() => setLoaded(true))
              }}
            />
          )}
        </>
      )}
      {!loaded && <span className={cn(spin, 'right-4 bottom-4 size-4')} role="status" aria-label="Loading full size" />}
    </div>
  )
}

/** Prefetching a full original is skipped on Save-Data or anything slower than 4G. Unknown = fast. */
function fastConnection(): boolean {
  const c = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection
  return !c || (!c.saveData && (!c.effectiveType || c.effectiveType === '4g'))
}

/** Natural pixel size: the decoded image's once loaded, else the API's (swapped if it disagrees with aspect). */
function naturalSize(photo: Photo, natural: { id: string; w: number; h: number } | null): { w: number; h: number } {
  if (natural && natural.id === photo.id) return natural
  const ar = Math.max(photo.aspect, 0)
  let w = photo.width ?? 0
  let h = photo.height ?? 0
  if (w > 0 && h > 0) {
    if (ar && Math.abs(h / w - ar) < Math.abs(w / h - ar)) [w, h] = [h, w]
    return { w, h }
  }
  return { w: 2048, h: Math.round(2048 / (ar || 1)) }
}

/** Fit box of a W×H image inside the stage (minus the chrome padding), in stage pixels. */
function useFit(stage: RefObject<HTMLDivElement | null>, W: number, H: number): Fit | null {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null)
  useLayoutEffect(() => {
    const st = stage.current
    if (!st) return
    const measure = () =>
      setSize((o) => (o && o.w === st.clientWidth && o.h === st.clientHeight ? o : { w: st.clientWidth, h: st.clientHeight }))
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(st)
    return () => ro.disconnect()
  }, [stage])
  return useMemo(() => {
    if (!size || !W || !H) return null
    // Same padding as the media box (3.5rem top; 4.5rem sides and 1.5rem bottom, or 0 and 1rem on phones).
    const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16
    const phone = window.matchMedia(PHONE_QUERY).matches
    const top = 3.5 * rem
    const side = phone ? 0 : 4.5 * rem
    const bottom = (phone ? 1 : 1.5) * rem
    const aw = Math.max(1, size.w - 2 * side)
    const ah = Math.max(1, size.h - top - bottom)
    const f = Math.min(aw / W, ah / H)
    const w = W * f
    const h = H * f
    return { ox: side + (aw - w) / 2, oy: top + (ah - h) / 2, w, h, f, W, H }
  }, [size, W, H])
}
