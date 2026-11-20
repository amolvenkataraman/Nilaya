// The viewer's details panel ("i"): date, file, video, camera and exposure, place with a small map, hidden
// state, sharpness and detected objects. It reads the same photoDetailsQuery entry as the viewer's actions.
import { useQuery } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { Icon, type IconName } from '../../components/Icon'
import { Button, chipClass } from '../../components/ui'
import { fmtDate, fmtTime } from '../../lib/dates'
import { fmtBytes, placeText } from '../../lib/format'
import { osmUrl } from '../../lib/map/geo'
import type { Photo } from '../../lib/types'
import { type PhotoDetails, photoDetailsQuery } from './queries'
import { fmtDuration } from './util'

const num = (v: string | number | null | undefined) => (v === null || v === undefined || v === '' ? null : Number(v))
function shutter(v: string | null): string | null {
  const s = num(v)
  if (!s || !Number.isFinite(s)) return null
  return s >= 1 ? `${s.toFixed(1).replace(/\.0$/, '')} s` : `1/${Math.round(1 / s)} s`
}

/** A small static OSM tile with a pin (z14), linking to the full map. */
function MiniMap({ lat, lon }: { lat: number; lon: number }) {
  const z = 14
  const x = ((lon + 180) / 360) * 2 ** z
  const r = (lat * Math.PI) / 180
  const y = ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z
  const [tx, ty] = [Math.floor(x), Math.floor(y)]
  return (
    <a
      className="relative mt-2 block aspect-square w-full max-w-64 overflow-hidden rounded-md border border-border bg-surface-2"
      href={osmUrl(lat, lon, 16, 5)}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Open in OpenStreetMap"
    >
      <img
        className="size-full object-cover dark:[filter:invert(0.9)_hue-rotate(180deg)_brightness(0.9)_contrast(0.9)]"
        src={`https://a.tile.openstreetmap.org/${z}/${tx}/${ty}.png`}
        alt=""
        loading="lazy"
        referrerPolicy="strict-origin-when-cross-origin"
      />
      <span
        className="absolute -translate-x-1/2 -translate-y-full text-[#dc2626] drop-shadow-[0_1px_2px_rgba(0,0,0,0.4)] [&_svg]:fill-[color-mix(in_srgb,#dc2626_85%,white)] [&_svg]:stroke-[#7f1d1d]"
        style={{ left: `${(x - tx) * 100}%`, top: `${(y - ty) * 100}%` }}
        aria-hidden="true"
      >
        <Icon name="map-pin" size={22} />
      </span>
    </a>
  )
}

const badges = 'mt-1.5 flex flex-wrap gap-1'

export function InfoPanel({ photo, onClose }: { photo: Photo; onClose: () => void }) {
  const q = useQuery(photoDetailsQuery(photo.id))
  const d: Partial<PhotoDetails> & Photo = { ...photo, ...(q.data ?? {}) }
  const when = d.date_taken ? new Date(d.date_taken) : null
  // A coordinate of exactly 0 is broken GPS (e.g. a phone writing longitude 0.0): shown as no location.
  const ok =
    typeof d.lat === 'number' && typeof d.lon === 'number' && Number.isFinite(d.lat) && Number.isFinite(d.lon) && d.lat !== 0 && d.lon !== 0
  const lat = ok ? d.lat : null
  const lon = ok ? d.lon : null
  const mp = d.megapixels ?? (d.width && d.height ? (d.width * d.height) / 1e6 : null)
  const exposure = [
    num(d.fnumber) ? `f/${num(d.fnumber)}` : null,
    shutter(d.shutterspeed ?? d.exposure ?? null),
    num(d.isospeed) ? `ISO ${num(d.isospeed)}` : null,
    num(d.focallength) ? `${num(d.focallength)} mm` : null,
  ].filter(Boolean)
  const flash =
    d.flash !== undefined && d.flash !== null && d.flash !== '' ? (Number(d.flash) % 2 === 1 ? 'Flash fired' : 'No flash') : null
  const row = (icon: IconName, children: ReactNode, key: string = icon) => (
    <div key={key} className="flex gap-4">
      <dt className="pt-px text-muted">
        <Icon name={icon} />
      </dt>
      <dd className="m-0 grid min-w-0 gap-0.5 text-sm [overflow-wrap:anywhere]">{children}</dd>
    </div>
  )
  return (
    <aside
      className={
        'relative isolate w-88 flex-none animate-[drawer-in_0.18s_var(--ease)] overflow-auto border-l border-border bg-surface text-fg ' +
        'max-md:max-h-[45vh] max-md:w-auto max-md:rounded-t-[12px] max-md:border-t max-md:border-l-0 max-md:pb-[env(safe-area-inset-bottom,0px)]'
      }
      aria-label="Details"
    >
      <div className="flex items-center pt-3.5 pr-3 pb-2 pl-5">
        <h2 className="flex-1 text-md">Details</h2>
        <Button variant="ghost" size="sm" icon onClick={onClose} aria-label="Close details">
          <Icon name="x" />
        </Button>
      </div>
      <dl className="m-0 grid gap-4.5 px-5 pt-1 pb-5">
        {when &&
          row(
            'calendar',
            <>
              <div>{fmtDate(when, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</div>
              <div className="text-muted">{fmtTime(when)}</div>
            </>,
          )}
        {row(
          d.video ? 'video' : 'photo',
          <>
            <div className="truncate" title={d.filename}>
              {d.filename || (d.video ? 'Video' : 'Photo')}
            </div>
            <div className="text-muted tabular-nums">
              {[
                d.width && d.height ? `${d.width} × ${d.height}` : '',
                mp && !d.video ? `${mp.toFixed(1)} MP` : '',
                d.size_kb ? fmtBytes(d.size_kb) : '',
              ]
                .filter(Boolean)
                .join(' · ')}
            </div>
            {d.size_total_kb && d.size_kb && d.size_total_kb > d.size_kb && (
              <div className="text-xs text-muted">{fmtBytes(d.size_total_kb)} with originals</div>
            )}
            <div className={badges}>
              {d.library && <span className={chipClass()}>{d.library}</span>}
              {d.mimetype && <span className={chipClass()}>{d.mimetype.replace(/^\w+\//, '').toUpperCase()}</span>}
              {d.has_raw && <span className={chipClass({ tone: 'accent' })}>RAW</span>}
              {d.has_orig && <span className={chipClass({ tone: 'accent' })}>Original</span>}
            </div>
          </>,
          'file',
        )}
        {d.video && (d.length || d.framerate || d.bitrate)
          ? row(
              'play',
              <div className="tabular-nums">
                {[
                  d.length ? fmtDuration(d.length) : '',
                  d.framerate ? `${Math.round(d.framerate)} fps` : '',
                  d.bitrate ? `${(d.bitrate / 1e6).toFixed(1)} Mbps` : '',
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </div>,
              'vid',
            )
          : null}
        {(d.camera_make || d.camera_model || d.camera) &&
          row(
            'camera',
            <>
              <div>{[d.camera_make, d.camera_model].filter(Boolean).join(' ') || d.camera}</div>
              {exposure.length > 0 && <div className="text-muted tabular-nums">{exposure.join(' · ')}</div>}
              {flash && (
                <div className="text-xs text-muted">
                  {flash}
                  {num(d.aperture) ? ` · aperture ${num(d.aperture)}` : ''}
                </div>
              )}
            </>,
            'cam',
          )}
        {(d.city || d.country || lat !== null) &&
          row(
            'pin',
            <>
              {(d.city || d.country) && <div>{placeText([d.city, d.state, d.country].filter(Boolean).join(', '))}</div>}
              {lat !== null && lon !== null && (
                <>
                  <div className="text-muted tabular-nums">
                    {lat.toFixed(5)}, {lon.toFixed(5)}
                    {d.altitude !== null && d.altitude !== undefined ? ` · ${Math.round(d.altitude)} m` : ''}
                  </div>
                  <MiniMap lat={lat} lon={lon} />
                </>
              )}
            </>,
            'loc',
          )}
        {(lat === null || lon === null) &&
          row(
            'pin',
            <Link className="inline-flex items-center gap-1" to={`/photos/locate?photo=${d.id}`}>
              <Icon name="plus" size={14} />
              Add location
            </Link>,
            'addloc',
          )}
        {d.hidden && row('ban', <span className={chipClass({ tone: 'warning' })}>Hidden: only you can see it</span>, 'hid')}
        {d.blur !== null &&
          d.blur !== undefined &&
          row('sparkle', <span className="text-muted">Sharpness score {Math.round(d.blur)}</span>, 'blur')}
        {d.objects &&
          d.objects.length > 0 &&
          row(
            'tag',
            <div className={badges}>
              {d.objects.map((o) => {
                const name = typeof o === 'string' ? o : o.name
                return (
                  <Link
                    key={name}
                    className={chipClass({ interactive: true })}
                    to={`/photos?objects=${encodeURIComponent(name)}`}
                    onClick={onClose}
                  >
                    {name}
                  </Link>
                )
              })}
            </div>,
            'obj',
          )}
      </dl>
    </aside>
  )
}
