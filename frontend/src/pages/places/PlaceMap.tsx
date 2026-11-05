// Leaflet map of places. Markers are circle markers (no image assets); popups are built from DOM
// text nodes, never HTML strings, so place names and notes are always plain text.
import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { Place, Suggestion } from './api'

interface Props {
  places: Place[]
  selected: string | null
  categoryLabel: (key: string) => string
  canEdit: (p: Place) => boolean
  onSelect: (id: string | null) => void
  onEdit: (p: Place) => void
  onAddAt: (lat: number, lon: number) => void
  suggestions?: Suggestion[]
  onSuggestion?: (s: Suggestion) => void
}

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


export function PlaceMap({ places, selected, categoryLabel, canEdit, onSelect, onEdit, onAddAt, suggestions, onSuggestion }: Props) {
  const box = useRef<HTMLDivElement>(null)
  const map = useRef<L.Map | null>(null)
  const layer = useRef<L.LayerGroup | null>(null)
  const markers = useRef(new Map<string, L.CircleMarker>())
  const fitted = useRef(false)
  // Latest callbacks for Leaflet handlers created once.
  const cb = useRef({ onSelect, onEdit, onAddAt, categoryLabel, canEdit, onSuggestion })
  cb.current = { onSelect, onEdit, onAddAt, categoryLabel, canEdit, onSuggestion }
  const ghosts = useRef<L.LayerGroup | null>(null)
  const [zoomTick, setZoomTick] = useState(0)

  useEffect(() => {
    if (!box.current) return
    const m = L.map(box.current, { zoomControl: false, worldCopyJump: true }).setView([20, 0], 2)
    L.control.zoom({ position: 'bottomright' }).addTo(m)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(m)
    layer.current = L.layerGroup().addTo(m)
    ghosts.current = L.layerGroup().addTo(m)
    m.on('zoomend', () => setZoomTick((t) => t + 1))
    m.on('click', (e: L.LeafletMouseEvent) => {
      const { lat, lng } = e.latlng.wrap()
      const wrap = el('div', 'pm-pop')
      wrap.append(el('div', 'pm-pop-meta', `${lat.toFixed(5)}, ${lng.toFixed(5)}`))
      const add = el('button', 'btn primary sm', 'Add a place here')
      add.type = 'button'
      add.addEventListener('click', () => {
        m.closePopup()
        cb.current.onAddAt(lat, lng)
      })
      wrap.append(add)
      L.popup({ closeButton: false, className: 'pm-popup' }).setLatLng(e.latlng).setContent(wrap).openOn(m)
      cb.current.onSelect(null)
    })
    map.current = m
    const ro = new ResizeObserver(() => m.invalidateSize())
    ro.observe(box.current)
    return () => {
      ro.disconnect()
      m.remove()
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
    for (const p of places) {
      const pt = m.project([p.latitude, p.longitude], zoom)
      const key = zoom >= 16 ? p.id : `${Math.floor(pt.x / CLUSTER_PX)}:${Math.floor(pt.y / CLUSTER_PX)}`
      cells.set(key, [...(cells.get(key) ?? []), p])
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
        mk.bindTooltip(el('span', '', group.slice(0, 5).map((p) => p.name).join(', ') + (group.length > 5 ? '…' : '')), { direction: 'top', offset: [0, -14] })
        mk.on('click', () => m.fitBounds(L.latLngBounds(group.map((p) => [p.latitude, p.longitude] as [number, number])), { padding: [60, 60], maxZoom: 17 }))
        mk.addTo(g)
        continue
      }
      for (const p of group) {
        const mk = L.circleMarker([p.latitude, p.longitude], {
          radius: 7, color: '#fff', weight: 2, fillColor: statusColour(p.status), fillOpacity: 1, className: 'pm-marker',
        })
        // Leaflet treats string content as HTML, so tooltips and popups always get DOM nodes.
        mk.bindTooltip(el('span', '', p.name), { direction: 'top', offset: [0, -8] })
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
      </ul>
    </>
  )
}
