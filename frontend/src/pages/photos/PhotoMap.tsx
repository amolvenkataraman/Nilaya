// Photos › Map: a heat map of where your photos were taken (GET /photos/points for the visible box,
// debounced, cached per box/year) with count clusters on top (pixel grid, like Places; click to zoom
// in), "photos near here" when you click the map, and GPX tracks read locally from files.
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Icon } from '../../components/Icon'
import { toast } from '../../components/toast'
import { get, safeHref } from '../../lib/api'
import { fmtDate } from '../../lib/dates'
import type { Photo } from '../../lib/types'
import { HeatLayer, realPoints, type HeatPoint } from './heat'
import { HeatFilterControls, heatParams, useHeatFilter } from './HeatFilters'
import { photosInArea } from './util'

type Box = { south: number; west: number; north: number; east: number }
const CLUSTER_PX = 72
const CLUSTER_KEY = 'app.photos.mapClusters'
const short = (n: number) => (n >= 10_000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k` : String(n))

/** Text-only marker content (Leaflet treats strings as HTML). */
function clusterNode(n: number): HTMLElement {
  const s = document.createElement('span')
  s.textContent = short(n)
  return s
}

/** Group heat points into screen cells of CLUSTER_PX at the current zoom; one count marker per cell. */
function drawClusters(m: L.Map, g: L.LayerGroup, pts: HeatPoint[]) {
  g.clearLayers()
  const zoom = m.getZoom()
  const bounds = m.getBounds().pad(0.1)
  const cells = new Map<string, { n: number; lat: number; lng: number; s: number; w: number; nn: number; e: number }>()
  for (const p of pts) {
    if (!bounds.contains([p.lat, p.lng])) continue
    const pt = m.project([p.lat, p.lng], zoom)
    const key = `${Math.floor(pt.x / CLUSTER_PX)}:${Math.floor(pt.y / CLUSTER_PX)}`
    const c = cells.get(key)
    if (!c) cells.set(key, { n: p.count, lat: p.lat * p.count, lng: p.lng * p.count, s: p.lat, nn: p.lat, w: p.lng, e: p.lng })
    else {
      c.n += p.count
      c.lat += p.lat * p.count
      c.lng += p.lng * p.count
      c.s = Math.min(c.s, p.lat); c.nn = Math.max(c.nn, p.lat); c.w = Math.min(c.w, p.lng); c.e = Math.max(c.e, p.lng)
    }
  }
  // Grid cells can put two markers side by side across a cell edge: merge neighbours closer than a marker.
  type Cell = { n: number; lat: number; lng: number; s: number; w: number; nn: number; e: number; x: number; y: number }
  const kept: Cell[] = []
  for (const c of [...cells.values()].sort((a, b) => b.n - a.n)) {
    const pt = m.project([c.lat / c.n, c.lng / c.n], zoom)
    const near = kept.find((k) => Math.hypot(k.x - pt.x, k.y - pt.y) < CLUSTER_PX * 0.75)
    if (!near) { kept.push({ ...c, x: pt.x, y: pt.y }); continue }
    near.n += c.n; near.lat += c.lat; near.lng += c.lng
    near.s = Math.min(near.s, c.s); near.nn = Math.max(near.nn, c.nn); near.w = Math.min(near.w, c.w); near.e = Math.max(near.e, c.e)
  }
  for (const c of kept) {
    const size = Math.round(26 + Math.min(18, Math.log10(c.n + 1) * 6))
    const icon = L.divIcon({ className: 'ph-cluster', html: '', iconSize: [size, size] })
    const mk = L.marker([c.lat / c.n, c.lng / c.n], { icon, keyboard: true, title: `${c.n.toLocaleString()} photos`, riseOnHover: true })
    mk.on('add', () => mk.getElement()?.replaceChildren(clusterNode(c.n)))
    mk.on('click', () => {
      const b = L.latLngBounds([c.s, c.w], [c.nn, c.e])
      const target = Math.min(18, Math.max(zoom + 2, m.getBoundsZoom(b.pad(0.3))))
      m.flyTo(b.getCenter(), target, { duration: 0.5 })
    })
    mk.addTo(g)
  }
}

/** Track points from a GPX file (trkpt, rtept), parsed locally; nothing is uploaded. */
function parseGpx(text: string): [number, number][][] {
  const doc = new DOMParser().parseFromString(text, 'application/xml')
  if (doc.querySelector('parsererror')) return []
  const segs: [number, number][][] = []
  const read = (nodes: Iterable<Element>) => {
    const line: [number, number][] = []
    for (const n of nodes) {
      const lat = Number(n.getAttribute('lat'))
      const lon = Number(n.getAttribute('lon'))
      if (isFinite(lat) && isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) line.push([lat, lon])
    }
    if (line.length > 1) segs.push(line)
  }
  doc.querySelectorAll('trkseg').forEach((seg) => read(seg.querySelectorAll('trkpt')))
  doc.querySelectorAll('rte').forEach((r) => read(r.querySelectorAll('rtept')))
  return segs
}
type Near = { count: number; visits: number; first_visit: string | null; last_visit: string | null; photos: Photo[] }

export function PhotoMapPage() {
  const el = useRef<HTMLDivElement>(null)
  const map = useRef<L.Map | null>(null)
  const layer = useRef<HeatLayer | null>(null)
  const pin = useRef<L.CircleMarker | null>(null)
  const clusterLayer = useRef<L.LayerGroup | null>(null)
  const tracks = useRef<L.LayerGroup | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const [trackCount, setTrackCount] = useState(0)
  const [clusters, setClustersState] = useState(() => {
    try { return localStorage.getItem(CLUSTER_KEY) !== '0' } catch { return true }
  })
  const setClusters = (v: boolean) => {
    setClustersState(v)
    try { localStorage.setItem(CLUSTER_KEY, v ? '1' : '0') } catch { /* ignore */ }
  }
  const [box, setBox] = useState<Box | null>(null)
  const [heatFilter, setHeatFilter] = useHeatFilter()
  const navigate = useNavigate()
  const [at, setAt] = useState<{ lat: number; lng: number } | null>(null)

  useEffect(() => {
    if (!el.current) return
    const m = L.map(el.current, { zoomControl: false, worldCopyJump: true }).setView([30, 0], 2)
    L.control.zoom({ position: 'bottomright' }).addTo(m)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' }).addTo(m)
    layer.current = new HeatLayer([], 20).addTo(m) as HeatLayer
    clusterLayer.current = L.layerGroup().addTo(m)
    tracks.current = L.layerGroup().addTo(m)
    let t: ReturnType<typeof setTimeout> | null = null
    const report = () => {
      if (t) clearTimeout(t)
      t = setTimeout(() => {
        const b = m.getBounds()
        const f = (v: number, up: boolean) => (up ? Math.ceil(v * 100) : Math.floor(v * 100)) / 100
        setBox({ south: f(Math.max(-90, b.getSouth()), false), west: f(Math.max(-180, b.getWest()), false), north: f(Math.min(90, b.getNorth()), true), east: f(Math.min(180, b.getEast()), true) })
      }, 350)
    }
    m.on('moveend', report)
    m.on('click', (e: L.LeafletMouseEvent) => {
      const { lat, lng } = e.latlng.wrap()
      setAt({ lat, lng })
      pin.current?.remove()
      pin.current = L.circleMarker([lat, lng], { radius: 7, color: '#fff', weight: 2, fillColor: '#dc2626', fillOpacity: 1 }).addTo(m)
    })
    map.current = m
    // First query: the whole world, so the first fit shows every photo whatever the viewport's shape.
    const first = setTimeout(() => setBox({ south: -90, west: -180, north: 90, east: 180 }), 0)
    const ro = new ResizeObserver(() => m.invalidateSize())
    ro.observe(el.current)
    return () => {
      clearTimeout(first)
      if (t) clearTimeout(t)
      ro.disconnect()
      m.remove()
      map.current = null
      layer.current = null
      clusterLayer.current = null
      tracks.current = null
    }
  }, [])

  const points = useQuery({
    queryKey: ['photos', 'points', box, heatParams(heatFilter)],
    queryFn: ({ signal }) => get<HeatPoint[]>('photos/points', { ...box!, ...heatParams(heatFilter) }, signal),
    select: realPoints,
    enabled: !!box,
    staleTime: 30 * 60_000,
    placeholderData: keepPreviousData,
  })
  const fitted = useRef(false)
  useEffect(() => {
    const pts = points.data
    if (!pts) return
    layer.current?.setPoints(pts)
    // First load: zoom to where the photos are.
    if (!fitted.current && pts.length && map.current) {
      fitted.current = true
      map.current.fitBounds(L.latLngBounds(pts.map((p) => [p.lat, p.lng] as [number, number])), { padding: [40, 40], maxZoom: 12 })
    }
  }, [points.data])
  // Count clusters: redrawn when the points, the view or the toggle change.
  useEffect(() => {
    const m = map.current
    const g = clusterLayer.current
    if (!m || !g) return
    const draw = () => (clusters ? drawClusters(m, g, points.data ?? []) : g.clearLayers())
    draw()
    m.on('zoomend moveend', draw)
    return () => void m.off('zoomend moveend', draw)
  }, [points.data, clusters])

  const addTracks = async (files: FileList | null) => {
    const m = map.current
    const g = tracks.current
    if (!files || !m || !g) return
    let all: L.LatLngBounds | null = null
    let added = 0
    for (const f of Array.from(files).slice(0, 20)) {
      if (f.size > 50 * 1024 * 1024) continue
      const segs = parseGpx(await f.text())
      for (const seg of segs) {
        const line = L.polyline(seg, { color: /WALK/i.test(f.name) ? '#16a34a' : '#2563eb', weight: 3, opacity: 0.85 }).addTo(g)
        all = all ? all.extend(line.getBounds()) : line.getBounds()
        added++
      }
    }
    if (all) m.fitBounds(all, { padding: [40, 40] })
    setTrackCount(g.getLayers().length)
    if (!added) toast.error('No track points found in that file.')
  }
  const showArea = () => {
    const b = map.current?.getBounds()
    if (b) navigate(photosInArea(b.getNorth(), b.getSouth(), b.getEast(), b.getWest()))
  }

  const near = useQuery({
    queryKey: ['places', 'photos-near', at && at.lat.toFixed(4), at && at.lng.toFixed(4)],
    queryFn: () => get<Near>('places/photos-near', { latitude: at!.lat, longitude: at!.lng, limit: 24 }),
    enabled: !!at,
    staleTime: 30 * 60_000,
  })
  const total = (points.data ?? []).reduce((t, p) => t + p.count, 0)
  const day = (iso: string | null) => (iso ? fmtDate(new Date(iso), { month: 'short', day: 'numeric', year: 'numeric' }) : '')

  return (
    <div className="ph-map-page">
      <div ref={el} className="ph-map" role="region" aria-label="Map of your photos" />
      <div className="pl-heat-panel ph-map-panel" role="group" aria-label="Map options">
        <strong className="xsmall">Where your photos were taken</strong>
        {points.isFetching && <span className="spinner" aria-label="Loading" />}
        <HeatFilterControls f={heatFilter} set={setHeatFilter} />
        <label className="row xsmall" style={{ gap: '0.375rem' }}><input type="checkbox" checked={clusters} onChange={(e) => setClusters(e.target.checked)} />Show counts (click one to zoom in)</label>
        <div className="row" style={{ gap: '0.375rem', flexWrap: 'wrap' }}>
          <button className="btn sm" onClick={() => fileInput.current?.click()} title="Draw GPX tracks from files on this device (nothing is uploaded)"><Icon name="run" size={14} />Add GPX track</button>
          {trackCount > 0 && <button className="btn ghost sm" onClick={() => (tracks.current?.clearLayers(), setTrackCount(0))}>Clear tracks</button>}
          <button className="btn ghost sm" onClick={showArea} title="The timeline, filtered to the area in view"><Icon name="photo" size={14} />Photos in this area</button>
          <input ref={fileInput} type="file" accept=".gpx,application/gpx+xml" multiple hidden onChange={(e) => (addTracks(e.target.files), (e.target.value = ''))} />
        </div>
        <span className="muted xsmall tabular">{total.toLocaleString()} {total === 1 ? 'photo' : 'photos'} in view · click the map for photos near a spot</span>
        <span className="row xsmall muted" style={{ gap: '0.375rem' }}>Fewer <span className="pm-ramp" aria-hidden="true" /> more</span>
      </div>
      {at && (
        <div className="ph-near">
          <div className="row">
            <strong className="small grow">Photos near here</strong>
            <button className="btn ghost icon sm" onClick={() => (setAt(null), pin.current?.remove())} aria-label="Close"><Icon name="x" size={14} /></button>
          </div>
          {near.isPending ? <p className="muted xsmall">Looking…</p> : !near.data?.count ? <p className="muted xsmall">No photos within a short walk of this spot.</p> : (
            <>
              <p className="xsmall"><strong>{near.data.count.toLocaleString()}</strong> photos · {near.data.visits} visits{near.data.last_visit && ` · last ${day(near.data.last_visit)}`}{near.data.first_visit && ` · first ${day(near.data.first_visit)}`}</p>
              <div className="pl-strip">
                {near.data.photos.slice(0, 12).map((p) => {
                  const src = safeHref(p.thumb_url)
                  return <Link key={p.id} to={`/photos?photo=${p.id}`} className="pl-thumb">{src && <img src={src} alt="" loading="lazy" />}</Link>
                })}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
