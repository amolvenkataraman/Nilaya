// The shared frame of Photos' map tools (Geoguessr and Add missing locations): a header, then the photo and a
// map side by side (stacked on phones) with a bar under the map. Also the photo itself (PhotoShot: the
// thumbnail until the original has decoded), the pin style and the shortcut guard both tools use.
import { useState } from 'react'
import { layerOpen } from '../../components/layers'
import { safeHref } from '../../lib/api'
import { cn } from '../../lib/cn'
import type L from '../../lib/map/leaflet'
import type { Photo } from '../../lib/types'

export const tool = {
  page: 'flex h-[calc(100dvh-var(--topbar-h))] min-h-0 flex-col max-md:h-auto max-md:min-h-[calc(100dvh-var(--topbar-h))]',
  head: 'flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border px-4 py-3 max-md:px-3 max-md:py-2.5',
  panels: 'grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] max-md:grid-cols-1 max-md:grid-rows-[38vh_auto]',
  photo: 'relative grid min-h-0 place-items-center overflow-hidden bg-black',
  msg: 'max-w-md p-8 text-center text-[rgba(232,234,237,0.85)]',
  mapWrap: 'relative isolate flex min-h-0 flex-col',
  /** map-crosshair (lib/map/map.css): every click places something. */
  map: 'map-crosshair min-h-48 flex-1 bg-surface-2 max-md:h-[50vh] max-md:min-h-[50vh] max-md:flex-none',
  bar: 'flex items-center gap-2 border-t border-border bg-surface px-3 py-2',
  /** A key hint inside a button ("Guess Enter"). */
  kbd: 'ml-1.5 rounded-xs border border-current px-1 text-2xs opacity-70',
  /** A spinner that shows on the black photo panel. */
  spin: 'absolute right-4 bottom-4 inline-block size-3.5 animate-[spin_0.7s_linear_infinite] rounded-full border-2 border-white/20 border-t-white',
}

export const pinStyle = (colour: string): L.CircleMarkerOptions => ({
  radius: 8,
  color: '#fff',
  weight: 3,
  fillColor: colour,
  fillOpacity: 1,
})
export const takenAt = (p: Photo) => (p.date_taken ? new Date(p.date_taken) : null)

/** Tool shortcuts (Enter, S, N) stay quiet with a modifier, under a dialog or menu, or on a focused control. */
export const skipKey = (e: KeyboardEvent) =>
  e.ctrlKey || e.metaKey || e.altKey || layerOpen(['dialog', 'menu']) || !!(e.target as HTMLElement)?.closest?.('button, a, select')

/** The photo, filling its panel; the thumbnail shows until the original has decoded. */
export function PhotoShot({ photo }: { photo: Photo }) {
  const full = safeHref(photo.url)
  const thumb = safeHref(photo.thumb_url)
  const [ready, setReady] = useState(false)
  const media = 'size-full min-h-0 object-contain [grid-area:1/1]'
  if (photo.video)
    return full ? <video className={media} src={full} poster={thumb ?? undefined} controls playsInline preload="metadata" /> : null
  return (
    <>
      {thumb && !ready && <img className={cn(media, 'scale-[1.03] blur-[8px]')} src={thumb} alt="" aria-hidden="true" />}
      {full && (
        <img
          className={cn(media, !ready && 'invisible')}
          src={full}
          alt="Where was this taken?"
          decoding="async"
          draggable={false}
          onLoad={(e) =>
            void e.currentTarget
              .decode()
              .catch(() => undefined)
              .then(() => setReady(true))
          }
        />
      )}
      {!ready && <span className={tool.spin} role="status" aria-label="Loading photo" />}
    </>
  )
}
