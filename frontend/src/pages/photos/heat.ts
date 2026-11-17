// Photo heat maps use the same renderer and settings as the classic map page: leaflet.heat 0.2.0
// (bundled from npm) with { minOpacity: 0.3, radius: 25, blur: 20, max: 1 }, maxZoom 19 and the
// default gradient {0.4 blue, 0.6 cyan, 0.7 lime, 0.8 yellow, 1 red}. The API pre-aggregates
// photos per coordinate, so each point is [lat, lng, count]: leaflet.heat sums weights per grid
// cell, which equals the classic one-point-per-photo data.
import L from './leaflet-global'
import 'leaflet.heat'

import type { HeatPoint } from './points'

export const HEAT_OPTIONS = { minOpacity: 0.3, radius: 25, blur: 20, max: 1, maxZoom: 19 }

type HeatLayerApi = L.Layer & { setLatLngs(p: [number, number, number][]): unknown }
const toLatLngs = (points: HeatPoint[]) => points.map((p) => [p.lat, p.lng, p.count] as [number, number, number])

/** Thin wrapper keeping the app's API (new HeatLayer(points).addTo(map), setPoints). */
export class HeatLayer {
  private layer: HeatLayerApi
  /** The second argument is ignored: radius is fixed to the classic 25 px. */
  constructor(points: HeatPoint[], _radius?: number) {
    void _radius
    const factory = (L as unknown as { heatLayer: (p: [number, number, number][], o: object) => HeatLayerApi }).heatLayer
    this.layer = factory(toLatLngs(points), HEAT_OPTIONS)
  }
  addTo(map: L.Map) {
    this.layer.addTo(map)
    return this
  }
  remove() {
    this.layer.remove()
    return this
  }
  setPoints(points: HeatPoint[]) {
    this.layer.setLatLngs(toLatLngs(points))
    return this
  }
  /** For map.hasLayer checks. */
  get leaflet(): L.Layer {
    return this.layer
  }
}
