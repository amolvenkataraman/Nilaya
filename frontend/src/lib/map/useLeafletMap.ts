// lib/map: the app's maps (Photos › Map, Places, Geoguessr, location entry, and the Location-history app).
//
//   leaflet.ts         Leaflet + its CSS + map.css, and the global L that leaflet.heat needs. Import L from here.
//   useLeafletMap.ts   (this file) one map on an element: OSM tiles, zoom control, resize handling, clicks.
//   useViewportBox.ts  the visible area as a debounced, snapped box (for per-area queries).
//   heat.ts            the photo heat layer (classic settings) and useHeatLayer.
//   points.ts          photoPointsQuery: photo locations per box and filters (no Leaflet).
//   HeatFilters.tsx    the heat map's filters (year, library, altitude, planes) and HeatRamp (its legend).
//   gridCluster.ts     pixel-grid clustering for count markers (pure); countMarker() draws one.
//   useGeocode.ts      place search through the server's geocoder (Nominatim), with the offline-mode switch.
//   geo.ts             distances, coordinate text, links out, boxes (no Leaflet).
//
// Leaflet weighs ~150 kB with the heat plugin, so only pages that draw a map import the Leaflet modules; geo.ts
// and points.ts are free to import anywhere.
import { useEffect, useRef, type RefObject } from 'react'
import type { LatLng } from './geo'
import L from './leaflet'

/** OpenStreetMap's standard tiles, as the classic pages used them. */
export const OSM_TILES = {
  url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
  options: {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  } satisfies L.TileLayerOptions,
}

export interface LeafletMapOptions {
  center: [number, number]
  zoom: number
  /** Draw vector layers on one canvas (many circle markers). */
  preferCanvas?: boolean
  /** A click on the map, with the longitude wrapped into ±180. The latest function is always called. */
  onClick?: (at: LatLng, e: L.LeafletMouseEvent) => void
}

/**
 * Creates a Leaflet map on `el` once (zoom control bottom right, OSM tiles, worldCopyJump), keeps its size in
 * step with the element (ResizeObserver), and removes it on unmount. Returns a ref that holds the map once the
 * element has mounted; effects that add layers read `map.current` and list `map` in their deps.
 */
export function useLeafletMap(el: RefObject<HTMLElement | null>, opts: LeafletMapOptions): RefObject<L.Map | null> {
  const map = useRef<L.Map | null>(null)
  const latest = useRef(opts)
  latest.current = opts
  useEffect(() => {
    const node = el.current
    if (!node) return
    const { center, zoom, preferCanvas } = latest.current
    const m = L.map(node, { zoomControl: false, worldCopyJump: true, preferCanvas }).setView(center, zoom)
    L.control.zoom({ position: 'bottomright' }).addTo(m)
    L.tileLayer(OSM_TILES.url, OSM_TILES.options).addTo(m)
    m.on('click', (e: L.LeafletMouseEvent) => {
      const w = e.latlng.wrap()
      latest.current.onClick?.({ lat: w.lat, lng: w.lng }, e)
    })
    map.current = m
    const ro = new ResizeObserver(() => m.invalidateSize())
    ro.observe(node)
    return () => {
      ro.disconnect()
      m.remove()
      map.current = null
    }
  }, [el])
  return map
}
