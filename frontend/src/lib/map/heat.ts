// Photo heat maps use the same renderer and settings as the classic map page: leaflet.heat 0.2.0 (bundled from
// npm) with { minOpacity: 0.3, radius: 25, blur: 20, max: 1 }, maxZoom 19 and the default gradient {0.4 blue,
// 0.6 cyan, 0.7 lime, 0.8 yellow, 1 red}. The API pre-aggregates photos per coordinate, so each point is
// [lat, lng, count]: leaflet.heat sums weights per grid cell, which equals the classic one-point-per-photo data.
import { type RefObject, useEffect, useRef } from 'react'
import L from './leaflet'
import 'leaflet.heat'
import type { HeatPoint } from './points'

export const HEAT_OPTIONS = { minOpacity: 0.3, radius: 25, blur: 20, max: 1, maxZoom: 19 }

type HeatLayerApi = L.Layer & { setLatLngs(p: [number, number, number][]): unknown }
const toLatLngs = (points: HeatPoint[]) => points.map((p) => [p.lat, p.lng, p.count] as [number, number, number])

/** A heat layer for these points (`setPoints` swaps them without rebuilding the layer). */
export function heatLayer(points: HeatPoint[]) {
  const factory = (L as unknown as { heatLayer: (p: [number, number, number][], o: object) => HeatLayerApi }).heatLayer
  const layer = factory(toLatLngs(points), HEAT_OPTIONS)
  return Object.assign(layer, { setPoints: (pts: HeatPoint[]) => layer.setLatLngs(toLatLngs(pts)) })
}

/** Keeps a heat layer on `map` showing `points`; null removes it. Survives the map being recreated. */
export function useHeatLayer(map: RefObject<L.Map | null>, points: HeatPoint[] | null | undefined) {
  const layer = useRef<ReturnType<typeof heatLayer> | null>(null)
  useEffect(() => {
    const m = map.current
    if (!m) return
    if (layer.current && !m.hasLayer(layer.current)) layer.current = null
    if (points) {
      if (layer.current) layer.current.setPoints(points)
      else layer.current = heatLayer(points).addTo(m)
    } else if (layer.current) {
      layer.current.remove()
      layer.current = null
    }
  }, [map, points])
  useEffect(
    () => () => {
      layer.current?.remove()
      layer.current = null
    },
    [],
  )
}
