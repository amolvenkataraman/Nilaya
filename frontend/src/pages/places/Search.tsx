// Top search of Places: filters your places (the list below) and, from 3 characters, also searches
// the map (GET /places/geocode?q=, OpenStreetMap Nominatim through the server; debounced 450 ms).
// 503 = the server is in offline mode: "Map search is off", and no more requests this session.
import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Icon } from '../../components/Icon'
import { useDebounced } from '../../components/ui'
import { ApiError, get } from '../../lib/api'
import { usePlaceSearch, type Group, type Pin } from './api'

export interface GeoHit { lat: number; lon: number; name: string; address: string; bbox?: [number, number, number, number] }
interface Nominatim { lat: string; lon: string; display_name?: string; name?: string; boundingbox?: string[] }

let mapSearchOff = false

export function PlaceSearch({ text, onText, places, groups, onPlace, onHit, onShowGroup }: {
  text: string; onText: (t: string) => void; places: Pin[]; groups: Group[]
  onPlace: (p: Pin) => void; onHit: (h: GeoHit) => void; onShowGroup: (g: Group) => void
}) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const box = useRef<HTMLFormElement>(null)
  const q = useDebounced(text.trim(), 450)
  const [off, setOff] = useState(mapSearchOff)
  const geo = useQuery({
    queryKey: ['places', 'geocode', q],
    queryFn: async ({ signal }) => {
      try {
        const r = await get<Nominatim[]>('places/geocode', { q }, signal)
        return (Array.isArray(r) ? r : []).slice(0, 6).flatMap((x): GeoHit[] => {
          const lat = parseFloat(x.lat)
          const lon = parseFloat(x.lon)
          if (!Number.isFinite(lat) || !Number.isFinite(lon)) return []
          const address = String(x.display_name ?? '')
          const bb = (x.boundingbox ?? []).map(Number)
          return [{ lat, lon, name: String(x.name || address.split(',')[0] || 'Result'), address, bbox: bb.length === 4 && bb.every(Number.isFinite) ? (bb as [number, number, number, number]) : undefined }]
        })
      } catch (e) {
        if (e instanceof ApiError && e.status === 503) {
          mapSearchOff = true
          setOff(true)
          return []
        }
        throw e
      }
    },
    enabled: open && !off && q.length >= 3,
    staleTime: 60 * 60_000,
    retry: false,
  })
  const needle = text.trim().toLowerCase()
  // Places on the map match instantly; the server also searches groups that are turned off (not archived).
  const dq = useDebounced(needle, 250)
  const all = usePlaceSearch(open ? dq : '')
  const groupOf = (id: number) => groups.find((g) => g.id === id)
  const shown = needle ? places.filter((p) => p.name.toLowerCase().includes(needle) || (p.address ?? '').toLowerCase().includes(needle)).slice(0, 5) : []
  const more = needle ? (all.data ?? []).filter((p) => !shown.some((x) => x.id === p.id) && !places.some((x) => x.id === p.id)).slice(0, 6) : []
  const local = [...shown, ...more]
  const hits = geo.data ?? []
  const items: ({ kind: 'place'; p: Pin } | { kind: 'hit'; h: GeoHit })[] = [...local.map((p) => ({ kind: 'place' as const, p })), ...hits.map((h) => ({ kind: 'hit' as const, h }))]
  useEffect(() => setActive(-1), [needle, hits.length])
  useEffect(() => {
    if (!open) return
    const down = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false)
    document.addEventListener('pointerdown', down, true)
    return () => document.removeEventListener('pointerdown', down, true)
  }, [open])
  const pick = (i: number) => {
    const it = items[i]
    if (!it) return
    setOpen(false)
    if (it.kind === 'place') onPlace(it.p)
    else (onText(''), onHit(it.h))
  }
  const show = open && !!needle
  const waiting = !off && needle.length >= 3 && (q !== text.trim() || geo.isFetching)
  return (
    <form ref={box} className="pl-search" role="search" onSubmit={(e) => (e.preventDefault(), items.length && pick(Math.max(active, 0)))}>
      <Icon name="search" />
      <input value={text} onChange={(e) => (onText(e.target.value), setOpen(true))} onFocus={() => setOpen(true)} placeholder="Search your places and the map" aria-label="Search places and the map" maxLength={200}
        role="combobox" aria-expanded={show} aria-controls="pl-search-results" aria-autocomplete="list"
        onKeyDown={(e) => {
          if (e.key === 'Escape') { if (show) (e.stopPropagation(), setOpen(false)) }
          else if (e.key === 'ArrowDown') (e.preventDefault(), setOpen(true), setActive((a) => Math.min(a + 1, items.length - 1)))
          else if (e.key === 'ArrowUp') (e.preventDefault(), setActive((a) => Math.max(a - 1, 0)))
        }} />
      {text && <button type="button" className="btn ghost icon sm" onClick={() => onText('')} aria-label="Clear search"><Icon name="x" size={14} /></button>}
      {show && (
        <div className="pl-search-results" id="pl-search-results" role="listbox" aria-label="Search results">
          {local.length > 0 && <div className="pl-sr-head">Your places</div>}
          {local.map((p, i) => {
            const g = groupOf(p.group_id)
            const off = !!g && !g.visible
            return (
              <div key={p.id} className="pl-sr-row">
                <button type="button" role="option" aria-selected={active === i} className={active === i ? 'on' : ''} onMouseMove={() => setActive(i)} onClick={() => pick(i)}>
                  <span className={'pl-status-dot st-' + (p.status ?? 'saved')} aria-hidden="true" />
                  <span className="grow truncate">{p.name}<span className="muted xsmall"> · {g?.name ?? ''}{off ? ' (hidden)' : ''}{p.address ? ` · ${p.address}` : ''}</span></span>
                </button>
                {off && g && <button type="button" className="btn ghost sm pl-sr-show" onClick={() => onShowGroup(g)} title={`Turn on ${g.name}`}>Show group</button>}
              </div>
            )
          })}
          {hits.length > 0 && <div className="pl-sr-head">On the map</div>}
          {hits.map((h, j) => {
            const i = local.length + j
            return (
              <button type="button" role="option" key={h.address + j} aria-selected={active === i} className={active === i ? 'on' : ''} onMouseMove={() => setActive(i)} onClick={() => pick(i)}>
                <Icon name="pin" size={13} />
                <span className="grow" style={{ minWidth: 0 }}><span className="truncate" style={{ display: 'block' }}>{h.name}</span><span className="muted xsmall truncate" style={{ display: 'block' }}>{h.address}</span></span>
              </button>
            )
          })}
          {off ? <div className="pl-sr-note"><Icon name="info" size={13} />Map search is off on this server (offline mode).</div>
            : needle.length < 3 ? (!local.length && <div className="pl-sr-note">Type 3 letters to search the map.</div>)
            : waiting ? <div className="pl-sr-note"><span className="spinner" />Searching the map…</div>
            : geo.error ? <div className="pl-sr-note error-text">{(geo.error as Error).message}</div>
            : !hits.length && !local.length ? <div className="pl-sr-note">No results.</div> : null}
        </div>
      )}
    </form>
  )
}
