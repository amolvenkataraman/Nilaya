// Photos filters drawer (like the classic Filters panel) and the timeline's month scrubber.
import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { Icon } from '../../components/Icon'
import { Drawer, Switch } from '../../components/ui'
import { get } from '../../lib/api'
import { fmtDate } from '../../lib/dates'

type Item = { display: string; value: string; count: number; country?: string }
const browse = (cat: string, enabled: boolean) => ({
  queryKey: ['photos', 'browse', cat],
  queryFn: () => get<Item[]>(`photos/browse/${cat}`),
  staleTime: 60 * 60_000,
  enabled,
})
const KEYS = ['kind', 'from', 'date', 'camera', 'camera_make', 'country', 'city', 'objects', 'min_blur', 'max_blur', 'order',
  'north', 'south', 'east', 'west'] as const
/** The map area counts as one filter (four URL params). */
const BOUNDS = ['north', 'south', 'east', 'west'] as const
const filterCount = (params: URLSearchParams) =>
  KEYS.filter((k) => !(BOUNDS as readonly string[]).includes(k) && params.get(k)).length + (BOUNDS.every((k) => params.get(k)) ? 1 : 0)
/** Blur score presets (higher is sharper; the viewer shows the same score). */
const SHARPNESS: [string, string, string][] = [['Blurry', '', '50'], ['Soft', '50', '150'], ['Sharp', '150', '']]

export function FiltersButton() {
  const [params] = useSearchParams()
  const [open, setOpen] = useState(false)
  const n = filterCount(params)
  return (
    <>
      <button className={'btn sm' + (n ? ' ph-filter-on' : '')} onClick={() => setOpen(true)} title="Filters"><Icon name="filter" size={14} /><span>Filters{n ? ` · ${n}` : ''}</span></button>
      {open && <FiltersDrawer onClose={() => setOpen(false)} />}
    </>
  )
}

function FiltersDrawer({ onClose }: { onClose: () => void }) {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const [f, setF] = useState(() => Object.fromEntries(KEYS.map((k) => [k, params.get(k) ?? ''])) as Record<(typeof KEYS)[number], string>)
  const cameras = useQuery(browse('cameras', true)).data ?? []
  const countries = useQuery(browse('countries', true)).data ?? []
  const cities = useQuery(browse('cities', true)).data ?? []
  const objects = useQuery(browse('objects', true)).data ?? []
  const cityList = useMemo(() => (f.country ? cities.filter((c) => c.country === f.country) : cities), [cities, f.country])
  const picked = f.objects ? f.objects.split(',') : []
  const set = (k: (typeof KEYS)[number], v: string) => setF((x) => ({ ...x, [k]: v }))
  const area = BOUNDS.every((k) => f[k])
  const num = (v: string) => v.replace(/[^\d.]/g, '').slice(0, 8)
  const apply = () => {
    const p = new URLSearchParams()
    for (const k of KEYS) if (f[k]) p.set(k, f[k])
    navigate('/photos' + (p.toString() ? '?' + p : ''))
    onClose()
  }
  return (
    <Drawer open onClose={onClose} label="Photo filters">
      <div className="drawer-head"><strong className="grow">Filters</strong><button className="btn ghost icon sm" onClick={onClose} aria-label="Close"><Icon name="x" /></button></div>
      <div className="drawer-body ph-filters">
        <Switch checked={f.kind === 'videos'} onChange={(v) => set('kind', v ? 'videos' : '')} label="Videos only" />
        <div className="field-row">
          <label className="field"><span>Taken on or after</span><input className="input" type="date" value={f.from} max={f.date || undefined} onChange={(e) => set('from', e.target.value)} /></label>
          <label className="field"><span>Taken on or before</span><input className="input" type="date" value={f.date} min={f.from || undefined} onChange={(e) => set('date', e.target.value)} /></label>
        </div>
        <Switch checked={f.order === 'oldest'} onChange={(v) => set('order', v ? 'oldest' : '')} label="Oldest first" />
        <div className="field-row">
          <label className="field"><span>Camera</span>
            <select className="select" value={f.camera} onChange={(e) => set('camera', e.target.value)}>
              <option value="">Any camera</option>
              {cameras.map((c) => <option key={c.value} value={c.value}>{c.display} · {c.count}</option>)}
            </select>
          </label>
          <label className="field"><span>Make contains</span>
            <input className="input" value={f.camera_make} maxLength={64} placeholder="e.g. Canon" onChange={(e) => set('camera_make', e.target.value)} />
          </label>
        </div>
        <div className="field-row">
          <label className="field"><span>Country</span>
            <select className="select" value={f.country} onChange={(e) => setF((x) => ({ ...x, country: e.target.value, city: '' }))}>
              <option value="">Any country</option>
              {countries.map((c) => <option key={c.value} value={c.value}>{c.display} · {c.count}</option>)}
            </select>
          </label>
          <label className="field"><span>City</span>
            <select className="select" value={f.city} onChange={(e) => set('city', e.target.value)}>
              <option value="">Any city</option>
              {cityList.map((c) => <option key={c.value + c.country} value={c.value}>{c.value} · {c.count}</option>)}
            </select>
          </label>
        </div>
        <div className="field">
          <span>Objects</span>
          {objects.length === 0 ? <span className="muted xsmall">No objects detected in your library yet.</span> : (
            <div className="ph-obj">
              {objects.map((o) => {
                const on = picked.includes(o.value)
                return <button key={o.value} className={'chip' + (on ? ' accent' : '')} aria-pressed={on} onClick={() => set('objects', (on ? picked.filter((x) => x !== o.value) : [...picked, o.value]).join(','))}>{o.display} <span className="muted">{o.count}</span></button>
              })}
            </div>
          )}
        </div>
        <div className="field">
          <span>Sharpness <span className="muted">(blur score: higher is sharper; photos only)</span></span>
          <div className="ph-obj">
            {SHARPNESS.map(([label, lo, hi]) => {
              const on = f.min_blur === lo && f.max_blur === hi
              return <button key={label} className={'chip' + (on ? ' accent' : '')} aria-pressed={on}
                onClick={() => setF((x) => ({ ...x, min_blur: on ? '' : lo, max_blur: on ? '' : hi }))}>
                {label} <span className="muted">{lo && hi ? `${lo}–${hi}` : lo ? `over ${lo}` : `under ${hi}`}</span></button>
            })}
          </div>
          <div className="field-row">
            <label className="field"><span>From</span><input className="input" inputMode="decimal" value={f.min_blur} placeholder="0" onChange={(e) => set('min_blur', num(e.target.value))} /></label>
            <label className="field"><span>To</span><input className="input" inputMode="decimal" value={f.max_blur} placeholder="Any" onChange={(e) => set('max_blur', num(e.target.value))} /></label>
          </div>
        </div>
        {area && (
          <div className="field">
            <span>Map area</span>
            <span className="row"><span className="chip accent"><Icon name="map" size={12} />In the area picked on the map</span>
              <button className="btn sm ghost" onClick={() => setF((x) => ({ ...x, north: '', south: '', east: '', west: '' }))}>Remove</button></span>
          </div>
        )}
        <p className="help">Free text (places, things, cameras, dates) goes in the search box at the top.</p>
        <p className="help">Libraries: switch them on or off, or pick "Only", in the sidebar.</p>
      </div>
      <div className="dialog-foot">
        <button className="btn ghost" onClick={() => setF(Object.fromEntries(KEYS.map((k) => [k, ''])) as typeof f)}>Clear all</button>
        <span className="spacer" />
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" onClick={apply}>Show photos</button>
      </div>
    </Drawer>
  )
}

/** Right-edge month rail: jump the timeline to any month of the library. */
export function Scrubber({ first, last }: { first: string | null; last: string | null }) {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  if (!first || !last) return null
  const a = new Date(first)
  const b = new Date(last)
  const months: Date[] = []
  for (let d = new Date(b.getFullYear(), b.getMonth(), 1); d >= new Date(a.getFullYear(), a.getMonth(), 1) && months.length < 240; d = new Date(d.getFullYear(), d.getMonth() - 1, 1)) months.push(d)
  if (months.length < 2) return null
  const current = params.get('date')
  const go = (d: Date) => {
    const end = new Date(d.getFullYear(), d.getMonth() + 1, 0)
    const p = new URLSearchParams(params)
    p.set('date', `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`)
    p.delete('photo')
    navigate('/photos?' + p)
    window.scrollTo({ top: 0 })
  }
  return (
    <nav className="ph-scrub" aria-label="Jump to month">
      <button className={'ph-scrub-item' + (!current ? ' on' : '')} onClick={() => { const p = new URLSearchParams(params); p.delete('date'); navigate('/photos' + (p.toString() ? '?' + p : '')) }}>Now</button>
      {months.map((d, i) => {
        const yearStart = i === 0 || d.getMonth() === 11
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
        return (
          <button key={key} className={'ph-scrub-item' + (current?.startsWith(key) ? ' on' : '') + (yearStart ? ' year' : '')} onClick={() => go(d)} title={fmtDate(d, { month: 'long', year: 'numeric' })}>
            {yearStart ? d.getFullYear() : fmtDate(d, { month: 'short' })}
          </button>
        )
      })}
    </nav>
  )
}
