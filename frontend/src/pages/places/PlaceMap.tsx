// Leaflet map of places. Places are teardrop pins (status colour, category glyph, visited badge) drawn as
// divIcons whose HTML is built only from constants; popups and tooltips are built from DOM text nodes,
// never HTML strings, so place names and notes are always plain text.
import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { categoryIcon, STATUSES, type Pin as Place, type Suggestion } from './api'
import { iconMarkup } from '../../lib/favicon'
import { Icon } from '../../components/Icon'
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

/** Teardrop outline on a 28x36 box (the classic map's shape); the tip is at (14, 35). */
export const PIN_PATH = 'M14 1C6.8 1 1 6.7 1 13.7 1 23.2 14 35 14 35s13-11.8 13-21.3C27 6.7 21.2 1 14 1z'
const glyph = (inner: string) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${inner}</svg>`
const DOT = '<circle cx="12" cy="12" r="3.5" fill="currentColor" stroke="none"/>'
const safeStatus = (s?: string) => (s === 'visited' || s === 'want_to_go' ? s : 'saved')
const statusLabel = (s?: string) => STATUSES.find((x) => x.key === safeStatus(s))!.label

/** One divIcon per (category, status, selected), built once: the HTML is constants only (Icon path data and
 *  fixed class names; unknown categories get a dot), so no place text ever reaches innerHTML. */
const pinIcons = new Map<string, L.DivIcon>()
function pinIcon(category: string, status: string | undefined, selected: boolean): L.DivIcon {
  const st = safeStatus(status)
  const name = categoryIcon(category)
  const key = `${name ?? ''}|${st}|${selected ? 1 : 0}`
  let icon = pinIcons.get(key)
  if (!icon) {
    const badge = st === 'visited' ? `<span class="pm-pin-badge">${glyph(iconMarkup('check'))}</span>` : ''
    icon = L.divIcon({
      className: 'pm-pin-icon',
      html: `<div class="pm-pin st-${st}${selected ? ' is-selected' : ''}"><svg class="pm-pin-shape" viewBox="0 0 28 36" aria-hidden="true" focusable="false"><path d="${PIN_PATH}"/></svg>`
        + `<span class="pm-pin-glyph">${glyph(name ? iconMarkup(name) : DOT)}</span>${badge}</div>`,
      iconSize: [28, 36],
      iconAnchor: [14, 35],
      tooltipAnchor: [0, -30],
      popupAnchor: [0, -32],
    })
    pinIcons.set(key, icon)
  }
  return icon
}

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
  const markers = useRef(new Map<string, L.Marker>())
  const fitted = useRef(false)
  // Latest callbacks for Leaflet handlers created once.
  const cb = useRef({ onSelect, onEdit, onAddAt, categoryLabel, canEdit, onSuggestion, onBounds, addMode })
  cb.current = { onSelect, onEdit, onAddAt, categoryLabel, canEdit, onSuggestion, onBounds, addMode }
  const me = useRef<L.CircleMarker | null>(null)
  const heatLayer = useRef<HeatLayer | null>(null)
  const ghosts = useRef<L.LayerGroup | null>(null)
  const [zoomTick, setZoomTick] = useState(0)
  // The selected place's popup waits for a fly to end: the fly's moveend redraws every pin (closing popups).
  const pendingPopup = useRef<string | null>(null)
  const flying = useRef(false)

  useEffect(() => {
    if (!box.current) return
    // Canvas renderer for the vector layers (suggestions, your location); pins are cheap divIcons, and big
    // sets are culled to the view and clustered below, so the DOM stays small.
    const m = L.map(box.current, { zoomControl: false, worldCopyJump: true, preferCanvas: true }).setView([20, 0], 2)
    L.control.zoom({ position: 'bottomright' }).addTo(m)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(m)
    layer.current = L.layerGroup().addTo(m)
    ghosts.current = L.layerGroup().addTo(m)
    // Zoom or pan: re-cluster what's in view. Zero-length moves (a focused pin's or popup's auto-pan that had
    // nothing to do still fires moveend) are skipped, so a redraw can't feed itself.
    let seen = ''
    m.on('moveend', () => {
      const c = m.getCenter()
      const sz = m.getSize()
      const view = `${m.getZoom()}:${c.lat.toFixed(7)}:${c.lng.toFixed(7)}:${sz.x}x${sz.y}` // size: a resize widens the culled view
      if (view !== seen) (seen = view), setZoomTick((t) => t + 1)
    })
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
    // Pins are rebuilt below (selecting, panning, a popup's auto-pan and a focused pin's auto-pan all redraw):
    // hand focus, and the selected place's open popup, to the replacement pins.
    let focusedId: string | undefined
    markers.current.forEach((mk, id) => { if (mk.getElement() === document.activeElement) focusedId = id })
    const reopen = !!selected && !!markers.current.get(selected)?.isPopupOpen()
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
        const on = p.id === selected
        // Marker options set title as a DOM property (not HTML); with keyboard: true the pin is a focusable role=button.
        const mk = L.marker([p.latitude, p.longitude], {
          icon: pinIcon(p.category, p.status, on), title: `${p.name} (${statusLabel(p.status)})`, alt: p.name,
          keyboard: true, riseOnHover: true, zIndexOffset: on ? 1000 : 0,
          // No pan on focus: focus is handed to the rebuilt pin after each redraw, and a pan there would fight the
          // popup's auto-pan (each move redraws). Pins outside the view are culled or flown to on select anyway.
          autoPanOnFocus: false,
        })
        // Leaflet treats string content as HTML, so tooltips and popups always get DOM nodes.
        mk.once('mouseover', () => mk.bindTooltip(el('span', '', p.name), { direction: 'top' }).openTooltip())
        mk.bindPopup(() => popup(p), { className: 'pm-popup', autoPanPadding: [24, 24] })
        mk.on('click', () => cb.current.onSelect(p.id))
        mk.on('keydown', (e: L.LeafletKeyboardEvent) => {
          if (e.originalEvent.key !== 'Enter' && e.originalEvent.key !== ' ') return
          e.originalEvent.preventDefault()
          if (p.id === selected) mk.openPopup()
          else cb.current.onSelect(p.id)
        })
        mk.addTo(g)
        markers.current.set(p.id, mk)
      }
    }
    if (focusedId) markers.current.get(focusedId)?.getElement()?.focus({ preventScroll: true })
    if (reopen) markers.current.get(selected!)?.openPopup()
    else if (pendingPopup.current && !flying.current) {
      markers.current.get(pendingPopup.current)?.openPopup()
      pendingPopup.current = null
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

  // Fly to the selected place and open its popup (the redraw above already gave it the selected pin).
  useEffect(() => {
    const m = map.current
    if (!m) return
    pendingPopup.current = null
    const mk = selected ? markers.current.get(selected) : null
    if (!selected || !mk) return
    const ll = mk.getLatLng()
    if (!m.getBounds().pad(-0.15).contains(ll) || m.getZoom() < 13) {
      // Opened by the redraw after the fly (see above), on the pin that redraw creates.
      pendingPopup.current = selected
      flying.current = true
      m.once('moveend', () => { flying.current = false })
      m.flyTo(ll, Math.max(m.getZoom(), 15), { duration: 0.6 })
    } else {
      const t = setTimeout(() => markers.current.get(selected)?.openPopup(), 0)
      return () => clearTimeout(t)
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
        {STATUSES.map((s) => (
          <li key={s.key}>
            <span className={'pm-pin-key st-' + s.key} aria-hidden="true">
              <svg viewBox="0 0 28 36"><path d={PIN_PATH} /></svg>
              {s.key === 'visited' && <span className="pm-pin-badge"><Icon name="check" size={7} /></span>}
            </span>
            {s.label}
          </li>
        ))}
        {suggestions && suggestions.length > 0 && <li><span className="pm-dot ghost" />Suggested</li>}
        <li><span className="pm-dot cluster">3</span>Group</li>
        {userPos && <li><span className="pm-dot" style={{ background: '#2563eb' }} />You</li>}
        {heat && <li className="pm-heat-key">Photos <span className="pm-ramp" aria-hidden="true" /> more</li>}
      </ul>
    </>
  )
}
