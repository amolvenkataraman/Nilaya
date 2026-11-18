// Photos › Tools › Add missing locations: one photo without a location at a time (or ?photo=<id> from the
// viewer); click the map or search for a place, then Save, or Skip. Presets save in one click: the defaults are
// personal coordinates, so they come from the server (GET /photos/locate/presets), never from this bundle, and
// your own edits stay in this browser, per user. A heat layer shows where your photos already are.
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router'
import { Icon } from '../../components/Icon'
import { toast } from '../../components/toast'
import { Button, buttonClass, chipClass, fieldClass, useHotkey } from '../../components/ui'
import { ApiError, get, post } from '../../lib/api'
import { cn } from '../../lib/cn'
import { fmtDate, fmtTime } from '../../lib/dates'
import { fmtCoords, type LatLng, WORLD } from '../../lib/map/geo'
import { useHeatLayer } from '../../lib/map/heat'
import L from '../../lib/map/leaflet'
import { photoPointsQuery } from '../../lib/map/points'
import { useLeafletMap } from '../../lib/map/useLeafletMap'
import { userKey } from '../../lib/owner'
import { photoSummaryQuery } from '../../lib/photoQueries'
import { useMe } from '../../lib/queries'
import { readPref, usePref, writePref } from '../../lib/storage'
import type { Photo } from '../../lib/types'
import { MapSearch } from './MapSearch'
import { smallSelectClass } from './StatCards'
import { PhotoShot, pinStyle, skipKey, takenAt, tool } from './ToolLayout'
import { useParamSetter } from './useParamSetter'

type Preset = { label: string; lat: number; lng: number }
type Spots = { presets: Preset[]; focus: (Preset & { zoom: number })[] }
const NO_SPOTS: Spots = { presets: [], focus: [] }
const PRESETS_KEY = 'app.photos.locate.presets'
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const START: [number, number] = [43.57, -79.98] // starting view (southern Ontario)
const coords = (p: LatLng) => fmtCoords(p.lat, p.lng)

/** Your saved presets, or null to use the server's defaults. */
function readPresets(key: string | null): Preset[] | null {
  if (!key) return null
  // Nothing stored (or not a list) reads as the empty object: use the defaults.
  const v = readPref<readonly unknown[] | Record<string, unknown>>(key, {})
  if (!Array.isArray(v)) return null
  return (v as Preset[]).filter((p) => typeof p?.label === 'string' && Number.isFinite(p.lat) && Number.isFinite(p.lng)).slice(0, 30)
}

const toolRow = 'flex flex-wrap items-center gap-1.5 px-3 pt-2'
const rowLabel = 'w-13 text-xs text-muted max-md:w-full'
const on = 'border-accent! bg-accent-soft! text-accent!'

export function LocatePage() {
  const [params, setParam] = useParamSetter()
  const qc = useQueryClient()
  const year = params.get('year') ?? ''
  const month = params.get('month') ?? ''
  const zero = params.get('zero') === '1'
  const only = params.get('photo')
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
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })
  const photo = q.data?.photo
  const none = q.isError && q.error instanceof ApiError && q.error.status === 404 && !only

  const el = useRef<HTMLElement>(null)
  const map = useLeafletMap(el, { center: START, zoom: 10, onClick: (p) => setPin(p) })
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
  const [heat, setHeat] = usePref<boolean>('app.photos.locate.heat', false)
  const points = useQuery({ ...photoPointsQuery(WORLD), enabled: heat })
  useHeatLayer(map, heat ? points.data : null)

  const advance = () => {
    setPin(null)
    if (only) setParam('photo', null)
    setN((x) => x + 1)
  }
  const refreshPhoto = (id: string) => {
    qc.invalidateQueries({ queryKey: ['photos', 'points'] })
    qc.invalidateQueries({ queryKey: ['photos', 'details', id] })
    qc.invalidateQueries({ queryKey: ['photos', 'photo', id] })
  }
  const save = async (at: LatLng | null = pin) => {
    if (!photo || !at || saving) return
    setPin(at)
    setSaving(true)
    try {
      const p = await post<Photo>(`photos/${photo.id}/location`, { lat: at.lat, lng: at.lng })
      setDone((x) => x + 1)
      toast.show(`Saved${p.city ? `: ${[p.city, p.country].filter(Boolean).join(', ')}` : ''}`)
      refreshPhoto(photo.id)
      advance()
    } catch (e) {
      toast.error(
        e instanceof ApiError && e.status === 404
          ? 'You can only set locations in libraries you own or edit.'
          : "Couldn't save the location. Try again.",
      )
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
      refreshPhoto(photo.id)
      setPin(null)
      q.refetch()
    } catch (e) {
      toast.error(
        e instanceof ApiError && e.status === 404
          ? 'You can only change locations in libraries you own or edit.'
          : "Couldn't clear the location. Try again.",
      )
    } finally {
      setSaving(false)
    }
  }
  const hasLocation = !!photo && photo.lat != null && photo.lon != null
  useHotkey(
    (e) => e.key === 'Enter' && !skipKey(e),
    (e) => {
      e.preventDefault()
      save()
    },
  )
  useHotkey(
    (e) => (e.key === 's' || e.key === 'S') && !skipKey(e),
    (e) => {
      e.preventDefault()
      skip()
    },
  )

  const spots =
    useQuery({
      queryKey: ['photos', 'locate', 'presets'],
      queryFn: ({ signal }) => get<Spots>('photos/locate/presets', undefined, signal),
      staleTime: 60 * 60_000,
    }).data ?? NO_SPOTS
  const meId = useMe().data?.id
  const presetsKey = useMemo(() => userKey(PRESETS_KEY, meId), [meId])
  const [saved, setSaved] = useState(() => readPresets(presetsKey))
  useEffect(() => setSaved(readPresets(presetsKey)), [presetsKey])
  const presets = saved ?? spots.presets
  const setPresets = (v: Preset[] | null) => {
    setSaved(v)
    if (presetsKey) writePref(presetsKey, v)
  }
  const [naming, setNaming] = useState<string | null>(null)
  const years = useQuery(photoSummaryQuery<{ per_year: { year: number; count: number }[] }>()).data?.per_year ?? []
  const t = photo && takenAt(photo)

  return (
    <div className={tool.page}>
      <header className={tool.head}>
        <div className="min-w-0 flex-1">
          <h1>Add missing locations</h1>
          <p className="text-sm text-muted">Click the map where the photo was taken, then Save. Presets save in one click.</p>
        </div>
        <fieldset className="m-0 flex flex-wrap items-center gap-2 border-0 p-0" aria-label="Which photos">
          <select className={smallSelectClass} value={year} onChange={(e) => setParam('year', e.target.value || null)} aria-label="Year">
            <option value="">Any year</option>
            {years.map((y) => (
              <option key={y.year} value={y.year}>
                {y.year}
              </option>
            ))}
          </select>
          <select className={smallSelectClass} value={month} onChange={(e) => setParam('month', e.target.value || null)} aria-label="Month">
            <option value="">Any month</option>
            {MONTHS.map((m, i) => (
              <option key={m} value={i + 1}>
                {m}
              </option>
            ))}
          </select>
          <label
            className="flex items-center gap-1.5 text-xs"
            title="Photos with a coordinate of exactly 0 (a broken GPS fix: 0,0, or e.g. the right latitude with longitude 0), newest first"
          >
            <input type="checkbox" checked={zero} onChange={(e) => setParam('zero', e.target.checked ? '1' : null)} />
            Only broken GPS (0 coordinate)
          </label>
        </fieldset>
      </header>
      <div className={tool.panels}>
        <div className={tool.photo}>
          {none ? (
            <p className={tool.msg}>
              {zero ? 'No photos have broken GPS.' : 'All photos have a location.'}
              {done > 0 && ` You placed ${done} this session.`}
            </p>
          ) : q.isError ? (
            <p className={tool.msg}>
              {only && q.error instanceof ApiError && q.error.status === 404
                ? "This photo isn't available."
                : "Couldn't load the next photo."}
            </p>
          ) : photo ? (
            <PhotoShot key={photo.id} photo={photo} />
          ) : (
            <span className={tool.spin} role="status" aria-label="Loading" />
          )}
          {photo && (
            <div className="absolute inset-x-0 bottom-0 flex items-center gap-2 bg-[linear-gradient(transparent,rgba(0,0,0,0.65))] px-3 pt-6 pb-2 text-sm text-[#e8eaed]">
              <span className="min-w-0 flex-1 truncate">
                {t ? `${fmtDate(t, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}, ${fmtTime(t)}` : 'No date'}
                {photo.camera ? ` · ${photo.camera}` : ''}
              </span>
              {q.data?.onlySkipped && <span className={chipClass()}>Only skipped photos were left: showing them again</span>}
              <Link
                to={`/photos?photo=${photo.id}`}
                className={buttonClass({ variant: 'ghost', size: 'sm', className: 'text-[#e8eaed]!' })}
              >
                Open
              </Link>
            </div>
          )}
        </div>
        <div className={tool.mapWrap}>
          <section ref={el} className={tool.map} aria-label="Map: click to place the photo" />
          <MapSearch
            onPick={(h) => {
              const m = map.current
              if (h.bbox)
                m?.fitBounds(
                  [
                    [h.bbox[0], h.bbox[2]],
                    [h.bbox[1], h.bbox[3]],
                  ],
                  { maxZoom: 17 },
                )
              else m?.setView([h.lat, h.lng], 16)
              setPin({ lat: h.lat, lng: h.lng })
            }}
          />
          <div className="grid border-t border-border bg-surface">
            <fieldset className="m-0 border-0 p-0" aria-label="Map focus">
              <div className={toolRow}>
                <span className={rowLabel}>{spots.focus.length ? 'Focus' : 'Map'}</span>
                {spots.focus.map((f) => (
                  <Button
                    key={f.label}
                    size="sm"
                    onClick={() => map.current?.setView([f.lat, f.lng], f.zoom)}
                    title={`Zoom the map to ${f.label}`}
                  >
                    {f.label}
                  </Button>
                ))}
                <Button
                  size="sm"
                  className={heat ? on : undefined}
                  aria-pressed={heat}
                  onClick={() => setHeat(!heat)}
                  title="Where your photos already are"
                >
                  <Icon name="layers" size={14} />
                  {heat && points.isFetching ? 'Loading…' : heat ? 'Hide heatmap' : 'Heatmap'}
                </Button>
              </div>
            </fieldset>
            <fieldset className="m-0 border-0 p-0" aria-label="Presets: save at this spot">
              <div className={toolRow}>
                <span className={rowLabel}>Presets</span>
                {presets.map((p, i) => (
                  <span key={`${p.label}:${p.lat}:${p.lng}`} className="group/preset relative inline-flex">
                    <Button
                      size="sm"
                      onClick={() => save({ lat: p.lat, lng: p.lng })}
                      disabled={!photo || saving}
                      title={`Save at ${p.label} (${coords(p)})`}
                    >
                      {p.label}
                    </Button>
                    <button
                      type="button"
                      className="absolute -top-1.5 -right-1.5 hidden size-4 place-items-center rounded-full border border-border bg-surface p-0 text-muted group-hover/preset:grid focus-visible:grid"
                      onClick={() => setPresets(presets.filter((_, j) => j !== i))}
                      aria-label={`Remove preset ${p.label}`}
                      title="Remove preset"
                    >
                      <Icon name="x" size={10} />
                    </button>
                  </span>
                ))}
                {naming === null ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setNaming('')}
                    disabled={!pin}
                    title={pin ? 'Save the pin as a preset' : 'Drop a pin first'}
                  >
                    <Icon name="plus" size={12} />
                    Pin
                  </Button>
                ) : (
                  <form
                    className="flex items-center gap-1"
                    onSubmit={(e) => {
                      e.preventDefault()
                      const label = naming.trim().slice(0, 12)
                      if (label && pin) setPresets([...presets, { label, ...pin }])
                      setNaming(null)
                    }}
                  >
                    <input
                      className={fieldClass.input({ size: 'sm', width: 'content', className: 'w-24' })}
                      value={naming}
                      onChange={(e) => setNaming(e.target.value)}
                      placeholder="Name"
                      aria-label="Preset name"
                      maxLength={12}
                      autoFocus
                      onKeyDown={(e) => e.key === 'Escape' && setNaming(null)}
                    />
                    <Button type="submit" size="sm">
                      Add
                    </Button>
                  </form>
                )}
                {saved !== null && naming === null && (
                  <Button variant="ghost" size="sm" onClick={() => setPresets(null)} title="Back to the default presets">
                    Reset
                  </Button>
                )}
              </div>
            </fieldset>
            <div className={cn(tool.bar, 'mt-1 border-t-0!')}>
              <span className="flex-1 text-sm text-muted tabular-nums">{pin ? coords(pin) : 'Click the map to drop a pin'}</span>
              {hasLocation && (
                <Button variant="ghost" onClick={clear} disabled={saving} title="Remove this photo's location">
                  Clear
                </Button>
              )}
              <Button onClick={skip} disabled={!photo && !q.isError}>
                Skip<kbd className={tool.kbd}>S</kbd>
              </Button>
              <Button variant="primary" onClick={() => save()} disabled={!pin || !photo || saving}>
                {saving ? 'Saving…' : 'Save'}
                <kbd className={tool.kbd}>Enter</kbd>
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
