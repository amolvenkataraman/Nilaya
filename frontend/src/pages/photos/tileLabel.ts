// The small label on thumbnails (time, city, camera, …; chosen per device) and the full tooltip of a tile.
import { fmtStamp, fmtTime } from '../../lib/dates'
import { fmtBytes, placeText } from '../../lib/format'
import { readPref, writePref } from '../../lib/storage'
import type { Photo } from '../../lib/types'
import { createStore } from './store'

export type TileLabel = 'none' | 'time' | 'city' | 'camera' | 'mp' | 'size' | 'blur'
export const TILE_LABELS: [TileLabel, string][] = [
  ['none', 'None'],
  ['time', 'Time taken'],
  ['city', 'City'],
  ['camera', 'Camera'],
  ['mp', 'Megapixels'],
  ['size', 'Size'],
  ['blur', 'Blur score'],
]
const KEY = 'app.photos.label'

function stored(): TileLabel {
  const v = readPref<string>(KEY, 'time')
  return TILE_LABELS.some(([k]) => k === v) ? (v as TileLabel) : 'time'
}

/** A store, not state: every tile reads it, and changing it shouldn't re-render the page. */
export const tileLabel = createStore<TileLabel>(stored())
export function setTileLabel(v: TileLabel) {
  tileLabel.set(v)
  writePref(KEY, v)
}

export function labelText(p: Photo, l: TileLabel): string {
  switch (l) {
    case 'time':
      return p.date_taken ? fmtTime(new Date(p.date_taken)) : ''
    case 'city':
      return placeText(p.city ?? '')
    case 'camera':
      return p.camera ?? ''
    case 'mp':
      return p.megapixels ? `${p.megapixels.toFixed(1)} MP` : ''
    case 'size':
      return p.size_kb ? fmtBytes(p.size_kb) : ''
    case 'blur':
      return p.blur != null ? `Blur ${Math.round(p.blur)}` : ''
    default:
      return ''
  }
}

/** Everything about a tile, for its tooltip. */
export function tileTitle(p: Photo): string {
  const lines: string[] = []
  if (p.date_taken) lines.push(fmtStamp(p.date_taken))
  if (p.city || p.country) lines.push(placeText([p.city, p.country].filter(Boolean).join(', ')))
  if (p.camera) lines.push(p.camera)
  const tech = [
    p.width && p.height ? `${p.width}×${p.height}` : '',
    p.megapixels ? `${p.megapixels.toFixed(1)} MP` : '',
    p.size_kb ? fmtBytes(p.size_kb) : '',
    p.size_total_kb && p.size_kb && p.size_total_kb > p.size_kb ? `${fmtBytes(p.size_total_kb)} with originals` : '',
  ]
    .filter(Boolean)
    .join(' · ')
  if (tech) lines.push(tech)
  if (p.blur != null) lines.push(`Blur score ${Math.round(p.blur)}`)
  if (p.has_raw || p.has_orig) lines.push(`${[p.has_raw && 'RAW', p.has_orig && 'Original'].filter(Boolean).join(' + ')} kept`)
  return lines.join('\n')
}
