// Photos › Tools › Geoguessr: guess where a random geotagged photo was taken by clicking the map; the score
// falls off with distance (5000 for a perfect guess). Running totals are kept on this device.
import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { Button, buttonClass, useHotkey } from '../../components/ui'
import { ApiError, get } from '../../lib/api'
import { cn } from '../../lib/cn'
import { fmtDate, fmtTime } from '../../lib/dates'
import { distanceM, fmtCoords, fmtDistance, type LatLng } from '../../lib/map/geo'
import L from '../../lib/map/leaflet'
import { useLeafletMap } from '../../lib/map/useLeafletMap'
import { usePref } from '../../lib/storage'
import type { Photo } from '../../lib/types'
import { closeness, score } from './game'
import { PhotoShot, pinStyle, skipKey, takenAt, tool } from './ToolLayout'
import { placeText } from '../../lib/format'

const START: [number, number] = [43.57, -79.98] // starting view (southern Ontario)
type Stats = { rounds: number; total: number; best: number }
const ZERO: Stats = { rounds: 0, total: 0, best: 0 }
const validStats = (s: Partial<Stats>): s is Stats =>
  typeof s.rounds === 'number' && typeof s.total === 'number' && typeof s.best === 'number'
const coords = (p: LatLng) => fmtCoords(p.lat, p.lng)

export function GeoguessrPage() {
  const el = useRef<HTMLElement>(null)
  const layers = useRef<L.LayerGroup | null>(null)
  const viewBefore = useRef<{ c: L.LatLng; z: number } | null>(null)
  const [round, setRound] = useState(0)
  const [guess, setGuess] = useState<LatLng | null>(null)
  const [result, setResult] = useState<{ m: number; pts: number; actual: LatLng } | null>(null)
  const [stored, setStats] = usePref<Stats>('app.photos.geoguessr', ZERO)
  const stats = validStats(stored) ? stored : ZERO
  const q = useQuery({
    queryKey: ['photos', 'game', round],
    queryFn: ({ signal }) => get<Photo>('photos/game/round', undefined, signal),
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })
  const photo = q.data
  const placing = useRef({ result, photo })
  placing.current = { result, photo }
  const map = useLeafletMap(el, {
    center: START,
    zoom: 10,
    onClick: (p) => {
      if (placing.current.result || !placing.current.photo) return
      setGuess(p)
    },
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
      const line = L.polyline(
        [
          [guess.lat, guess.lng],
          [result.actual.lat, result.actual.lng],
        ],
        {
          color: getComputedStyle(document.documentElement).getPropertyValue('--app-danger').trim() || '#c0392b',
          weight: 3,
          dashArray: '5, 10',
          opacity: 0.8,
        },
      ).addTo(g)
      L.circleMarker([result.actual.lat, result.actual.lng], pinStyle('#16a34a')).bindTooltip('Where it was taken').addTo(g)
      m.fitBounds(line.getBounds().pad(0.15), { maxZoom: 16 })
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
  useHotkey(
    (e) => (e.key === 'Enter' || (e.key === 'n' && !!result)) && !skipKey(e),
    (e) => {
      e.preventDefault()
      if (result) next()
      else submit()
    },
  )

  const avg = stats.rounds ? Math.round(stats.total / stats.rounds) : 0
  const t = photo && takenAt(photo)
  const close = result && closeness(result.m)
  return (
    <div className={tool.page}>
      <header className={tool.head}>
        <div className="min-w-0 flex-1">
          <h1>Geoguessr</h1>
          <p className="text-sm text-muted">Look at the photo, then click the map where you think it was taken.</p>
        </div>
        <dl className="m-0 flex gap-5 max-md:gap-3.5" aria-label="This game">
          {(
            [
              ['Rounds', stats.rounds],
              ['Score', stats.total],
              ['Average', avg],
              ['Best round', stats.best],
            ] as const
          ).map(([label, v]) => (
            <div key={label} className="grid">
              <dt className="text-xs text-muted">{label}</dt>
              <dd className="m-0 font-semibold tabular-nums">{v.toLocaleString()}</dd>
            </div>
          ))}
        </dl>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setStats({ rounds: 0, total: 0, best: stats.best })}
          disabled={!stats.rounds}
          title="Start counting again (keeps your best round)"
        >
          New game
        </Button>
      </header>
      <div className={tool.panels}>
        <div className={tool.photo}>
          {photo ? (
            <PhotoShot key={photo.id} photo={photo} />
          ) : q.isError ? (
            <p className={tool.msg}>
              {q.error instanceof ApiError && q.error.status === 404
                ? 'None of your photos have a location yet.'
                : "Couldn't load a photo."}
            </p>
          ) : (
            <span className={tool.spin} role="status" aria-label="Loading" />
          )}
        </div>
        <div className={tool.mapWrap}>
          <section ref={el} className={tool.map} aria-label="Map: click to place your guess" />
          {!result ? (
            <div className={tool.bar}>
              <span className="flex-1 text-sm text-muted">
                {guess ? `Your guess: ${coords(guess)}` : 'Click the map to place your guess'}
              </span>
              <Button variant="primary" onClick={submit} disabled={!guess || !photo}>
                Guess<kbd className={tool.kbd}>Enter</kbd>
              </Button>
            </div>
          ) : (
            <div className="grid gap-1.5 border-t border-border bg-surface px-4 py-3" role="status">
              <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                <span>
                  <strong className="text-[1.75rem] tabular-nums">{result.pts.toLocaleString()}</strong> points
                </span>
                <span className={cn('font-semibold', close === 'close' && 'text-success', close === 'far' && 'text-danger')}>
                  {fmtDistance(result.m, 'precise')} away
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-[3px] bg-surface-2" aria-hidden="true">
                <span className="block h-full rounded-[inherit] bg-accent" style={{ width: `${(result.pts / 5000) * 100}%` }} />
              </div>
              {photo && (
                <p className="text-sm">
                  {placeText([photo.city, photo.country].filter(Boolean).join(', ')) || 'Unknown place'}
                  {t && (
                    <span className="text-muted">
                      {' '}
                      · {fmtDate(t, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}, {fmtTime(t)}
                    </span>
                  )}
                </p>
              )}
              <p className="text-xs text-muted tabular-nums">
                Your guess {guess && coords(guess)} · actual {coords(result.actual)}
              </p>
              <div className="flex items-center gap-2">
                {photo && (
                  <Link className={buttonClass({ variant: 'ghost', size: 'sm' })} to={`/photos?photo=${photo.id}`}>
                    Open in Photos
                  </Link>
                )}
                <span className="flex-1" />
                <Button variant="primary" onClick={next} autoFocus>
                  Next round<kbd className={tool.kbd}>Enter</kbd>
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
