// Photos › Tools: Geoguessr (guess where a random geotagged photo was taken) and location entry
// (pin photos that have no location). Both use the original photo URL once; nothing else is rendered.
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import 'leaflet/dist/leaflet.css'
import L from './leaflet-global'
import { ApiError, get, post, safeHref } from '../../lib/api'
import { photoSummaryQuery } from '../../lib/photoQueries'
import { userKey } from '../../lib/owner'
import { useMe } from '../../lib/queries'
import { fmtDate, fmtTime } from '../../lib/dates'
import type { Photo } from '../../lib/types'
import { Icon } from '../../components/Icon'
import { toast } from '../../components/toast'
import { useDebounced, useHotkey } from '../../components/ui'
import { HeatLayer, realPoints, type HeatPoint } from './heat'
import { closeness, distanceM, fmtDistance, score } from './game'

type LatLng = { lat: number; lng: number }
const START: [number, number] = [43.6425662, -79.3870568] // the classic pages' starting view
const WORLD = { south: -90, west: -180, north: 90, east: 180 }

/** A Leaflet map with the same OSM tiles as the rest of the app; `onClick` gets wrapped coordinates. */
function useMap(el: React.RefObject<HTMLDivElement | null>, onClick: (p: LatLng) => void) {
  const map = useRef<L.Map | null>(null)
  const click = useRef(onClick)
  click.current = onClick
  useEffect(() => {
    if (!el.current) return
    const m = L.map(el.current, { zoomControl: false, worldCopyJump: true }).setView(START, 10)
    L.control.zoom({ position: 'bottomright' }).addTo(m)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' }).addTo(m)
    m.on('click', (e: L.LeafletMouseEvent) => {
      const w = e.latlng.wrap()
      click.current({ lat: w.lat, lng: w.lng })
    })
    map.current = m
    const ro = new ResizeObserver(() => m.invalidateSize())
    ro.observe(el.current)
    return () => {
      ro.disconnect()
      m.remove()
      map.current = null
    }
  }, [el])
  return map
}

const pinStyle = (colour: string): L.CircleMarkerOptions => ({ radius: 8, color: '#fff', weight: 3, fillColor: colour, fillOpacity: 1 })
const when = (p: Photo) => (p.date_taken ? new Date(p.date_taken) : null)
const coords = (p: LatLng) => `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`
const skipKey = (e: KeyboardEvent) => e.ctrlKey || e.metaKey || e.altKey || !!(e.target as HTMLElement)?.closest?.('button, a, select, .dialog, .menu')

/** The photo, filling its panel; the thumbnail shows until the original has decoded. */
function Shot({ photo }: { photo: Photo }) {
  const full = safeHref(photo.url)
  const thumb = safeHref(photo.thumb_url)
  const [ready, setReady] = useState(false)
  if (photo.video) return full ? <video className="gg-media" src={full} poster={thumb ?? undefined} controls playsInline preload="metadata" /> : null
  return (
    <>
      {thumb && !ready && <img className="gg-media gg-thumb" src={thumb} alt="" aria-hidden="true" />}
      {full && (
        <img className={'gg-media' + (ready ? '' : ' loading')} src={full} alt="The photo to place" decoding="async" draggable={false}
          onLoad={(e) => void e.currentTarget.decode().catch(() => undefined).then(() => setReady(true))} />
      )}
      {!ready && <span className="spinner gg-spin" aria-label="Loading photo" />}
    </>
  )
}

// ---------------------------------------------------------------- Geoguessr
const STATS_KEY = 'app.photos.geoguessr'
type Stats = { rounds: number; total: number; best: number }
function readStats(): Stats {
  try {
    const s = JSON.parse(localStorage.getItem(STATS_KEY) ?? '') as Stats
    if (typeof s.rounds === 'number' && typeof s.total === 'number' && typeof s.best === 'number') return s
  } catch { /* fresh start */ }
  return { rounds: 0, total: 0, best: 0 }
}

export function GeoguessrPage() {
  const el = useRef<HTMLDivElement>(null)
  const layers = useRef<L.LayerGroup | null>(null)
  const viewBefore = useRef<{ c: L.LatLng; z: number } | null>(null)
  const [round, setRound] = useState(0)
  const [guess, setGuess] = useState<LatLng | null>(null)
  const [result, setResult] = useState<{ m: number; pts: number; actual: LatLng } | null>(null)
  const [stats, setStatsState] = useState(readStats)
  const setStats = (s: Stats) => {
    setStatsState(s)
    try { localStorage.setItem(STATS_KEY, JSON.stringify(s)) } catch { /* ignore */ }
  }
  const q = useQuery({
    queryKey: ['photos', 'game', round],
    queryFn: () => get<Photo>('photos/game/round'),
    staleTime: Infinity, gcTime: 0, refetchOnWindowFocus: false, refetchOnReconnect: false,
  })
  const photo = q.data
  const map = useMap(el, (p) => {
    if (result || !photo) return
    setGuess(p)
  })
  // Draw the guess (and after the reveal, the true spot and a dashed line between them).
  useEffect(() => {
    const m = map.current
    if (!m) return
    if (!layers.current || !m.hasLayer(layers.current)) layers.current = L.layerGroup().addTo(m)
    const g = layers.current
    g.clearLayers()
    if (guess) L.circleMarker([guess.lat, guess.lng], pinStyle('#dc2626')).bindTooltip('Your guess').addTo(g)
    if (guess && result) {
      const line = L.polyline([[guess.lat, guess.lng], [result.actual.lat, result.actual.lng]], {
        color: getComputedStyle(document.documentElement).getPropertyValue('--app-danger').trim() || '#c0392b', weight: 3, dashArray: '5, 10', opacity: 0.8,
      }).addTo(g)
      L.circleMarker([result.actual.lat, result.actual.lng], pinStyle('#16a34a')).bindTooltip('Where it was taken').addTo(g)
      map.current?.fitBounds(line.getBounds().pad(0.15), { maxZoom: 16 })
    }
  }, [guess, result, map])

  const submit = () => {
    if (!photo || !guess || result || photo.lat == null || photo.lon == null) return
    const m = map.current
    if (m) viewBefore.current = { c: m.getCenter(), z: m.getZoom() }
    const actual = { lat: photo.lat, lng: photo.lon }
    const d = distanceM(guess, actual)
    const pts = score(d)
    setResult({ m: d, pts, actual })
    setStats({ rounds: stats.rounds + 1, total: stats.total + pts, best: Math.max(stats.best, pts) })
  }
  const next = () => {
    setGuess(null)
    setResult(null)
    setRound((n) => n + 1)
    const v = viewBefore.current
    if (v) map.current?.setView(v.c, v.z)
  }
  useHotkey((e) => (e.key === 'Enter' || (e.key === 'n' && !!result)) && !skipKey(e), (e) => {
    e.preventDefault()
    if (result) next()
    else submit()
  })

  const avg = stats.rounds ? Math.round(stats.total / stats.rounds) : 0
  const t = photo && when(photo)
  return (
    <div className="gg-page">
      <header className="gg-head">
        <div className="grow">
          <h1>Geoguessr</h1>
          <p className="muted small">Look at the photo, then click the map where you think it was taken.</p>
        </div>
        <dl className="gg-stats" aria-label="This game">
          <div><dt>Rounds</dt><dd>{stats.rounds}</dd></div>
          <div><dt>Score</dt><dd>{stats.total.toLocaleString()}</dd></div>
          <div><dt>Average</dt><dd>{avg.toLocaleString()}</dd></div>
          <div><dt>Best round</dt><dd>{stats.best.toLocaleString()}</dd></div>
        </dl>
        <button className="btn ghost sm" onClick={() => setStats({ rounds: 0, total: 0, best: stats.best })} disabled={!stats.rounds} title="Start counting again (keeps your best round)">New game</button>
      </header>
      <div className="gg-panels">
        <div className="gg-photo">
          {photo ? <Shot key={photo.id} photo={photo} /> : q.isError ? (
            <p className="gg-msg">{q.error instanceof ApiError && q.error.status === 404 ? 'None of your photos have a location yet.' : "Couldn't load a photo."}</p>
          ) : <span className="spinner gg-spin" aria-label="Loading" />}
        </div>
        <div className="gg-mapwrap">
          <div ref={el} className="gg-map" role="region" aria-label="Map: click to place your guess" />
          {!result ? (
            <div className="gg-bar">
              <span className="muted small grow">{guess ? `Your guess: ${coords(guess)}` : 'Click the map to place your guess'}</span>
              <button className="btn primary" onClick={submit} disabled={!guess || !photo}>Guess<kbd>Enter</kbd></button>
            </div>
          ) : (
            <div className={'gg-result ' + closeness(result.m)} role="status">
              <div className="gg-result-main">
                <span className="gg-points"><strong>{result.pts.toLocaleString()}</strong> points</span>
                <span className="gg-dist">{fmtDistance(result.m)} away</span>
              </div>
              <div className="gg-meter" aria-hidden="true"><span style={{ width: `${(result.pts / 5000) * 100}%` }} /></div>
              {photo && (
                <p className="small">
                  {[photo.city, photo.country].filter(Boolean).join(', ') || 'Unknown place'}
                  {t && <span className="muted"> · {fmtDate(t, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}, {fmtTime(t)}</span>}
                </p>
              )}
              <p className="muted xsmall tabular">Your guess {guess && coords(guess)} · actual {coords(result.actual)}</p>
              <div className="row" style={{ gap: '0.5rem' }}>
                {photo && <Link className="btn ghost sm" to={`/photos?photo=${photo.id}`}>Open in Photos</Link>}
                <span className="grow" />
                <button className="btn primary" onClick={next} autoFocus>Next round<kbd>Enter</kbd></button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- location entry
// Map focus spots and one-click presets. The defaults are personal coordinates, so they come from the
// server's settings (GET /photos/locate/presets), never from this bundle; your own edits stay in this
// browser, per user.
type Preset = { label: string; lat: number; lng: number }
type Spots = { presets: Preset[]; focus: (Preset & { zoom: number })[] }
const NO_SPOTS: Spots = { presets: [], focus: [] }
const PRESETS_KEY = 'app.photos.locate.presets'
const HEAT_KEY = 'app.photos.locate.heat'
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/** Your saved presets, or null to use the server's defaults. */
function readPresets(key: string | null): Preset[] | null {
  if (!key) return null
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? '') as Preset[]
    if (Array.isArray(v)) return v.filter((p) => typeof p.label === 'string' && Number.isFinite(p.lat) && Number.isFinite(p.lng)).slice(0, 30)
  } catch { /* defaults */ }
  return null
}

interface Nominatim { lat: string; lon: string; display_name?: string; name?: string; boundingbox?: string[] }
type Hit = { lat: number; lng: number; name: string; address: string; bbox?: [number, number, number, number] }

export function LocatePage() {
  const [params, setParams] = useSearchParams()
  const qc = useQueryClient()
  const year = params.get('year') ?? ''
  const month = params.get('month') ?? ''
  const zero = params.get('zero') === '1'
  const only = params.get('photo')
  const setParam = (k: string, v: string | null) => {
    const p = new URLSearchParams(params)
    if (v) p.set(k, v)
    else p.delete(k)
    if (k !== 'photo') p.delete('photo')
    setParams(p, { replace: true })
  }
  const [n, setN] = useState(0)
  const skipped = useRef(new Set<string>())
  const [pin, setPin] = useState<LatLng | null>(null)
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState(0)

  // One photo: ?photo=<id> (from the viewer's "Add location"), else the next one without a location.
  const q = useQuery({
    queryKey: ['photos', 'locate', only ?? '', year, month, zero, n],
    queryFn: async ({ signal }) => {
      if (only) return { photo: await get<Photo>(`photos/${only}`, undefined, signal), onlySkipped: false }
      // The server leaves out the photos skipped here (its cap is 200; beyond that, the most recent ones).
      const base = { year: year || undefined, month: month || undefined, zero: zero || undefined }
      const exclude = [...skipped.current].slice(-200)
      try {
        return { photo: await get<Photo>('photos/locate/next', { ...base, exclude }, signal), onlySkipped: false }
      } catch (e) {
        // Everything left was skipped: start over with them rather than saying "all done".
        if (!(e instanceof ApiError && e.status === 404) || !exclude.length) throw e
        skipped.current.clear()
        return { photo: await get<Photo>('photos/locate/next', base, signal), onlySkipped: true }
      }
    },
    staleTime: Infinity, gcTime: 0, refetchOnWindowFocus: false, refetchOnReconnect: false,
  })
  const photo = q.data?.photo
  const none = q.isError && q.error instanceof ApiError && q.error.status === 404 && !only

  const el = useRef<HTMLDivElement>(null)
  const map = useMap(el, (p) => setPin(p))
  const pinLayer = useRef<L.CircleMarker | null>(null)
  useEffect(() => {
    const m = map.current
    pinLayer.current?.remove()
    pinLayer.current = m && pin ? L.circleMarker([pin.lat, pin.lng], pinStyle('#dc2626')).addTo(m) : null
  }, [pin, map])
  // A photo that already has a location (opened by id): start from it.
  useEffect(() => {
    if (photo && photo.lat != null && photo.lon != null && photo.lat !== 0 && photo.lon !== 0) {
      setPin({ lat: photo.lat, lng: photo.lon })
      map.current?.setView([photo.lat, photo.lon], Math.max(map.current.getZoom(), 14))
    }
  }, [photo, map])

  // Heat map of where your photos already are, for context (the same cached world query as Photos › Map).
  const [heat, setHeatState] = useState(() => { try { return localStorage.getItem(HEAT_KEY) === '1' } catch { return false } })
  const setHeat = (v: boolean) => {
    setHeatState(v)
    try { localStorage.setItem(HEAT_KEY, v ? '1' : '0') } catch { /* ignore */ }
  }
  const points = useQuery({
    queryKey: ['photos', 'points', WORLD, '', false],
    queryFn: ({ signal }) => get<HeatPoint[]>('photos/points', WORLD, signal),
    select: realPoints,
    enabled: heat, staleTime: 30 * 60_000,
  })
  const heatLayer = useRef<HeatLayer | null>(null)
  useEffect(() => {
    const m = map.current
    if (!m) return
    if (heatLayer.current && !m.hasLayer(heatLayer.current.leaflet)) heatLayer.current = null // map was recreated
    if (heat && points.data) {
      if (!heatLayer.current) heatLayer.current = new HeatLayer(points.data).addTo(m) as HeatLayer
      else heatLayer.current.setPoints(points.data)
    } else if (heatLayer.current) {
      heatLayer.current.remove()
      heatLayer.current = null
    }
  }, [heat, points.data, map])

  const advance = () => {
    setPin(null)
    if (only) setParam('photo', null)
    setN((x) => x + 1)
  }
  const save = async (at: LatLng | null = pin) => {
    if (!photo || !at || saving) return
    setPin(at)
    setSaving(true)
    try {
      const p = await post<Photo>(`photos/${photo.id}/location`, { lat: at.lat, lng: at.lng })
      setDone((x) => x + 1)
      toast.show(`Saved${p.city ? `: ${[p.city, p.country].filter(Boolean).join(', ')}` : ''}`)
      qc.invalidateQueries({ queryKey: ['photos', 'points'] })
      qc.invalidateQueries({ queryKey: ['photos', 'details', photo.id] })
      qc.invalidateQueries({ queryKey: ['photos', 'photo', photo.id] })
      advance()
    } catch (e) {
      toast.error(e instanceof ApiError && e.status === 404 ? 'You can only set locations in libraries you own or edit.' : "Couldn't save the location. Try again.")
    } finally {
      setSaving(false)
    }
  }
  const skip = () => {
    if (photo) skipped.current.add(photo.id)
    advance()
  }
  // The classic tool's Clear: remove a wrong location (photo opened by id from the viewer).
  const clear = async () => {
    if (!photo || saving) return
    setSaving(true)
    try {
      await post<Photo>(`photos/${photo.id}/location`, { lat: null, lng: null })
      toast.show('Location cleared')
      qc.invalidateQueries({ queryKey: ['photos', 'points'] })
      qc.invalidateQueries({ queryKey: ['photos', 'details', photo.id] })
      qc.invalidateQueries({ queryKey: ['photos', 'photo', photo.id] })
      setPin(null)
      q.refetch()
    } catch (e) {
      toast.error(e instanceof ApiError && e.status === 404 ? 'You can only change locations in libraries you own or edit.' : "Couldn't clear the location. Try again.")
    } finally {
      setSaving(false)
    }
  }
  const hasLocation = !!photo && photo.lat != null && photo.lon != null
  useHotkey((e) => e.key === 'Enter' && !skipKey(e), (e) => (e.preventDefault(), save()))
  useHotkey((e) => (e.key === 's' || e.key === 'S') && !skipKey(e), (e) => (e.preventDefault(), skip()))

  const spots = useQuery({ queryKey: ['photos', 'locate', 'presets'], queryFn: () => get<Spots>('photos/locate/presets'), staleTime: 60 * 60_000 }).data ?? NO_SPOTS
  const meId = useMe().data?.id
  const presetsKey = useMemo(() => userKey(PRESETS_KEY, meId), [meId])
  const [saved, setSaved] = useState(() => readPresets(presetsKey))
  useEffect(() => setSaved(readPresets(presetsKey)), [presetsKey])
  const presets = saved ?? spots.presets
  const setPresets = (v: Preset[] | null) => {
    setSaved(v)
    if (!presetsKey) return
    try {
      if (v) localStorage.setItem(presetsKey, JSON.stringify(v))
      else localStorage.removeItem(presetsKey)
    } catch { /* ignore */ }
  }
  const [naming, setNaming] = useState<string | null>(null)
  const years = useQuery(photoSummaryQuery<{ per_year: { year: number; count: number }[] }>()).data?.per_year ?? []
  const t = photo && when(photo)

  return (
    <div className="gg-page">
      <header className="gg-head">
        <div className="grow">
          <h1>Add missing locations</h1>
          <p className="muted small">Click the map where the photo was taken, then Save. Presets save in one click.</p>
        </div>
        <div className="gg-filters" role="group" aria-label="Which photos">
          <select className="select sm-select" value={year} onChange={(e) => setParam('year', e.target.value || null)} aria-label="Year">
            <option value="">Any year</option>
            {years.map((y) => <option key={y.year} value={y.year}>{y.year}</option>)}
          </select>
          <select className="select sm-select" value={month} onChange={(e) => setParam('month', e.target.value || null)} aria-label="Month">
            <option value="">Any month</option>
            {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </select>
          <label className="row xsmall" style={{ gap: '0.375rem' }} title="Photos with a coordinate of exactly 0 (a broken GPS fix: 0,0, or e.g. the right latitude with longitude 0), newest first">
            <input type="checkbox" checked={zero} onChange={(e) => setParam('zero', e.target.checked ? '1' : null)} />Only broken GPS (0 coordinate)
          </label>
        </div>
      </header>
      <div className="gg-panels">
        <div className="gg-photo">
          {none ? <p className="gg-msg">{zero ? 'No photos have broken GPS.' : 'All photos have a location.'}{done > 0 && ` You placed ${done} this session.`}</p>
            : q.isError ? <p className="gg-msg">{only && q.error instanceof ApiError && q.error.status === 404 ? "This photo isn't available." : "Couldn't load the next photo."}</p>
            : photo ? <Shot key={photo.id} photo={photo} /> : <span className="spinner gg-spin" aria-label="Loading" />}
          {photo && (
            <div className="gg-caption">
              <span className="grow truncate">{t ? `${fmtDate(t, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}, ${fmtTime(t)}` : 'No date'}{photo.camera ? ` · ${photo.camera}` : ''}</span>
              {q.data?.onlySkipped && <span className="chip">Only skipped photos were left: showing them again</span>}
              <Link to={`/photos?photo=${photo.id}`} className="btn ghost sm">Open</Link>
            </div>
          )}
        </div>
        <div className="gg-mapwrap">
          <div ref={el} className="gg-map" role="region" aria-label="Map: click to place the photo" />
          <MapSearch onPick={(h) => {
            const m = map.current
            if (h.bbox) m?.fitBounds([[h.bbox[0], h.bbox[2]], [h.bbox[1], h.bbox[3]]], { maxZoom: 17 })
            else m?.setView([h.lat, h.lng], 16)
            setPin({ lat: h.lat, lng: h.lng })
          }} />
          <div className="gg-tools">
            <div className="gg-tool-row" role="group" aria-label="Map focus">
              <span className="xsmall muted">{spots.focus.length ? 'Focus' : 'Map'}</span>
              {spots.focus.map((f) => <button key={f.label} className="btn sm" onClick={() => map.current?.setView([f.lat, f.lng], f.zoom)} title={`Zoom the map to ${f.label}`}>{f.label}</button>)}
              <button className={'btn sm' + (heat ? ' on' : '')} aria-pressed={heat} onClick={() => setHeat(!heat)} title="Where your photos already are">
                <Icon name="layers" size={14} />{heat && points.isFetching ? 'Loading…' : heat ? 'Hide heatmap' : 'Heatmap'}
              </button>
            </div>
            <div className="gg-tool-row" role="group" aria-label="Presets: save at this spot">
              <span className="xsmall muted">Presets</span>
              {presets.map((p, i) => (
                <span key={p.label + i} className="gg-preset">
                  <button className="btn sm" onClick={() => save({ lat: p.lat, lng: p.lng })} disabled={!photo || saving} title={`Save at ${p.label} (${coords(p)})`}>{p.label}</button>
                  <button className="gg-preset-x" onClick={() => setPresets(presets.filter((_, j) => j !== i))} aria-label={`Remove preset ${p.label}`} title="Remove preset"><Icon name="x" size={10} /></button>
                </span>
              ))}
              {naming === null ? (
                <button className="btn ghost sm" onClick={() => setNaming('')} disabled={!pin} title={pin ? 'Save the pin as a preset' : 'Drop a pin first'}><Icon name="plus" size={12} />Pin</button>
              ) : (
                <form className="row" style={{ gap: '0.25rem' }} onSubmit={(e) => {
                  e.preventDefault()
                  const label = naming.trim().slice(0, 12)
                  if (label && pin) setPresets([...presets, { label, ...pin }])
                  setNaming(null)
                }}>
                  <input className="input sm-input" value={naming} onChange={(e) => setNaming(e.target.value)} placeholder="Name" aria-label="Preset name" maxLength={12} autoFocus onKeyDown={(e) => e.key === 'Escape' && setNaming(null)} />
                  <button className="btn sm">Add</button>
                </form>
              )}
              {saved !== null && naming === null && (
                <button className="btn ghost sm" onClick={() => setPresets(null)} title="Back to the default presets">Reset</button>
              )}
            </div>
            <div className="gg-bar">
              <span className="muted small grow tabular">{pin ? coords(pin) : 'Click the map to drop a pin'}</span>
              {hasLocation && <button className="btn ghost" onClick={clear} disabled={saving} title="Remove this photo's location">Clear</button>}
              <button className="btn" onClick={skip} disabled={!photo && !q.isError}>Skip<kbd>S</kbd></button>
              <button className="btn primary" onClick={() => save()} disabled={!pin || !photo || saving}>{saving ? 'Saving…' : 'Save'}<kbd>Enter</kbd></button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

let searchOff = false
/** Place search over the map (GET /places/geocode, debounced); 503 = offline mode. */
function MapSearch({ onPick }: { onPick: (h: Hit) => void }) {
  const [text, setText] = useState('')
  const [open, setOpen] = useState(false)
  const [off, setOff] = useState(searchOff)
  const q = useDebounced(text.trim(), 450)
  const geo = useQuery({
    queryKey: ['places', 'geocode', 'photos', q],
    queryFn: async ({ signal }) => {
      try {
        const r = await get<Nominatim[]>('places/geocode', { q }, signal)
        return (Array.isArray(r) ? r : []).slice(0, 6).flatMap((x): Hit[] => {
          const lat = parseFloat(x.lat), lng = parseFloat(x.lon)
          if (!Number.isFinite(lat) || !Number.isFinite(lng)) return []
          const address = String(x.display_name ?? '')
          const bb = (x.boundingbox ?? []).map(Number)
          return [{ lat, lng, name: String(x.name || address.split(',')[0] || 'Result'), address, bbox: bb.length === 4 && bb.every(Number.isFinite) ? (bb as [number, number, number, number]) : undefined }]
        })
      } catch (e) {
        if (e instanceof ApiError && e.status === 503) {
          searchOff = true
          setOff(true)
          return []
        }
        throw e
      }
    },
    enabled: !off && q.length >= 3,
    staleTime: 60 * 60_000,
    retry: false,
  })
  const hits = useMemo(() => geo.data ?? [], [geo.data])
  const show = open && text.trim().length >= 3
  return (
    <div className="gg-search" onBlur={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setOpen(false)}>
      <form className="ph-search" role="search" onSubmit={(e) => (e.preventDefault(), hits[0] && (onPick(hits[0]), setOpen(false)))}>
        <Icon name="search" />
        <input value={text} onChange={(e) => (setText(e.target.value), setOpen(true))} onFocus={() => setOpen(true)} onKeyDown={(e) => e.key === 'Escape' && (setOpen(false), e.currentTarget.blur())}
          placeholder="Search for a place" aria-label="Search for a place on the map" maxLength={200} />
      </form>
      {show && (
        <ul className="gg-hits" role="listbox" aria-label="Places">
          {off ? <li className="muted small">Search is off (the server is in offline mode).</li>
            : q !== text.trim() || geo.isFetching ? <li className="muted small">Searching…</li>
            : geo.isError ? <li className="muted small">Search failed.</li>
            : !hits.length ? <li className="muted small">No places found.</li>
            : hits.map((h, i) => (
              <li key={i}>
                <button onClick={() => (onPick(h), setOpen(false))}>
                  <strong className="truncate">{h.name}</strong>
                  <span className="muted xsmall truncate">{h.address}</span>
                </button>
              </li>
            ))}
        </ul>
      )}
    </div>
  )
}
