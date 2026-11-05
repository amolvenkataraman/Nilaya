// Leaflet map of places. Markers are circle markers (no image assets); popups are built from DOM
// text nodes, never HTML strings, so place names and notes are always plain text.
import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { Place, Suggestion } from './api'
import { HeatLayer, type HeatPoint } from '../photos/heat'

interface Props {
  places: Place[]
  selected: string | null
  categoryLabel: (key: string) => string
  canEdit: (p: Place) => boolean
  onSelect: (id: string | null) => void
  onEdit: (p: Place) => void
  onAddAt: (lat: number, lon: number, name?: string, address?: string) => void
  suggestions?: Suggestion[]
  onSuggestion?: (s: Suggestion) => void
  /** Photo heat map points (null = layer off). */
  heat?: HeatPoint[] | null
  /** Visible box after each move/zoom (the page debounces and fetches heat points for it). */
  onBounds?: (b: { south: number; west: number; north: number; east: number }) => void
  /** "Add place" mode: the next map click adds a place there (no popup). */
  addMode?: boolean
  /** Fly here (a search result or a suggestion); `label` set = offer "Add a place here" with that name. */
  focus?: MapFocus | null
  /** Your location (a dot on the map). */
  userPos?: { lat: number; lon: number } | null
  /** Fit these points once per new key (e.g. after an import). */
  fit?: { key: number; points: [number, number][] } | null
}

export interface MapFocus { key: number; lat: number; lon: number; zoom?: number; bbox?: [number, number, number, number]; label?: string; address?: string }

/** Marker colour by status (legend below the map). */
function statusColour(status?: string): string {
  const css = getComputedStyle(document.documentElement)
  const v = (n: string, d: string) => css.getPropertyValue(n).trim() || d
  return status === 'visited' ? v('--app-success', '#2f855a') : status === 'want_to_go' ? v('--app-warning', '#b7791f') : v('--app-accent', '#0f6d77')
}
const CLUSTER_PX = 44

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag)
  e.className = cls
  if (text !== undefined) e.textContent = text
  return e
}


export function PlaceMap({ places, selected, categoryLabel, canEdit, onSelect, onEdit, onAddAt, suggestions, onSuggestion, heat, onBounds, addMode, focus, userPos, fit }: Props) {
  const box = useRef<HTMLDivElement>(null)
  const map = useRef<L.Map | null>(null)
  const layer = useRef<L.LayerGroup | null>(null)
  const markers = useRef(new Map<string, L.CircleMarker>())
  const fitted = useRef(false)
  // Latest callbacks for Leaflet handlers created once.
  const cb = useRef({ onSelect, onEdit, onAddAt, categoryLabel, canEdit, onSuggestion, onBounds, addMode })
  cb.current = { onSelect, onEdit, onAddAt, categoryLabel, canEdit, onSuggestion, onBounds, addMode }
  const me = useRef<L.CircleMarker | null>(null)
  const heatLayer = useRef<HeatLayer | null>(null)
  const ghosts = useRef<L.LayerGroup | null>(null)
  const [zoomTick, setZoomTick] = useState(0)

  useEffect(() => {
    if (!box.current) return
    // Canvas renderer: thousands of circle markers stay smooth (no DOM node per marker).
    const m = L.map(box.current, { zoomControl: false, worldCopyJump: true, preferCanvas: true }).setView([20, 0], 2)
    L.control.zoom({ position: 'bottomright' }).addTo(m)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(m)
    layer.current = L.layerGroup().addTo(m)
    ghosts.current = L.layerGroup().addTo(m)
    m.on('moveend', () => setZoomTick((t) => t + 1)) // zoom or pan: re-cluster what's in view
    const report = () => {
      const b = m.getBounds()
      cb.current.onBounds?.({ south: b.getSouth(), west: b.getWest(), north: b.getNorth(), east: b.getEast() })
    }
    m.on('moveend', report)
    const firstReport = setTimeout(report, 0)
    m.on('click', (e: L.LeafletMouseEvent) => {
      const { lat, lng } = e.latlng.wrap()
      if (cb.current.addMode) return cb.current.onAddAt(lat, lng)
      addPopup(m, e.latlng, lat, lng)
      cb.current.onSelect(null)
    })
    map.current = m
    ;(box.current as HTMLDivElement & { _leafletMap?: L.Map })._leafletMap = m // handle for tests (no global)
    const ro = new ResizeObserver(() => m.invalidateSize())
    ro.observe(box.current)
    return () => {
      clearTimeout(firstReport)
      ro.disconnect()
      m.remove()
      heatLayer.current = null
      map.current = null
      markers.current.clear()
    }
  }, [])

  // Redraw markers when the places or zoom change. Nearby markers cluster (pixel grid) until zoomed in.
  useEffect(() => {
    const m = map.current
    const g = layer.current
    if (!m || !g) return
    g.clearLayers()
    markers.current.clear()
    const zoom = m.getZoom()
    const cells = new Map<string, Place[]>()
    // Big sets: only what's in (or near) the view gets markers; panning re-runs this.
    const view = places.length > 300 ? m.getBounds().pad(0.35) : null
    const cellPx = places.length > 1000 ? CLUSTER_PX * 1.4 : CLUSTER_PX // fewer, bigger clusters for big sets
    for (const p of places) {
      if (view && !view.contains([p.latitude, p.longitude]) && p.id !== selected) continue
      const pt = m.project([p.latitude, p.longitude], zoom)
      const key = zoom >= 16 ? p.id : `${Math.floor(pt.x / cellPx)}:${Math.floor(pt.y / cellPx)}`
      const cell = cells.get(key)
      if (cell) cell.push(p)
      else cells.set(key, [p])
    }
    for (const group of cells.values()) {
      if (group.length > 1 && !group.some((p) => p.id === selected)) {
        const lat = group.reduce((s, p) => s + p.latitude, 0) / group.length
        const lon = group.reduce((s, p) => s + p.longitude, 0) / group.length
        const icon = L.divIcon({ className: 'pm-cluster', html: '', iconSize: [34, 34] })
        const mk = L.marker([lat, lon], { icon, keyboard: true, title: `${group.length} places` })
        mk.on('add', () => {
          const node = mk.getElement()
          if (node) node.replaceChildren(el('span', '', String(group.length)))
        })
        // Tooltips are built on first hover (hundreds of clusters redraw after every move).
        mk.once('mouseover', () => mk.bindTooltip(el('span', '', group.slice(0, 5).map((p) => p.name).join(', ') + (group.length > 5 ? '…' : '')), { direction: 'top', offset: [0, -14] }).openTooltip())
        mk.on('click', () => m.fitBounds(L.latLngBounds(group.map((p) => [p.latitude, p.longitude] as [number, number])), { padding: [60, 60], maxZoom: 17 }))
        mk.addTo(g)
        continue
      }
      for (const p of group) {
        const mk = L.circleMarker([p.latitude, p.longitude], {
          radius: 7, color: '#fff', weight: 2, fillColor: statusColour(p.status), fillOpacity: 1, className: 'pm-marker',
        })
        // Leaflet treats string content as HTML, so tooltips and popups always get DOM nodes.
        mk.once('mouseover', () => mk.bindTooltip(el('span', '', p.name), { direction: 'top', offset: [0, -8] }).openTooltip())
        mk.bindPopup(() => popup(p), { className: 'pm-popup', offset: [0, -4], autoPanPadding: [24, 24] })
        mk.on('click', () => cb.current.onSelect(p.id))
        mk.addTo(g)
        markers.current.set(p.id, mk)
      }
    }
    if (!fitted.current && places.length) {
      fitted.current = true
      const b = L.latLngBounds(places.map((p) => [p.latitude, p.longitude] as [number, number]))
      m.fitBounds(b, { padding: [48, 48], maxZoom: 14 })
    }
  }, [places, zoomTick, selected])

  /** Popup with the coordinates (and a found name) and "Add a place here". Text nodes only. */
  function addPopup(m: L.Map, at: L.LatLngExpression, lat: number, lng: number, label?: string, address?: string) {
    const wrap = el('div', 'pm-pop')
    if (label) wrap.append(el('div', 'pm-pop-title', label))
    if (address && address !== label) wrap.append(el('div', 'pm-pop-text', address))
    wrap.append(el('div', 'pm-pop-meta', `${lat.toFixed(5)}, ${lng.toFixed(5)}`))
    const add = el('button', 'btn primary sm', 'Add a place here')
    add.type = 'button'
    add.addEventListener('click', () => {
      m.closePopup()
      cb.current.onAddAt(lat, lng, label, address)
    })
    wrap.append(add)
    L.popup({ closeButton: !!label, className: 'pm-popup', autoPanPadding: [24, 24] }).setLatLng(at).setContent(wrap).openOn(m)
  }

  // Crosshair while adding.
  useEffect(() => {
    box.current?.classList.toggle('adding', !!addMode)
    if (addMode) map.current?.closePopup()
  }, [addMode])

  // Fly to a search result / suggestion.
  useEffect(() => {
    const m = map.current
    if (!m || !focus) return
    const [s, n, w, e] = focus.bbox ?? [0, 0, 0, 0]
    if (focus.bbox && (n - s > 0.002 || e - w > 0.002)) m.flyToBounds([[s, w], [n, e]], { maxZoom: focus.zoom ?? 17, duration: 0.8 })
    else m.flyTo([focus.lat, focus.lon], Math.max(m.getZoom(), focus.zoom ?? 16), { duration: 0.8 })
    if (focus.label !== undefined) {
      const t = setTimeout(() => addPopup(m, [focus.lat, focus.lon], focus.lat, focus.lon, focus.label, focus.address), 850)
      return () => clearTimeout(t)
    }
  }, [focus?.key])

  // Your location.
  useEffect(() => {
    const m = map.current
    if (!m) return
    me.current?.remove()
    me.current = null
    if (!userPos) return
    me.current = L.circleMarker([userPos.lat, userPos.lon], { radius: 6, color: '#fff', weight: 2, fillColor: '#2563eb', fillOpacity: 1, interactive: false, className: 'pm-me' }).addTo(m)
  }, [userPos?.lat, userPos?.lon])

  useEffect(() => {
    const m = map.current
    if (!m || !fit?.points.length) return
    m.fitBounds(L.latLngBounds(fit.points), { padding: [48, 48], maxZoom: 15 })
  }, [fit?.key])

  // Photo heat map layer.
  useEffect(() => {
    const m = map.current
    if (!m) return
    if (!heat) {
      heatLayer.current?.remove()
      heatLayer.current = null
      return
    }
    if (!heatLayer.current || !m.hasLayer(heatLayer.current.leaflet)) heatLayer.current = new HeatLayer(heat).addTo(m) as HeatLayer
    else heatLayer.current.setPoints(heat)
  }, [heat])

  // Photo-derived suggestions as dashed "ghost" pins.
  useEffect(() => {
    const g = ghosts.current
    if (!g) return
    g.clearLayers()
    for (const sug of suggestions ?? []) {
      const mk = L.circleMarker([sug.latitude, sug.longitude], { radius: 8, color: statusColour(), weight: 2, dashArray: '3 3', fillOpacity: 0.12, fillColor: statusColour() })
      mk.bindTooltip(el('span', '', `${sug.name}: ${sug.photos} photos on ${sug.days} days`), { direction: 'top', offset: [0, -8] })
      mk.on('click', () => cb.current.onSuggestion?.(sug))
      mk.addTo(g)
    }
  }, [suggestions])

  // Highlight and fly to the selected place.
  useEffect(() => {
    const m = map.current
    if (!m) return
    markers.current.forEach((mk, id) => {
      const on = id === selected
      mk.setStyle({ radius: on ? 10 : 7, weight: on ? 3 : 2 })
      if (on) mk.bringToFront()
    })
    const mk = selected ? markers.current.get(selected) : null
    if (mk) {
      const ll = mk.getLatLng()
      if (!m.getBounds().pad(-0.15).contains(ll) || m.getZoom() < 13) m.flyTo(ll, Math.max(m.getZoom(), 15), { duration: 0.6 })
      setTimeout(() => mk.openPopup(), m.getBounds().contains(ll) ? 0 : 650)
    }
  }, [selected, places])

  function popup(p: Place): HTMLElement {
    const wrap = el('div', 'pm-pop')
    wrap.append(el('div', 'pm-pop-title', p.name))
    const st = p.status === 'visited' ? `Visited${p.visited_on ? ' ' + p.visited_on : ''}` : p.status === 'want_to_go' ? 'Want to go' : 'Saved'
    const meta = [cb.current.categoryLabel(p.category), st, p.rating ? `${'★'.repeat(p.rating)}${'☆'.repeat(5 - p.rating)}` : ''].filter(Boolean).join(' · ')
    if (meta) wrap.append(el('div', 'pm-pop-meta', meta))
    if (p.address) wrap.append(el('div', 'pm-pop-text', p.address))
    if (p.description) wrap.append(el('div', 'pm-pop-text', p.description))
    if (p.notes) wrap.append(el('div', 'pm-pop-meta', p.notes))
    const details = el('button', 'btn sm', 'Details')
    details.type = 'button'
    details.addEventListener('click', () => cb.current.onSelect(p.id))
    const actions = el('div', 'pm-pop-actions')
    const dir = el('a', 'btn sm', 'Directions')
    dir.href = `https://www.openstreetmap.org/directions?to=${p.latitude.toFixed(6)}%2C${p.longitude.toFixed(6)}`
    dir.target = '_blank'
    dir.rel = 'noopener noreferrer'
    actions.append(details, dir)
    if (cb.current.canEdit(p)) {
      const edit = el('button', 'btn sm', 'Edit')
      edit.type = 'button'
      edit.addEventListener('click', () => cb.current.onEdit(p))
      actions.append(edit)
    }
    wrap.append(actions)
    return wrap
  }

  return (
    <>
      <div ref={box} className="pm-map" role="region" aria-label="Map of places" />
      <ul className="pm-legend" aria-label="Map legend">
        <li><span className="pm-dot" style={{ background: 'var(--app-accent)' }} />Saved</li>
        <li><span className="pm-dot" style={{ background: 'var(--app-warning)' }} />Want to go</li>
        <li><span className="pm-dot" style={{ background: 'var(--app-success)' }} />Visited</li>
        {suggestions && suggestions.length > 0 && <li><span className="pm-dot ghost" />Suggested</li>}
        <li><span className="pm-dot cluster">3</span>Group</li>
        {userPos && <li><span className="pm-dot" style={{ background: '#2563eb' }} />You</li>}
        {heat && <li className="pm-heat-key">Photos <span className="pm-ramp" aria-hidden="true" /> more</li>}
      </ul>
    </>
  )
}
