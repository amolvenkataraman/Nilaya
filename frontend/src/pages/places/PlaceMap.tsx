// Leaflet map of places (on lib/map). Places are teardrop pins (status colour, category glyph, visited badge)
// drawn as divIcons whose HTML is built only from constants; popups and tooltips are built from DOM text nodes,
// never HTML strings, so place names and notes are always plain text. Nearby pins merge into count markers
// (gridCluster) until zoomed in; big sets are culled to the view. A click on the map asks placewise what's there
// (GET /places/here: the place, state and country, parks, water, airport, time zone, nearby) and outlines the
// smallest area the point is in; a search result is outlined the same way.
import { useEffect, useRef, useState } from 'react'
import { Icon } from '../../components/Icon'
import { buttonClass } from '../../components/ui'
import { cn } from '../../lib/cn'
import { iconMarkup } from '../../lib/favicon'
import { countMarker } from '../../lib/map/countMarker'
import { type Box, directionsUrl, fmtCoords } from '../../lib/map/geo'
import { gridCluster } from '../../lib/map/gridCluster'
import { useHeatLayer } from '../../lib/map/heat'
import { HeatRamp } from '../../lib/map/HeatFilters'
import L from '../../lib/map/leaflet'
import type { HeatPoint } from '../../lib/map/points'
import { useLeafletMap } from '../../lib/map/useLeafletMap'
import { useViewportBox } from '../../lib/map/useViewportBox'
import { categoryIcon, fetchHere, fetchOutline, type Here, type Pin as Place, STATUSES, type Suggestion, stars, statusOf } from './api'
import { placeText } from '../../lib/format'

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
  /** The visible box, debounced and snapped (the page fetches heat points for it). */
  onBox?: (b: Box) => void
  /** "Add place" mode: the next map click adds a place there (no popup). */
  addMode?: boolean
  /** Fly here (a search result or a suggestion); `label` set = offer "Add a place here" with that name. */
  focus?: MapFocus | null
  /** Your location (a dot on the map). */
  userPos?: { lat: number; lon: number } | null
  /** Fit these points once per new key (e.g. after an import). */
  fit?: { key: number; points: [number, number][] } | null
}

export interface MapFocus {
  key: number
  lat: number
  lon: number
  zoom?: number
  bbox?: [number, number, number, number]
  label?: string
  address?: string
  /** placewise id of a searched place: its outline is drawn. */
  id?: string
}

/** The accent colour for vector layers (suggestion rings), read from the tokens. */
function accentColour(): string {
  return getComputedStyle(document.documentElement).getPropertyValue('--app-accent').trim() || '#0f6d77'
}
const CLUSTER_PX = 44
const USER_DOT = '#2563eb'

/** Teardrop outline on a 28x36 box (the classic map's shape); the tip is at (14, 35). */
export const PIN_PATH = 'M14 1C6.8 1 1 6.7 1 13.7 1 23.2 14 35 14 35s13-11.8 13-21.3C27 6.7 21.2 1 14 1z'
const glyph = (inner: string) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${inner}</svg>`
const DOT = '<circle cx="12" cy="12" r="3.5" fill="currentColor" stroke="none"/>'
const statusLabel = (s?: string) => STATUSES.find((x) => x.key === statusOf({ status: s }))?.label ?? 'Saved'

/** One divIcon per (category, status, selected), built once: the HTML is constants only (Icon path data and
 *  fixed class names from lib/map/map.css; unknown categories get a dot), so no place text reaches innerHTML. */
const pinIcons = new Map<string, L.DivIcon>()
function pinIcon(category: string, status: string | undefined, selected: boolean): L.DivIcon {
  const st = statusOf({ status })
  const name = categoryIcon(category)
  const key = `${name ?? ''}|${st}|${selected ? 1 : 0}`
  let icon = pinIcons.get(key)
  if (!icon) {
    const badge = st === 'visited' ? `<span class="map-pin-badge">${glyph(iconMarkup('check'))}</span>` : ''
    icon = L.divIcon({
      className: 'map-pin-icon',
      html:
        `<div class="map-pin st-${st}${selected ? ' is-selected' : ''}"><svg class="map-pin-shape" viewBox="0 0 28 36" aria-hidden="true" focusable="false"><path d="${PIN_PATH}"/></svg>` +
        `<span class="map-pin-glyph">${glyph(name ? iconMarkup(name) : DOT)}</span>${badge}</div>`,
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
// Popup content classes. `.leaflet-container a` colours links, so the Directions button restates its colour.
const pop = {
  wrap: 'grid gap-1',
  title: 'pr-4 text-sm font-semibold [overflow-wrap:anywhere]',
  meta: 'text-xs text-muted',
  text: 'text-xs whitespace-pre-line [overflow-wrap:anywhere]',
  actions: 'mt-1.5 flex gap-1.5',
  button: buttonClass({ size: 'sm', className: 'text-fg! hover:no-underline' }),
  primary: buttonClass({ size: 'sm', variant: 'primary', className: 'text-accent-fg!' }),
}

/** What a map click learned, as short lines: parks, water, airport, local time, nearby. */
function hereLines(h: Here): string[] {
  const out: string[] = []
  const extraParks = h.parks.map((p) => p.name).filter((n) => n && !(h.place ?? '').includes(n))
  if (extraParks.length) out.push(`In ${extraParks.map(placeText).join(', ')}`)
  if (h.water) out.push(`${h.water.relation === 'near' ? 'Near' : 'On'} ${h.water.name}`)
  if (h.airport) out.push(`At ${h.airport.name}`)
  if (h.tz) {
    const time = new Intl.DateTimeFormat(undefined, { timeStyle: 'short', timeZone: h.tz }).format(new Date())
    out.push(`${time} local time · ${h.tz.replace(/_/g, ' ')}`)
  }
  const near = h.nearby.filter((n) => n.kind !== 'locality').slice(0, 3)
  if (near.length) out.push(`Nearby: ${near.map((n) => n.name).join(', ')}`)
  return out
}

export function PlaceMap({
  places,
  selected,
  categoryLabel,
  canEdit,
  onSelect,
  onEdit,
  onAddAt,
  suggestions,
  onSuggestion,
  heat,
  onBox,
  addMode,
  focus,
  userPos,
  fit,
}: Props) {
  const box = useRef<HTMLElement>(null)
  const layer = useRef<L.LayerGroup | null>(null)
  const markers = useRef(new Map<string, L.Marker>())
  const fitted = useRef(false)
  // Latest callbacks for Leaflet handlers created once.
  const cb = useRef({ onSelect, onEdit, onAddAt, categoryLabel, canEdit, onSuggestion, addMode })
  cb.current = { onSelect, onEdit, onAddAt, categoryLabel, canEdit, onSuggestion, addMode }
  const me = useRef<L.CircleMarker | null>(null)
  const ghosts = useRef<L.LayerGroup | null>(null)
  const [zoomTick, setZoomTick] = useState(0)
  // The selected place's popup waits for a fly to end: the fly's moveend redraws every pin (closing popups).
  const pendingPopup = useRef<string | null>(null)
  const flying = useRef(false)
  const outline = useRef<L.GeoJSON | null>(null)
  const lookup = useRef<AbortController | null>(null)

  // Canvas renderer for the vector layers (suggestions, your location); pins are cheap divIcons, and big sets
  // are culled to the view and clustered below, so the DOM stays small.
  const map = useLeafletMap(box, {
    center: [20, 0],
    zoom: 2,
    preferCanvas: true,
    onClick: ({ lat, lng }, e) => {
      if (cb.current.addMode) return cb.current.onAddAt(lat, lng)
      if (map.current) addPopup(map.current, e.latlng, lat, lng)
      cb.current.onSelect(null)
    },
  })
  const view = useViewportBox(map)
  const onBoxRef = useRef(onBox)
  onBoxRef.current = onBox
  useEffect(() => {
    if (view) onBoxRef.current?.(view)
  }, [view])
  useHeatLayer(map, heat ?? null)

  useEffect(() => {
    const m = map.current
    if (!m || !box.current) return
    layer.current = L.layerGroup().addTo(m)
    ghosts.current = L.layerGroup().addTo(m)
    // Zoom or pan: re-cluster what's in view. Zero-length moves (a focused pin's or popup's auto-pan that had
    // nothing to do still fires moveend) are skipped, so a redraw can't feed itself.
    let seen = ''
    const onMove = () => {
      const c = m.getCenter()
      const sz = m.getSize()
      const v = `${m.getZoom()}:${c.lat.toFixed(7)}:${c.lng.toFixed(7)}:${sz.x}x${sz.y}` // size: a resize widens the culled view
      if (v !== seen) {
        seen = v
        setZoomTick((t) => t + 1)
      }
    }
    m.on('moveend', onMove)
    ;(box.current as HTMLElement & { _leafletMap?: L.Map })._leafletMap = m // handle for tests (no global)
    return () => {
      m.off('moveend', onMove)
      markers.current.clear()
    }
  }, [map])

  // Redraw markers when the places or zoom change. Nearby markers cluster (pixel grid) until zoomed in.
  // biome-ignore lint/correctness/useExhaustiveDependencies: zoomTick is the trigger for a moved view
  useEffect(() => {
    const m = map.current
    const g = layer.current
    if (!m || !g) return
    // Pins are rebuilt below (selecting, panning, a popup's auto-pan and a focused pin's auto-pan all redraw):
    // hand focus, and the selected place's open popup, to the replacement pins.
    let focusedId: string | undefined
    markers.current.forEach((mk, id) => {
      if (mk.getElement() === document.activeElement) focusedId = id
    })
    const reopen = !!selected && !!markers.current.get(selected)?.isPopupOpen()
    g.clearLayers()
    markers.current.clear()
    const zoom = m.getZoom()
    // Big sets: only what's in (or near) the view gets markers; panning re-runs this.
    const inView = places.length > 300 ? m.getBounds().pad(0.35) : null
    const shown = inView ? places.filter((p) => p.id === selected || inView.contains([p.latitude, p.longitude])) : places
    const cells = gridCluster(shown, {
      latLng: (p) => [p.latitude, p.longitude],
      project: (lat, lng) => m.project([lat, lng], zoom),
      // Fewer, bigger clusters for big sets; from zoom 16 every place is its own pin.
      cellPx: zoom >= 16 ? 0 : places.length > 1000 ? CLUSTER_PX * 1.4 : CLUSTER_PX,
    })
    for (const c of cells) {
      const group = c.items
      if (group.length > 1 && !group.some((p) => p.id === selected)) {
        const mk = countMarker([c.lat, c.lng], { text: String(group.length), size: 34, title: `${group.length} places` })
        // Tooltips are built on first hover (hundreds of clusters redraw after every move).
        mk.once('mouseover', () =>
          mk
            .bindTooltip(
              el(
                'span',
                '',
                group
                  .slice(0, 5)
                  .map((p) => p.name)
                  .join(', ') + (group.length > 5 ? '…' : ''),
              ),
              { direction: 'top', offset: [0, -14] },
            )
            .openTooltip(),
        )
        mk.on('click', () => m.fitBounds(L.latLngBounds([c.south, c.west], [c.north, c.east]), { padding: [60, 60], maxZoom: 17 }))
        mk.addTo(g)
        continue
      }
      for (const p of group) {
        const on = p.id === selected
        // Marker options set title as a DOM property (not HTML); with keyboard: true the pin is a focusable role=button.
        const mk = L.marker([p.latitude, p.longitude], {
          icon: pinIcon(p.category, p.status, on),
          title: `${p.name} (${statusLabel(p.status)})`,
          alt: p.name,
          keyboard: true,
          riseOnHover: true,
          zIndexOffset: on ? 1000 : 0,
          // No pan on focus: focus is handed to the rebuilt pin after each redraw, and a pan there would fight the
          // popup's auto-pan (each move redraws). Pins outside the view are culled or flown to on select anyway.
          autoPanOnFocus: false,
        })
        // Leaflet treats string content as HTML, so tooltips and popups always get DOM nodes.
        mk.once('mouseover', () => mk.bindTooltip(el('span', '', p.name), { direction: 'top' }).openTooltip())
        mk.bindPopup(() => popup(p), { autoPanPadding: [24, 24] })
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
    if (reopen && selected) markers.current.get(selected)?.openPopup()
    else if (pendingPopup.current && !flying.current) {
      markers.current.get(pendingPopup.current)?.openPopup()
      pendingPopup.current = null
    }
    if (!fitted.current && places.length) {
      fitted.current = true
      m.fitBounds(L.latLngBounds(places.map((p) => [p.latitude, p.longitude] as [number, number])), { padding: [48, 48], maxZoom: 14 })
    }
  }, [places, zoomTick, selected, map])

  /** Draw a place's outline (replacing the last one); nothing when it has none. */
  function showOutline(m: L.Map, id: string | undefined, signal?: AbortSignal) {
    outline.current?.remove()
    outline.current = null
    if (!id) return
    fetchOutline(id, signal)
      .then((fc) => {
        if (signal?.aborted || !fc.features.length) return
        outline.current = L.geoJSON(fc, {
          interactive: false,
          style: { color: accentColour(), weight: 2, opacity: 0.9, fillOpacity: 0.06 },
        }).addTo(m)
      })
      .catch(() => {})
  }

  /** Popup with the coordinates (and a found name) and "Add a place here". Without a name (a click on the map)
   * it asks placewise what's there and fills in. Text nodes only. */
  function addPopup(m: L.Map, at: L.LatLngExpression, lat: number, lng: number, label?: string, address?: string) {
    lookup.current?.abort()
    const ctl = new AbortController()
    lookup.current = ctl
    const wrap = el('div', pop.wrap)
    let name = label
    let where = address
    const draw = (here?: Here, note?: string) => {
      wrap.replaceChildren()
      if (name) wrap.append(el('div', pop.title, placeText(name)))
      if (where && where !== name) wrap.append(el('div', pop.text, where))
      if (here) for (const line of hereLines(here)) wrap.append(el('div', pop.text, line))
      if (note) wrap.append(el('div', pop.meta, note))
      wrap.append(el('div', pop.meta, fmtCoords(lat, lng)))
      const add = el('button', pop.primary, 'Add a place here')
      add.type = 'button'
      add.addEventListener('click', () => {
        m.closePopup()
        cb.current.onAddAt(lat, lng, name, where)
      })
      wrap.append(add)
    }
    draw(undefined, label ? undefined : 'Finding the place…')
    const popup = L.popup({ closeButton: true, autoPanPadding: [24, 24], maxWidth: 320 })
      .setLatLng(at)
      .setContent(wrap)
    popup.on('remove', () => {
      ctl.abort()
      if (!label) showOutline(m, undefined)
    })
    popup.openOn(m)
    if (label) return
    fetchHere(lat, lng, ctl.signal)
      .then((here) => {
        if (ctl.signal.aborted) return
        name = here.place ?? here.label
        const state = here.where.find((w) => w.level === 'State')?.name
        const country = here.where.find((w) => w.level === 'Country')?.name
        where = [state, country].filter(Boolean).join(', ') || undefined
        draw(here)
        popup.update()
        const park = here.parks[0]
        const city = here.where.find((w) => w.level === 'City' && w.relation === 'within')
        showOutline(m, park?.id ?? city?.id, ctl.signal)
      })
      .catch(() => {
        if (!ctl.signal.aborted) {
          draw(undefined, "Place details aren't available right now.")
          popup.update()
        }
      })
  }

  // Crosshair while adding. A class on the element Leaflet owns (React re-rendering className would drop Leaflet's).
  useEffect(() => {
    box.current?.classList.toggle('map-crosshair', !!addMode)
    if (addMode) map.current?.closePopup()
  }, [addMode, map])

  // Fly to a search result / suggestion.
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new key is a new request to fly
  useEffect(() => {
    const m = map.current
    if (!m || !focus) return
    const [s, n, w, e] = focus.bbox ?? [0, 0, 0, 0]
    if (focus.bbox && (n - s > 0.002 || e - w > 0.002))
      m.flyToBounds(
        [
          [s, w],
          [n, e],
        ],
        { maxZoom: focus.zoom ?? 17, duration: 0.8 },
      )
    else m.flyTo([focus.lat, focus.lon], Math.max(m.getZoom(), focus.zoom ?? 16), { duration: 0.8 })
    showOutline(m, focus.id)
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
    me.current = L.circleMarker([userPos.lat, userPos.lon], {
      radius: 6,
      color: '#fff',
      weight: 2,
      fillColor: USER_DOT,
      fillOpacity: 1,
      interactive: false,
    }).addTo(m)
  }, [userPos, map])

  // biome-ignore lint/correctness/useExhaustiveDependencies: fit once per new key
  useEffect(() => {
    const m = map.current
    if (!m || !fit?.points.length) return
    m.fitBounds(L.latLngBounds(fit.points), { padding: [48, 48], maxZoom: 15 })
  }, [fit?.key])

  // Photo-derived suggestions as dashed "ghost" rings.
  useEffect(() => {
    const g = ghosts.current
    if (!g) return
    g.clearLayers()
    const colour = accentColour()
    for (const sug of suggestions ?? []) {
      const mk = L.circleMarker([sug.latitude, sug.longitude], {
        radius: 8,
        color: colour,
        weight: 2,
        dashArray: '3 3',
        fillOpacity: 0.12,
        fillColor: colour,
      })
      mk.bindTooltip(el('span', '', `${sug.name}: ${sug.photos} photos on ${sug.days} days`), { direction: 'top', offset: [0, -8] })
      mk.on('click', () => cb.current.onSuggestion?.(sug))
      mk.addTo(g)
    }
  }, [suggestions])

  // Fly to the selected place and open its popup (the redraw above already gave it the selected pin).
  // biome-ignore lint/correctness/useExhaustiveDependencies: places is a trigger (a pin may arrive after selection)
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
      m.once('moveend', () => {
        flying.current = false
      })
      m.flyTo(ll, Math.max(m.getZoom(), 15), { duration: 0.6 })
    } else {
      const t = setTimeout(() => markers.current.get(selected)?.openPopup(), 0)
      return () => clearTimeout(t)
    }
  }, [selected, places, map])

  function popup(p: Place): HTMLElement {
    const wrap = el('div', pop.wrap)
    wrap.append(el('div', pop.title, p.name))
    const st =
      p.status === 'visited' ? `Visited${p.visited_on ? ` ${p.visited_on}` : ''}` : p.status === 'want_to_go' ? 'Want to go' : 'Saved'
    const meta = [cb.current.categoryLabel(p.category), st, stars(p.rating)].filter(Boolean).join(' · ')
    if (meta) wrap.append(el('div', pop.meta, meta))
    if (p.address) wrap.append(el('div', pop.text, p.address))
    if (p.description) wrap.append(el('div', pop.text, p.description))
    if (p.notes) wrap.append(el('div', pop.meta, p.notes))
    const details = el('button', pop.button, 'Details')
    details.type = 'button'
    details.addEventListener('click', () => cb.current.onSelect(p.id))
    const actions = el('div', pop.actions)
    const dir = el('a', pop.button, 'Directions')
    dir.href = directionsUrl(p.latitude, p.longitude)
    dir.target = '_blank'
    dir.rel = 'noopener noreferrer'
    actions.append(details, dir)
    if (cb.current.canEdit(p)) {
      const edit = el('button', pop.button, 'Edit')
      edit.type = 'button'
      edit.addEventListener('click', () => cb.current.onEdit(p))
      actions.append(edit)
    }
    wrap.append(actions)
    return wrap
  }

  const pinFill = { saved: 'fill-accent', want_to_go: 'fill-warning', visited: 'fill-success' } as const
  const dot = 'size-2.5 flex-none rounded-full border-[1.5px]'
  return (
    <>
      <section ref={box} className="absolute inset-0 bg-surface-2" aria-label="Map of places" />
      <ul
        className="absolute bottom-3 left-3 z-500 m-0 flex max-w-[calc(100%-6rem)] flex-wrap gap-x-3 gap-y-1 rounded-md bg-[color-mix(in_srgb,var(--app-surface)_92%,transparent)] px-2.5 py-1.5 text-xs text-fg shadow-pop max-md:hidden"
        aria-label="Map legend"
      >
        {STATUSES.map((s) => (
          <li key={s.key} className="inline-flex items-center gap-1.5">
            <span className={cn('relative inline-block h-3.5 w-2.75 flex-none', s.key === 'visited' && 'mr-0.75')} aria-hidden="true">
              <svg
                viewBox="0 0 28 36"
                className={cn(
                  'block size-full overflow-visible stroke-white stroke-2 drop-shadow-[0_0_0.5px_rgba(0,0,0,0.5)]',
                  pinFill[s.key],
                )}
              >
                <path d={PIN_PATH} />
              </svg>
              {s.key === 'visited' && (
                <span className="absolute -top-0.5 -right-1 box-border flex size-[7px] rounded-full bg-white p-[0.5px] text-success shadow-[0_0_0_1px_var(--app-success)] [&>svg]:size-full">
                  <Icon name="check" size={7} />
                </span>
              )}
            </span>
            {s.label}
          </li>
        ))}
        {suggestions && suggestions.length > 0 && (
          <li className="inline-flex items-center gap-1.5">
            <span className={cn(dot, 'border-dashed border-accent bg-transparent')} />
            Suggested
          </li>
        )}
        <li className="inline-flex items-center gap-1.5">
          <span className="inline-grid h-4 min-w-4 place-items-center rounded-full bg-fg px-1 text-3xs text-bg">3</span>Group
        </li>
        {userPos && (
          <li className="inline-flex items-center gap-1.5">
            <span className={cn(dot, 'border-white bg-[#2563eb] shadow-[0_0_0_1px_var(--app-border)]')} />
            You
          </li>
        )}
        {heat && (
          <li className="inline-flex items-center gap-1.5">
            Photos <HeatRamp /> more
          </li>
        )}
      </ul>
    </>
  )
}
