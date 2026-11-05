// Full-screen photo/video viewer: arrows or swipe to move, Esc to close, "i" for details.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type CSSProperties, type ReactNode, type RefObject } from 'react'
import { Link } from 'react-router'
import { createPortal } from 'react-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { get, post, safeHref } from '../../lib/api'
import { fmtDate, fmtTime } from '../../lib/dates'
import type { Photo } from '../../lib/types'
import { Icon } from '../../components/Icon'
import { Confirm, Menu, MenuItem, isTyping } from '../../components/ui'
import { toast } from '../../components/toast'
import { fmtBytes, fmtDuration } from './util'
import { albumContext, DeleteDialog } from './select'
import { copyLinks, deleteOriginal, setAlbumCover, useHiddenMode, useLibraries } from './actions'

const INFO_KEY = 'app.photos.info'

export function Viewer({ id, items, onGo, onClose, onNeedMore }: {
  id: string
  items: Photo[]
  onGo: (id: string) => void
  onClose: () => void
  onNeedMore?: () => void
}) {
  const index = items.findIndex((p) => p.id === id)
  // Deep link to a photo that isn't in the loaded pages: fetch it on its own.
  const single = useQuery({ queryKey: ['photos', 'photo', id], queryFn: () => get<Photo>(`photos/${id}`), enabled: index < 0 })
  const photo = index >= 0 ? items[index] : single.data
  const prev = index > 0 ? items[index - 1] : null
  const next = index >= 0 && index < items.length - 1 ? items[index + 1] : null
  const [info, setInfo] = useState(() => {
    try {
      return localStorage.getItem(INFO_KEY) === '1'
    } catch {
      return false
    }
  })
  const root = useRef<HTMLDivElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  // The image is laid out at its natural pixel size and scaled down to fit, so zooming in
  // rasterises from the full-resolution pixels instead of upscaling a screen-sized bitmap.
  const [natural, setNatural] = useState<{ id: string; w: number; h: number } | null>(null)
  const dims = photo && !photo.video ? naturalSize(photo, natural) : null
  const fit = useFit(stage, dims?.w ?? 0, dims?.h ?? 0)
  const zoom = useZoom(stage, !!photo && !photo.video, photo?.id ?? '', fit)

  const toggleInfo = () =>
    setInfo((v) => {
      try {
        localStorage.setItem(INFO_KEY, v ? '0' : '1')
      } catch { /* ignore */ }
      return !v
    })

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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (isTyping(e) || document.querySelector('.dialog, .menu')) return // a dialog or menu on top of the viewer owns the keys
      if ((e.target as HTMLElement)?.tagName === 'VIDEO' && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) return
      const z = zoom.get()
      if (e.key === 'Escape' && z.s > 1) (e.preventDefault(), e.stopPropagation(), zoom.reset())
      else if (e.key === 'Escape') (e.preventDefault(), e.stopPropagation(), onClose())
      else if (z.s > 1 && e.key.startsWith('Arrow')) {
        e.preventDefault()
        const d = 80
        zoom.panBy(e.key === 'ArrowLeft' ? d : e.key === 'ArrowRight' ? -d : 0, e.key === 'ArrowUp' ? d : e.key === 'ArrowDown' ? -d : 0)
      } else if (e.key === '+' || e.key === '=') (e.preventDefault(), zoom.step(1.5))
      else if (e.key === '-' || e.key === '_') (e.preventDefault(), zoom.step(1 / 1.5))
      else if (e.key === '0') (e.preventDefault(), zoom.reset())
      else if (e.key === 'ArrowLeft' && prev) (e.preventDefault(), onGo(prev.id))
      else if (e.key === 'ArrowRight' && next) (e.preventDefault(), onGo(next.id))
      else if (e.key === 'i') (e.preventDefault(), toggleInfo())
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [prev, next, onGo, onClose, zoom])

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
    const id = idle ? window.requestIdleCallback(run, { timeout: 2000 }) : window.setTimeout(run, 300)
    return () => (idle ? window.cancelIdleCallback(id) : window.clearTimeout(id))
  }, [next, currentSrc])
  useEffect(() => () => {
    if (prefetch.current && !prefetch.current.complete) prefetch.current.src = ''
    prefetch.current = null
  }, [])

  // Swipe left/right on touch screens.
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

  return createPortal(
    <div
      ref={root}
      className={'viewer' + (info ? ' with-info' : '')}
      role="dialog"
      aria-modal="true"
      aria-label={photo?.video ? 'Video viewer' : 'Photo viewer'}
      tabIndex={-1}
    >
      <div className={'viewer-stage' + (zoom.state.s > 1 ? ' zoomed' : '') + (zoom.state.dragging ? ' dragging' : '')} ref={stage} onPointerDown={onPointerDown} onPointerUp={onPointerUp}>
        <div className="viewer-top">
          <button className="viewer-btn" onClick={onClose} aria-label="Close (Esc)" title="Close (Esc)">
            <Icon name="x" size={20} />
          </button>
          <div className="viewer-title">
            {when && <span>{fmtDate(when, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}</span>}
            {when && <span className="viewer-sub">{fmtTime(when)}{photo?.city ? ` · ${photo.city}` : ''}</span>}
          </div>
          <span className="viewer-pos" aria-live="polite">{position}</span>
          {photo && <ViewerActions photo={photo} onLeave={() => (next ? onGo(next.id) : prev ? onGo(prev.id) : onClose())} />}
          <button className={'viewer-btn' + (info ? ' on' : '')} onClick={toggleInfo} aria-pressed={info} aria-label="Details (I)" title="Details (I)">
            <Icon name="info" size={20} />
          </button>
        </div>
        {zoom.state.badge && <span className="viewer-zoom" aria-live="polite">{Math.round(zoom.state.s * 100)}%</span>}
        {photo ? <Media key={photo.id} photo={photo} transform={zoom.state} fit={fit} onNatural={(w, h) => setNatural({ id: photo.id, w, h })} /> : single.isError ? <p className="viewer-msg">This photo isn't available.</p> : <span className="spinner viewer-spin" />}
        {prev && (
          <button className="viewer-nav prev" onClick={() => onGo(prev.id)} aria-label="Previous (Left arrow)">
            <Icon name="chevronLeft" size={26} />
          </button>
        )}
        {next && (
          <button className="viewer-nav next" onClick={() => onGo(next.id)} aria-label="Next (Right arrow)">
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
  // Only hidden mode needs to know whether this photo is hidden (same cache entry as the info panel).
  const details = useQuery({
    queryKey: ['photos', 'details', photo.id],
    queryFn: () => get<PhotoDetails>(`photos/${photo.id}/details`),
    staleTime: 10 * 60_000,
    enabled: hiddenMode, // disabled queries still read the cache the info panel fills
  }).data
  const isHidden = hiddenMode && !!details?.hidden
  const [del, setDel] = useState(false)
  const [delOrig, setDelOrig] = useState(false)
  const href = safeHref(photo.url)
  const freed = photo.size_total_kb && photo.size_kb && photo.size_total_kb > photo.size_kb ? photo.size_total_kb - photo.size_kb : 0
  const refresh = () => qc.invalidateQueries({ queryKey: ['photos'] })

  const hide = async () => {
    const hidden = !isHidden
    try {
      const r = await post<{ changed: number }>('photos/hide', { ids: [photo.id], hidden })
      if (!r.changed) return toast.error('You can only hide your own photos.')
      // Outside hidden mode the photo leaves the timeline: move on first.
      if (hidden && !hiddenMode) onLeave()
      qc.setQueryData<PhotoDetails>(['photos', 'details', photo.id], (old) => (old ? { ...old, hidden } : old))
      toast.show(hidden ? 'Hidden. Only you can reveal hidden items.' : 'Visible again', {
        action: { label: 'Undo', run: () => post('photos/hide', { ids: [photo.id], hidden: !hidden }).then(refresh) },
      })
      refresh()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }
  const removeOriginal = async () => {
    try {
      const r = await deleteOriginal(photo.id)
      toast.show(r.freed_kb ? `Original deleted, ${fmtBytes(r.freed_kb)} freed` : 'Original removed')
      refresh()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }
  return (
    <>
      <button className="viewer-btn" onClick={() => copyLinks([href])} aria-label="Copy link" title="Copy link"><Icon name="link" size={18} /></button>
      {href && <a className="viewer-btn hide-phone" href={href} download aria-label="Download original" title="Download"><Icon name="arrowDown" size={20} /></a>}
      {role === 'owner' && (
        <button className={'viewer-btn' + (isHidden ? ' on' : '')} onClick={hide} aria-label={isHidden ? 'Unhide' : 'Hide'} title={isHidden ? 'Unhide' : 'Hide (only you can reveal it)'}><Icon name="ban" size={18} /></button>
      )}
      <Menu align="end" label="More actions" trigger={(p) => <button {...p} className="viewer-btn" aria-label="More actions" title="More"><Icon name="moreV" size={20} /></button>}>
        {(close) => (
          <>
            {href && <MenuItem icon="external" href={href} onClick={close}>Open original</MenuItem>}
            {href && <MenuItem icon="arrowDown" onClick={() => { close(); const a = document.createElement('a'); a.href = href; a.download = ''; document.body.append(a); a.click(); a.remove() }}>Download</MenuItem>}
            <MenuItem icon="link" onClick={() => (close(), copyLinks([href]))}>Copy link</MenuItem>
            {album?.mine && <MenuItem icon="photo" onClick={() => (close(), setAlbumCover(qc, album, photo.id))}>Set as album cover</MenuItem>}
            {canEdit && photo.has_orig && <MenuItem icon="layers" onClick={() => (close(), setDelOrig(true))} end={freed ? fmtBytes(freed) : undefined}>Delete original</MenuItem>}
            {canEdit && <><div className="menu-sep" /><MenuItem icon="trash" danger onClick={() => (close(), setDel(true))}>Delete…</MenuItem></>}
          </>
        )}
      </Menu>
      <Confirm open={delOrig} onClose={() => setDelOrig(false)} title={photo.video ? 'Delete the original video?' : 'Delete the original file?'} confirmLabel="Delete original"
        body={<>This frees {freed ? <strong>about {fmtBytes(freed)}</strong> : 'disk space'} and keeps the optimized {photo.video ? 'video' : 'photo'} ({photo.size_kb ? fmtBytes(photo.size_kb) : 'smaller copy'}) in your library. It can't be undone.</>}
        onConfirm={removeOriginal} />
      {del && <DeleteDialog ids={[photo.id]} onClose={() => setDel(false)} onDone={() => (onLeave(), refresh())} />}
    </>
  )
}

function Media({ photo, transform, fit, onNatural }: { photo: Photo; transform: ZoomState; fit: Fit | null; onNatural: (w: number, h: number) => void }) {
  const full = safeHref(photo.url)
  const thumb = safeHref(photo.thumb_url)
  const [loaded, setLoaded] = useState(false)
  const ratio = photo.aspect > 0 ? photo.aspect : 1
  if (photo.video) {
    return (
      <div className="viewer-media">
        {full ? (
          <video className="viewer-video" src={full} poster={thumb ?? undefined} controls autoPlay playsInline preload="metadata" style={{ '--ar': ratio } as CSSProperties} />
        ) : (
          <p className="viewer-msg">This video isn't available.</p>
        )}
      </div>
    )
  }
  const { s, tx, ty } = transform
  const anim = transform.animate ? ' animate' : ''
  return (
    <div className="viewer-media">
      {fit && (
        <>
          {/* Blurred placeholder at fit size (a filter on a natural-size layer would be costly). */}
          {/* Kept until the original has decoded, then swapped in one frame (no fade, no black gap). */}
          {thumb && !loaded && (
            <img className={'viewer-thumb' + anim} src={thumb} alt="" aria-hidden="true" draggable={false}
              style={{ width: fit.w, height: fit.h, transform: `translate(${fit.ox + tx}px, ${fit.oy + ty}px) scale(${s})` }} />
          )}
          {full && (
            <img className={'viewer-img' + anim + (loaded ? ' loaded' : '')} data-zoom-frame src={full} alt={photo.city ? `Photo in ${photo.city}` : 'Photo'} draggable={false} decoding="async"
              style={{ width: fit.W, height: fit.H, transform: `translate(${fit.ox + tx}px, ${fit.oy + ty}px) scale(${fit.f * s})` }}
              onLoad={(e) => {
                const im = e.currentTarget
                if (im.naturalWidth && im.naturalHeight) onNatural(im.naturalWidth, im.naturalHeight)
                // Decode off the main thread before showing, so the swap doesn't jank.
                im.decode().catch(() => undefined).then(() => setLoaded(true))
              }} />
          )}
        </>
      )}
      {!loaded && <span className="spinner viewer-spin small" aria-label="Loading full size" />}
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
  const ar = photo.aspect > 0 ? photo.aspect : 0
  let w = photo.width ?? 0, h = photo.height ?? 0
  if (w > 0 && h > 0) {
    if (ar && Math.abs(h / w - ar) < Math.abs(w / h - ar)) [w, h] = [h, w]
    return { w, h }
  }
  return { w: 2048, h: Math.round(2048 / (ar || 1)) }
}

/** Fit box of a W×H image inside the stage (minus the chrome padding), in stage pixels. */
type Fit = { ox: number; oy: number; w: number; h: number; f: number; W: number; H: number }
function useFit(stage: RefObject<HTMLDivElement | null>, W: number, H: number): Fit | null {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null)
  useLayoutEffect(() => {
    const st = stage.current
    if (!st) return
    const measure = () => setSize((o) => (o && o.w === st.clientWidth && o.h === st.clientHeight ? o : { w: st.clientWidth, h: st.clientHeight }))
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(st)
    return () => ro.disconnect()
  }, [stage])
  return useMemo(() => {
    if (!size || !W || !H) return null
    // Same padding as .viewer-media (3.5rem top; 4.5rem sides and 1.5rem bottom, or 0 and 1rem on phones).
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16
    const phone = window.matchMedia('(max-width: 760px)').matches
    const top = 3.5 * rem, side = phone ? 0 : 4.5 * rem, bottom = (phone ? 1 : 1.5) * rem
    const aw = Math.max(1, size.w - 2 * side), ah = Math.max(1, size.h - top - bottom)
    const f = Math.min(aw / W, ah / H)
    const w = W * f, h = H * f
    return { ox: side + (aw - w) / 2, oy: top + (ah - h) / 2, w, h, f, W, H }
  }, [size, W, H])
}

interface PhotoDetails extends Photo {
  filename: string; library: string; mimetype: string | null; size_kb: number | null; size_total_kb: number | null; megapixels: number | null
  camera_make: string | null; camera_model: string | null; exposure: string | null; fnumber: string | null; isospeed: string | null
  shutterspeed: string | null; aperture: string | null; flash: string | null; focallength: string | null; altitude: number | null
  framerate: number | null; bitrate: number | null; has_raw: boolean; has_orig: boolean; blur: number | null
  objects: ({ id: number; name: string } | string)[]; hidden?: boolean; mine?: boolean
}

const num = (v: string | number | null | undefined) => (v === null || v === undefined || v === '' ? null : Number(v))
function shutter(v: string | null): string | null {
  const s = num(v)
  if (!s || !isFinite(s)) return null
  return s >= 1 ? `${s.toFixed(1).replace(/\.0$/, '')} s` : `1/${Math.round(1 / s)} s`
}

/** A small static OSM tile with a pin (z14), linking to the full map. */
function MiniMap({ lat, lon }: { lat: number; lon: number }) {
  const z = 14
  const x = ((lon + 180) / 360) * 2 ** z
  const r = (lat * Math.PI) / 180
  const y = ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z
  const [tx, ty] = [Math.floor(x), Math.floor(y)]
  const osm = `https://www.openstreetmap.org/?mlat=${lat.toFixed(5)}&mlon=${lon.toFixed(5)}#map=16/${lat.toFixed(5)}/${lon.toFixed(5)}`
  return (
    <a className="mini-map" href={osm} target="_blank" rel="noopener noreferrer" aria-label="Open in OpenStreetMap">
      <img src={`https://a.tile.openstreetmap.org/${z}/${tx}/${ty}.png`} alt="" loading="lazy" referrerPolicy="strict-origin-when-cross-origin" />
      <span className="mini-pin" style={{ left: `${(x - tx) * 100}%`, top: `${(y - ty) * 100}%` }} aria-hidden="true"><Icon name="map-pin" size={22} /></span>
    </a>
  )
}

function InfoPanel({ photo, onClose }: { photo: Photo; onClose: () => void }) {
  const q = useQuery({ queryKey: ['photos', 'details', photo.id], queryFn: () => get<PhotoDetails>(`photos/${photo.id}/details`), staleTime: 10 * 60_000 })
  const d: Partial<PhotoDetails> & Photo = { ...photo, ...(q.data ?? {}) }
  const when = d.date_taken ? new Date(d.date_taken) : null
  const lat = typeof d.lat === 'number' && isFinite(d.lat) ? d.lat : null
  const lon = typeof d.lon === 'number' && isFinite(d.lon) ? d.lon : null
  const mp = d.megapixels ?? (d.width && d.height ? (d.width * d.height) / 1e6 : null)
  const exposure = [
    num(d.fnumber) ? `f/${num(d.fnumber)}` : null,
    shutter(d.shutterspeed ?? d.exposure ?? null),
    num(d.isospeed) ? `ISO ${num(d.isospeed)}` : null,
    num(d.focallength) ? `${num(d.focallength)} mm` : null,
  ].filter(Boolean)
  const flash = d.flash !== undefined && d.flash !== null && d.flash !== '' ? (Number(d.flash) % 2 === 1 ? 'Flash fired' : 'No flash') : null
  const row = (icon: string, children: ReactNode, key = icon) => (
    <div key={key}><dt><Icon name={icon} /></dt><dd>{children}</dd></div>
  )
  return (
    <aside className="viewer-info" aria-label="Details">
      <div className="viewer-info-head">
        <h2>Details</h2>
        <span className="spacer" />
        <button className="btn ghost icon sm" onClick={onClose} aria-label="Close details"><Icon name="x" /></button>
      </div>
      <dl className="viewer-dl">
        {when && row('calendar', <><div>{fmtDate(when, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</div><div className="muted">{fmtTime(when)}</div></>)}
        {row(d.video ? 'video' : 'photo', (
          <>
            <div className="truncate" title={d.filename}>{d.filename || (d.video ? 'Video' : 'Photo')}</div>
            <div className="muted tabular">
              {[d.width && d.height ? `${d.width} × ${d.height}` : '', mp && !d.video ? `${mp.toFixed(1)} MP` : '', d.size_kb ? fmtBytes(d.size_kb) : ''].filter(Boolean).join(' · ')}
            </div>
            {d.size_total_kb && d.size_kb && d.size_total_kb > d.size_kb && <div className="muted xsmall">{fmtBytes(d.size_total_kb)} with originals</div>}
            <div className="viewer-badges">
              {d.library && <span className="chip">{d.library}</span>}
              {d.mimetype && <span className="chip">{d.mimetype.replace(/^\w+\//, '').toUpperCase()}</span>}
              {d.has_raw && <span className="chip accent">RAW</span>}
              {d.has_orig && <span className="chip accent">Original</span>}
            </div>
          </>
        ), 'file')}
        {d.video && (d.length || d.framerate || d.bitrate) ? row('play', <div className="tabular">{[d.length ? fmtDuration(d.length) : '', d.framerate ? `${Math.round(d.framerate)} fps` : '', d.bitrate ? `${(d.bitrate / 1e6).toFixed(1)} Mbps` : ''].filter(Boolean).join(' · ')}</div>, 'vid') : null}
        {(d.camera_make || d.camera_model || d.camera) && row('camera', (
          <>
            <div>{[d.camera_make, d.camera_model].filter(Boolean).join(' ') || d.camera}</div>
            {exposure.length > 0 && <div className="muted tabular">{exposure.join(' · ')}</div>}
            {flash && <div className="muted xsmall">{flash}{num(d.aperture) ? ` · aperture ${num(d.aperture)}` : ''}</div>}
          </>
        ), 'cam')}
        {(d.city || d.country || lat !== null) && row('pin', (
          <>
            {(d.city || d.country) && <div>{[d.city, d.country].filter(Boolean).join(', ')}</div>}
            {lat !== null && lon !== null && (
              <>
                <div className="muted tabular">{lat.toFixed(5)}, {lon.toFixed(5)}{d.altitude !== null && d.altitude !== undefined ? ` · ${Math.round(d.altitude)} m` : ''}</div>
                <MiniMap lat={lat} lon={lon} />
              </>
            )}
          </>
        ), 'loc')}
        {(lat === null || lon === null || (lat === 0 && lon === 0)) && row('pin', (
          <Link className="viewer-addloc" to={`/photos/locate?photo=${d.id}`}><Icon name="plus" size={14} />Add location</Link>
        ), 'addloc')}
        {d.hidden && row('ban', <span className="chip warning">Hidden: only you can see it</span>, 'hid')}
        {d.blur !== null && d.blur !== undefined && row('sparkle', <span className="muted">Sharpness score {Math.round(d.blur)}</span>, 'blur')}
        {d.objects && d.objects.length > 0 && row('tag', (
          <div className="viewer-badges">
            {d.objects.map((o) => {
              const name = typeof o === 'string' ? o : o.name
              return <Link key={name} className="chip" to={`/photos?objects=${encodeURIComponent(name)}`} onClick={onClose}>{name}</Link>
            })}
          </div>
        ), 'obj')}
      </dl>
    </aside>
  )
}

// ---------------------------------------------------------------- zoom (Google Photos style)
type ZoomState = { s: number; tx: number; ty: number; animate: boolean; dragging: boolean; badge: boolean }
const MIN = 1
const MAX = 8
const reduced = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/**
 * Wheel/pinch zoom around the cursor (1×–8×), drag or two-finger pan clamped to the image, double
 * click/tap toggles 2.5×. tx/ty/s are relative to the fit box; the image itself is laid out at its
 * natural size and drawn with translate(fit + t) scale(fit × s), origin 0 0, so it stays sharp.
 */
function useZoom(stage: RefObject<HTMLDivElement | null>, enabled: boolean, photoId: string, fit: Fit | null) {
  const [state, setState] = useState<ZoomState>({ s: 1, tx: 0, ty: 0, animate: false, dragging: false, badge: false })
  const cur = useRef(state)
  cur.current = state
  const badgeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pinched = useRef(false)

  const fitRef = useRef(fit)
  fitRef.current = fit
  /** The unzoomed (fit) box, relative to the stage; tx/ty/s are applied on top of it. */
  const frameBox = () => {
    const st = stage.current
    const g = fitRef.current
    if (!st || !g) return null
    return { sr: st.getBoundingClientRect(), ox: g.ox, oy: g.oy, w: g.w, h: g.h }
  }
  const clamp = (s: number, tx: number, ty: number) => {
    const b = frameBox()
    if (!b) return { tx, ty }
    const W = b.w * s, H = b.h * s, Cw = b.sr.width, Ch = b.sr.height
    const cx = W <= Cw ? (b.w - W) / 2 : Math.min(-b.ox, Math.max(Cw - W - b.ox, tx))
    const cy = H <= Ch ? (b.h - H) / 2 : Math.min(-b.oy, Math.max(Ch - H - b.oy, ty))
    return { tx: cx, ty: cy }
  }
  const set = useCallback((s: number, tx: number, ty: number, animate = false, extra: Partial<ZoomState> = {}) => {
    s = Math.min(MAX, Math.max(MIN, s))
    const c = s === 1 ? { tx: 0, ty: 0 } : clamp(s, tx, ty)
    if (badgeTimer.current) clearTimeout(badgeTimer.current)
    badgeTimer.current = setTimeout(() => setState((x) => ({ ...x, badge: false })), 900)
    setState((x) => ({ ...x, s, ...c, animate: animate && !reduced(), badge: true, ...extra }))
  }, [])
  /** Zoom to scale s keeping the screen point (px, py) fixed. */
  const zoomAt = useCallback((s: number, px: number, py: number, animate = false) => {
    const b = frameBox()
    const z = cur.current
    if (!b) return
    const lx = px - b.sr.left - b.ox // point in the frame's layout space
    const ly = py - b.sr.top - b.oy
    const u = (lx - z.tx) / z.s
    const v = (ly - z.ty) / z.s
    const ns = Math.min(MAX, Math.max(MIN, s))
    set(ns, lx - u * ns, ly - v * ns, animate)
  }, [set])

  // Reset when the photo changes.
  useEffect(() => setState({ s: 1, tx: 0, ty: 0, animate: false, dragging: false, badge: false }), [photoId])
  // The stage resized (window, details panel): keep the zoomed view inside the new bounds.
  useEffect(() => {
    const z = cur.current
    if (z.s > 1) setState((x) => ({ ...x, ...clamp(x.s, x.tx, x.ty), animate: false }))
  }, [fit])

  useEffect(() => {
    const st = stage.current
    if (!st || !enabled) return
    const onWheel = (e: WheelEvent) => {
      if ((e.target as HTMLElement).closest('.viewer-top, .viewer-nav')) return
      e.preventDefault() // a plain wheel never switches photos
      const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0025))
      zoomAt(cur.current.s * factor, e.clientX, e.clientY)
    }
    const onDbl = (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest('.viewer-top, .viewer-nav')) return
      zoomAt(cur.current.s > 1 ? 1 : 2.5, e.clientX, e.clientY, true)
    }
    // Pointers: one = drag pan (when zoomed), two = pinch + pan. Double-tap toggles.
    const pts = new Map<number, { x: number; y: number }>()
    let last: { d: number; cx: number; cy: number } | null = null
    let drag: { x: number; y: number } | null = null
    let lastTap = 0
    const down = (e: PointerEvent) => {
      if ((e.target as HTMLElement).closest('.viewer-top, .viewer-nav')) return
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (pts.size === 1) {
        pinched.current = false
        if (e.pointerType !== 'mouse') {
          const now = Date.now()
          if (now - lastTap < 300) zoomAt(cur.current.s > 1 ? 1 : 2.5, e.clientX, e.clientY, true)
          lastTap = now
        }
        if (cur.current.s > 1) {
          drag = { x: e.clientX, y: e.clientY }
          st.setPointerCapture?.(e.pointerId)
          setState((x) => ({ ...x, dragging: true, animate: false }))
        }
      }
      if (pts.size === 2) {
        pinched.current = true
        drag = null
        const [a, b] = [...pts.values()]
        last = { d: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 }
      }
    }
    const move = (e: PointerEvent) => {
      if (!pts.has(e.pointerId)) return
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY })
      const z = cur.current
      if (pts.size === 2 && last) {
        const [a, b] = [...pts.values()]
        const d = Math.hypot(a.x - b.x, a.y - b.y)
        const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2
        const ns = Math.min(MAX, Math.max(MIN, z.s * (d / last.d)))
        // zoom around the pinch centre, then follow the centre's movement (two-finger pan)
        const box = frameBox()
        if (box) {
          const lx = last.cx - box.sr.left - box.ox, ly = last.cy - box.sr.top - box.oy
          const u = (lx - z.tx) / z.s, v = (ly - z.ty) / z.s
          set(ns, lx - u * ns + (cx - last.cx), ly - v * ns + (cy - last.cy))
        }
        last = { d, cx, cy }
      } else if (drag && z.s > 1) {
        set(z.s, z.tx + (e.clientX - drag.x), z.ty + (e.clientY - drag.y), false, { dragging: true })
        drag = { x: e.clientX, y: e.clientY }
      }
    }
    const up = (e: PointerEvent) => {
      pts.delete(e.pointerId)
      if (pts.size < 2) last = null
      if (pts.size === 0) {
        drag = null
        setState((x) => (x.dragging ? { ...x, dragging: false } : x))
      }
    }
    st.addEventListener('wheel', onWheel, { passive: false })
    st.addEventListener('dblclick', onDbl)
    st.addEventListener('pointerdown', down)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    return () => {
      st.removeEventListener('wheel', onWheel)
      st.removeEventListener('dblclick', onDbl)
      st.removeEventListener('pointerdown', down)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
  }, [enabled, zoomAt, set])

  return useMemo(() => ({
    state,
    get: () => cur.current,
    wasPinching: () => pinched.current,
    reset: () => set(1, 0, 0, true),
    step: (f: number) => {
      const r = stage.current?.getBoundingClientRect()
      if (r) zoomAt(cur.current.s * f, r.left + r.width / 2, r.top + r.height / 2, true)
    },
    panBy: (dx: number, dy: number) => set(cur.current.s, cur.current.tx + dx, cur.current.ty + dy, true),
  }), [state, set, zoomAt])
}
