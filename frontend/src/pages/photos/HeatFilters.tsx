// Filters for the photo heat map (Photos › Map and the Places heat layer), sent to GET /photos/points:
// a year (or every year up to it), one library, an altitude ceiling, and photos taken on planes.
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { photoLibrariesQuery, photoSummaryQuery } from '../../lib/photoQueries'
import type { Library } from '../../lib/types'

export interface HeatFilter { year: string; upTo: boolean; library: string; maxAlt: string; planes: boolean }
const EMPTY: HeatFilter = { year: '', upTo: false, library: '', maxAlt: '', planes: false }
const ALTITUDES = [100, 500, 1000, 2000, 5000]

export function useHeatFilter() {
  const [f, setF] = useState<HeatFilter>(EMPTY)
  return [f, (patch: Partial<HeatFilter>) => setF((x) => ({ ...x, ...patch }))] as const
}

/** Query params for /photos/points (also the query key, so equal filters share one cached request). */
export function heatParams(f: HeatFilter) {
  return {
    year: f.year || undefined,
    until_year: (f.year && f.upTo) || undefined,
    library_id: f.library || undefined,
    max_alt: f.maxAlt || undefined,
    include_planes: f.planes || undefined,
  }
}

export function HeatFilterControls({ f, set, enabled = true }: { f: HeatFilter; set: (p: Partial<HeatFilter>) => void; enabled?: boolean }) {
  const years = useQuery({ ...photoSummaryQuery<{ per_year: { year: number; count: number }[] }>(), enabled }).data?.per_year ?? []
  const libs = useQuery({ ...photoLibrariesQuery<Library[]>(), enabled }).data ?? []
  const check = { gap: '0.375rem' }
  return (
    <>
      <div className="row" style={{ gap: '0.375rem', flexWrap: 'wrap' }}>
        <select className="select sm-select" value={f.year} onChange={(e) => set({ year: e.target.value })} aria-label="Year">
          <option value="">All years</option>
          {years.map((y) => <option key={y.year} value={y.year}>{y.year} · {y.count.toLocaleString()}</option>)}
        </select>
        {libs.length > 1 && (
          <select className="select sm-select" value={f.library} onChange={(e) => set({ library: e.target.value })} aria-label="Library">
            <option value="">All libraries</option>
            {libs.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        )}
        <select className="select sm-select" value={f.maxAlt} onChange={(e) => set({ maxAlt: e.target.value })} aria-label="Highest altitude">
          <option value="">Any altitude</option>
          {ALTITUDES.map((m) => <option key={m} value={m}>Up to {m.toLocaleString()} m</option>)}
        </select>
      </div>
      {f.year && <label className="row xsmall" style={check}><input type="checkbox" checked={f.upTo} onChange={(e) => set({ upTo: e.target.checked })} />Every year up to {f.year}</label>}
      <label className="row xsmall" style={check}><input type="checkbox" checked={f.planes} onChange={(e) => set({ planes: e.target.checked })} />Include photos taken on planes</label>
    </>
  )
}
