// Pixel-grid clustering for count markers: items fall into square screen cells at the current zoom; each cell
// becomes one cluster at its weighted centre, with the bounds of what it holds (for zoom-to-fit). Optionally,
// clusters closer than `mergePx` are merged, so a cell edge never puts two markers side by side. Pure (the
// caller passes the projection), so it is tested without Leaflet.

export interface Cluster<T> {
  items: T[]
  /** Sum of the weights (the count shown). */
  weight: number
  /** Weighted centre. */
  lat: number
  lng: number
  south: number
  west: number
  north: number
  east: number
}

interface Acc<T> {
  items: T[]
  weight: number
  sLat: number
  sLng: number
  south: number
  west: number
  north: number
  east: number
}

export function gridCluster<T>(
  items: Iterable<T>,
  {
    latLng,
    project,
    cellPx,
    weight = () => 1,
    mergePx = 0,
  }: {
    latLng: (t: T) => readonly [number, number]
    /** Screen position of a coordinate at the current zoom (Leaflet: map.project([lat, lng], zoom)). */
    project: (lat: number, lng: number) => { x: number; y: number }
    /** Cell size; 0 puts every item in its own cluster. */
    cellPx: number
    weight?: (t: T) => number
    mergePx?: number
  },
): Cluster<T>[] {
  const cells = new Map<string, Acc<T>>()
  let n = 0
  for (const t of items) {
    const [lat, lng] = latLng(t)
    const w = weight(t)
    let key: string
    if (cellPx > 0) {
      const pt = project(lat, lng)
      key = `${Math.floor(pt.x / cellPx)}:${Math.floor(pt.y / cellPx)}`
    } else key = String(n++)
    const c = cells.get(key)
    if (!c) cells.set(key, { items: [t], weight: w, sLat: lat * w, sLng: lng * w, south: lat, north: lat, west: lng, east: lng })
    else {
      c.items.push(t)
      c.weight += w
      c.sLat += lat * w
      c.sLng += lng * w
      c.south = Math.min(c.south, lat)
      c.north = Math.max(c.north, lat)
      c.west = Math.min(c.west, lng)
      c.east = Math.max(c.east, lng)
    }
  }
  let accs = [...cells.values()]
  if (mergePx > 0) {
    const kept: (Acc<T> & { x: number; y: number })[] = []
    for (const c of accs.sort((a, b) => b.weight - a.weight)) {
      const pt = project(c.sLat / c.weight, c.sLng / c.weight)
      const near = kept.find((k) => Math.hypot(k.x - pt.x, k.y - pt.y) < mergePx)
      if (!near) {
        kept.push({ ...c, x: pt.x, y: pt.y })
        continue
      }
      for (const t of c.items) near.items.push(t)
      near.weight += c.weight
      near.sLat += c.sLat
      near.sLng += c.sLng
      near.south = Math.min(near.south, c.south)
      near.north = Math.max(near.north, c.north)
      near.west = Math.min(near.west, c.west)
      near.east = Math.max(near.east, c.east)
    }
    accs = kept
  }
  return accs.map(({ items, weight, sLat, sLng, south, west, north, east }) => ({
    items,
    weight,
    lat: weight ? sLat / weight : (south + north) / 2,
    lng: weight ? sLng / weight : (west + east) / 2,
    south,
    west,
    north,
    east,
  }))
}

/** "950", "1.2k", "12k". */
export const shortCount = (n: number) =>
  n >= 10_000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k` : String(n)
