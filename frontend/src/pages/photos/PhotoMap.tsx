// Photos › Map: a heat map of where your photos were taken (GET /photos/points for the visible box, debounced,
// cached per box and filters) with count clusters on top (pixel grid; click one to zoom in), "photos near here"
// when you click the map, and GPX tracks read locally from files. Built on lib/map.
import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { Icon } from '../../components/Icon'
import { toast } from '../../components/toast'
import { Button } from '../../components/ui'
import { get, safeHref } from '../../lib/api'
import { fmtDate } from '../../lib/dates'
import { plural } from '../../lib/format'
import { countMarker } from '../../lib/map/countMarker'
import type { LatLng } from '../../lib/map/geo'
import { gridCluster, shortCount } from '../../lib/map/gridCluster'
import { useHeatLayer } from '../../lib/map/heat'
import { HeatFilterControls, HeatRamp, heatParams, useHeatFilter } from '../../lib/map/HeatFilters'
import L from '../../lib/map/leaflet'
import { type HeatPoint, photoPointsQuery } from '../../lib/map/points'
import { useLeafletMap } from '../../lib/map/useLeafletMap'
import { useViewportBox } from '../../lib/map/useViewportBox'
import { usePref } from '../../lib/storage'
import type { Photo } from '../../lib/types'
import { photosInArea } from './util'

const CLUSTER_PX = 72
const NO_POINTS: HeatPoint[] = []

/** One count marker per screen cell of CLUSTER_PX at the current zoom; neighbours closer than a marker merge. */
function drawClusters(m: L.Map, g: L.LayerGroup, pts: HeatPoint[]) {
  g.clearLayers()
  const zoom = m.getZoom()
  const bounds = m.getBounds().pad(0.1)
  const cells = gridCluster(
    pts.filter((p) => bounds.contains([p.lat, p.lng])),
    {
      latLng: (p) => [p.lat, p.lng],
      weight: (p) => p.count,
      project: (lat, lng) => m.project([lat, lng], zoom),
      cellPx: CLUSTER_PX,
      mergePx: CLUSTER_PX * 0.75,
    },
  )
  for (const c of cells) {
    const size = Math.round(26 + Math.min(18, Math.log10(c.weight + 1) * 6))
    const mk = countMarker([c.lat, c.lng], {
      text: shortCount(c.weight),
      size,
      title: `${c.weight.toLocaleString()} photos`,
      variant: 'heat',
    })
    mk.on('click', () => {
      const b = L.latLngBounds([c.south, c.west], [c.north, c.east])
      m.flyTo(b.getCenter(), Math.min(18, Math.max(zoom + 2, m.getBoundsZoom(b.pad(0.3)))), { duration: 0.5 })
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
      if (Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) line.push([lat, lon])
    }
    if (line.length > 1) segs.push(line)
  }
  for (const seg of doc.querySelectorAll('trkseg')) read(seg.querySelectorAll('trkpt'))
  for (const r of doc.querySelectorAll('rte')) read(r.querySelectorAll('rtept'))
  return segs
}
type Near = { count: number; visits: number; first_visit: string | null; last_visit: string | null; photos: Photo[] }

export function PhotoMapPage() {
  const el = useRef<HTMLElement>(null)
  const pin = useRef<L.CircleMarker | null>(null)
  const clusterLayer = useRef<L.LayerGroup | null>(null)
  const tracks = useRef<L.LayerGroup | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const [trackCount, setTrackCount] = useState(0)
  const [clusters, setClusters] = usePref<boolean>('app.photos.mapClusters', true)
  const [heatFilter, setHeatFilter] = useHeatFilter()
  const navigate = useNavigate()
  const [at, setAt] = useState<LatLng | null>(null)
  const map = useLeafletMap(el, {
    center: [30, 0],
    zoom: 2,
    onClick: (p) => {
      setAt(p)
      pin.current?.remove()
      if (map.current)
        pin.current = L.circleMarker([p.lat, p.lng], { radius: 7, color: '#fff', weight: 2, fillColor: '#dc2626', fillOpacity: 1 }).addTo(
          map.current,
        )
    },
  })
  // First query: the whole world, so the first fit shows every photo whatever the viewport's shape.
  const box = useViewportBox(map, { start: 'world' })
  const points = useQuery(photoPointsQuery(box, heatParams(heatFilter)))
  useHeatLayer(map, points.data ?? NO_POINTS)
  useEffect(() => {
    const m = map.current
    if (!m) return
    clusterLayer.current = L.layerGroup().addTo(m)
    tracks.current = L.layerGroup().addTo(m)
    return () => {
      clusterLayer.current = null
      tracks.current = null
    }
  }, [map])

  // First load: zoom to where the photos are.
  const fitted = useRef(false)
  useEffect(() => {
    const pts = points.data
    if (!fitted.current && pts?.length && map.current) {
      fitted.current = true
      map.current.fitBounds(L.latLngBounds(pts.map((p) => [p.lat, p.lng] as [number, number])), { padding: [40, 40], maxZoom: 12 })
    }
  }, [points.data, map])
  // Count clusters: redrawn when the points, the view or the toggle change.
  useEffect(() => {
    const m = map.current
    const g = clusterLayer.current
    if (!m || !g) return
    const draw = () => (clusters ? drawClusters(m, g, points.data ?? []) : g.clearLayers())
    draw()
    m.on('zoomend moveend', draw)
    return () => void m.off('zoomend moveend', draw)
  }, [points.data, clusters, map])

  const addTracks = async (files: FileList | null) => {
    const m = map.current
    const g = tracks.current
    if (!files || !m || !g) return
    let all: L.LatLngBounds | null = null
    let added = 0
    for (const f of Array.from(files).slice(0, 20)) {
      if (f.size > 50 * 1024 * 1024) continue
      for (const seg of parseGpx(await f.text())) {
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
    queryKey: ['places', 'photos-near', at?.lat.toFixed(4), at?.lng.toFixed(4)],
    queryFn: ({ signal }) => get<Near>('places/photos-near', { latitude: at?.lat, longitude: at?.lng, limit: 24 }, signal),
    enabled: !!at,
    staleTime: 30 * 60_000,
  })
  const total = (points.data ?? []).reduce((t, p) => t + p.count, 0)
  const day = (iso: string | null) => (iso ? fmtDate(new Date(iso), { month: 'short', day: 'numeric', year: 'numeric' }) : '')

  return (
    <div className="relative isolate h-[calc(100dvh-var(--topbar-h))]">
      <section ref={el} className="absolute inset-0 bg-surface-2" aria-label="Map of your photos" />
      <fieldset
        className="absolute top-3 left-3 z-500 m-0 grid max-w-72 min-w-52 gap-1.5 rounded-md border-0 bg-[color-mix(in_srgb,var(--app-surface)_94%,transparent)] px-3 py-2 shadow-pop max-md:right-3 max-md:max-w-none"
        aria-label="Map options"
      >
        <strong className="text-xs">Where your photos were taken</strong>
        {points.isFetching && <span className="spinner absolute top-2 right-2" role="status" aria-label="Loading" />}
        <HeatFilterControls f={heatFilter} set={setHeatFilter} />
        <label className="flex items-center gap-1.5 text-xs">
          <input type="checkbox" checked={clusters} onChange={(e) => setClusters(e.target.checked)} />
          Show counts (click one to zoom in)
        </label>
        <div className="flex flex-wrap items-center gap-1.5">
          <Button
            size="sm"
            onClick={() => fileInput.current?.click()}
            title="Draw GPX tracks from files on this device (nothing is uploaded)"
          >
            <Icon name="run" size={14} />
            Add GPX track
          </Button>
          {trackCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                tracks.current?.clearLayers()
                setTrackCount(0)
              }}
            >
              Clear tracks
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={showArea} title="The timeline, filtered to the area in view">
            <Icon name="photo" size={14} />
            Photos in this area
          </Button>
          <input
            ref={fileInput}
            type="file"
            accept=".gpx,application/gpx+xml"
            multiple
            hidden
            onChange={(e) => {
              addTracks(e.target.files)
              e.target.value = ''
            }}
          />
        </div>
        <span className="text-xs text-muted tabular-nums">{plural(total, 'photo')} in view · click the map for photos near a spot</span>
        <span className="flex items-center gap-1.5 text-xs text-muted">
          Fewer <HeatRamp /> more
        </span>
      </fieldset>
      {at && (
        <div className="absolute right-3 bottom-3 z-500 grid w-[min(22rem,calc(100%-1.5rem))] gap-1.5 rounded-md bg-surface px-3 py-2.5 shadow-pop">
          <div className="flex items-center gap-2">
            <strong className="flex-1 text-sm">Photos near here</strong>
            <Button
              variant="ghost"
              size="sm"
              icon
              onClick={() => {
                setAt(null)
                pin.current?.remove()
              }}
              aria-label="Close"
            >
              <Icon name="x" size={14} />
            </Button>
          </div>
          {near.isPending ? (
            <p className="text-xs text-muted">Looking…</p>
          ) : !near.data?.count ? (
            <p className="text-xs text-muted">No photos within a short walk of this spot.</p>
          ) : (
            <>
              <p className="text-xs">
                <strong>{near.data.count.toLocaleString()}</strong> photos · {near.data.visits} visits
                {near.data.last_visit && ` · last ${day(near.data.last_visit)}`}
                {near.data.first_visit && ` · first ${day(near.data.first_visit)}`}
              </p>
              <div className="grid grid-cols-4 gap-[3px]">
                {near.data.photos.slice(0, 12).map((p) => {
                  const src = safeHref(p.thumb_url)
                  return (
                    <Link key={p.id} to={`/photos?photo=${p.id}`} className="aspect-square overflow-hidden rounded-xs bg-surface-2">
                      {src && <img src={src} alt="" loading="lazy" className="size-full object-cover" />}
                    </Link>
                  )
                })}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
