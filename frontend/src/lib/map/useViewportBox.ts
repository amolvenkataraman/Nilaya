// The map's visible area as a box for per-area queries: updated after each pan or zoom ends, debounced (a fling
// fires several moveends) and snapped outwards to 0.01° so small moves hit the same cached request.
import { type RefObject, useEffect, useState } from 'react'
import { type Box, WORLD } from './geo'
import type L from './leaflet'
import { snapBox } from './points'

/**
 * `start`: 'world' reports the whole world at once (a first fit can then show every point whatever the viewport's
 * shape), 'view' reports the first view after the debounce.
 */
export function useViewportBox(map: RefObject<L.Map | null>, { debounceMs = 350, start = 'view' as 'view' | 'world' } = {}) {
  const [box, setBox] = useState<Box | null>(start === 'world' ? WORLD : null)
  useEffect(() => {
    const m = map.current
    if (!m) return
    let t: ReturnType<typeof setTimeout> | undefined
    const report = () => {
      clearTimeout(t)
      t = setTimeout(() => {
        const b = m.getBounds()
        setBox(snapBox({ south: b.getSouth(), west: b.getWest(), north: b.getNorth(), east: b.getEast() }))
      }, debounceMs)
    }
    m.on('moveend', report)
    if (start === 'view') report()
    return () => {
      clearTimeout(t)
      m.off('moveend', report)
    }
  }, [map, debounceMs, start])
  return box
}
