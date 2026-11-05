// Full-screen photo/video viewer: arrows or swipe to move, Esc to close, "i" for details.
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type CSSProperties, type ReactNode } from 'react'
import { Link } from 'react-router'
import { createPortal } from 'react-dom'
import { useQuery } from '@tanstack/react-query'
import { get, safeHref } from '../../lib/api'
import { fmtDate, fmtTime } from '../../lib/dates'
import type { Photo } from '../../lib/types'
import { Icon } from '../../components/Icon'
import { fmtBytes, fmtDuration } from './util'

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
      if ((e.target as HTMLElement)?.tagName === 'VIDEO' && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) return
      if (e.key === 'Escape') (e.preventDefault(), e.stopPropagation(), onClose())
      else if (e.key === 'ArrowLeft' && prev) (e.preventDefault(), onGo(prev.id))
      else if (e.key === 'ArrowRight' && next) (e.preventDefault(), onGo(next.id))
      else if (e.key === 'i') (e.preventDefault(), toggleInfo())
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [prev, next, onGo, onClose])

  // Preload the neighbours' full images so arrowing feels instant.
  useEffect(() => {
    for (const p of [prev, next]) {
      const src = p && !p.video ? safeHref(p.url) : null
      if (src) new Image().src = src
    }
  }, [prev, next])

  // Swipe left/right on touch screens.
  const touch = useRef<{ x: number; y: number } | null>(null)
  const onPointerDown = (e: ReactPointerEvent) => {
    if (e.pointerType !== 'mouse') touch.current = { x: e.clientX, y: e.clientY }
  }
  const onPointerUp = (e: ReactPointerEvent) => {
    const t = touch.current
    touch.current = null
    if (!t) return
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
      <div className="viewer-stage" onPointerDown={onPointerDown} onPointerUp={onPointerUp}>
        <div className="viewer-top">
          <button className="viewer-btn" onClick={onClose} aria-label="Close (Esc)" title="Close (Esc)">
            <Icon name="x" size={20} />
          </button>
          <div className="viewer-title">
            {when && <span>{fmtDate(when, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}</span>}
            {when && <span className="viewer-sub">{fmtTime(when)}{photo?.city ? ` · ${photo.city}` : ''}</span>}
          </div>
          <span className="viewer-pos" aria-live="polite">{position}</span>
          {photo && safeHref(photo.url) && (
            <a className="viewer-btn" href={safeHref(photo.url)!} target="_blank" rel="noopener noreferrer" aria-label="Open original" title="Open original">
              <Icon name="external" size={18} />
            </a>
          )}
          {photo && safeHref(photo.url) && (
            <a className="viewer-btn" href={safeHref(photo.url)!} download aria-label="Download original" title="Download"><Icon name="arrowDown" size={20} /></a>
          )}
          <button className={'viewer-btn' + (info ? ' on' : '')} onClick={toggleInfo} aria-pressed={info} aria-label="Details (I)" title="Details (I)">
            <Icon name="info" size={20} />
          </button>
        </div>
        {photo ? <Media key={photo.id} photo={photo} /> : single.isError ? <p className="viewer-msg">This photo isn't available.</p> : <span className="spinner viewer-spin" />}
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

function Media({ photo }: { photo: Photo }) {
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
  return (
    <div className="viewer-media">
      <div className="viewer-frame" style={{ '--ar': ratio } as CSSProperties}>
        {thumb && <img className="viewer-thumb" src={thumb} alt="" aria-hidden="true" draggable={false} />}
        {full && <img className={'viewer-img' + (loaded ? ' loaded' : '')} src={full} alt={photo.city ? `Photo in ${photo.city}` : 'Photo'} onLoad={() => setLoaded(true)} draggable={false} />}
      </div>
      {!loaded && <span className="spinner viewer-spin small" aria-label="Loading full size" />}
    </div>
  )
}

interface PhotoDetails extends Photo {
  filename: string; library: string; mimetype: string | null; size_kb: number | null; size_total_kb: number | null; megapixels: number | null
  camera_make: string | null; camera_model: string | null; exposure: string | null; fnumber: string | null; isospeed: string | null
  shutterspeed: string | null; aperture: string | null; flash: string | null; focallength: string | null; altitude: number | null
  framerate: number | null; bitrate: number | null; has_raw: boolean; has_orig: boolean; blur: number | null; objects: string[]
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
        {d.blur !== null && d.blur !== undefined && row('sparkle', <span className="muted">Sharpness score {Math.round(d.blur)}</span>, 'blur')}
        {d.objects && d.objects.length > 0 && row('tag', (
          <div className="viewer-badges">
            {d.objects.map((o) => <Link key={o} className="chip" to={`/photos?objects=${encodeURIComponent(o)}`} onClick={onClose}>{o}</Link>)}
          </div>
        ), 'obj')}
      </dl>
    </aside>
  )
}
