// Pick a time zone to show the calendar in (Google Calendar's "display secondary/another time zone").
// The choice lasts for this window only (zone.ts keeps it in sessionStorage). Loaded on demand.
import { useEffect, useMemo, useRef, useState } from 'react'
import { Dialog } from '../../components/ui'
import { Icon } from '../../components/Icon'
import { HOME_ZONE, allZones, gmtText, offsetMs, validZone, zoneCity, type Zone } from './zone'

interface Meta { id: string; city: string; region: string; long: string; off: number; time: string; hay: string }

function describe(id: string, now: number): Meta | null {
  try {
    const parts = new Intl.DateTimeFormat(undefined, { timeZone: id, hour: 'numeric', minute: '2-digit', timeZoneName: 'long' }).formatToParts(now)
    const long = parts.find((p) => p.type === 'timeZoneName')?.value ?? ''
    const time = parts.filter((p) => p.type !== 'timeZoneName').map((p) => p.value).join('').trim()
    const off = offsetMs(now, id)
    const segs = id.split('/')
    const city = zoneCity(id)
    const region = segs.slice(0, -1).join(' / ').replace(/_/g, ' ')
    const gmt = gmtText(off)
    return { id, city, region, long, off, time, hay: `${id.replace(/_/g, ' ')} ${long} ${gmt} ${gmt.replace('GMT', '')}`.toLowerCase() }
  } catch {
    return null
  }
}

export default function ZonePicker({ tz, profileZone, onPick, onClose }: { tz: Zone; profileZone?: string; onPick: (tz: Zone) => void; onClose: () => void }) {
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)
  const list = useRef<HTMLDivElement>(null)
  const current = tz ?? HOME_ZONE
  const metas = useMemo(() => {
    const now = Date.now()
    return allZones().map((z) => describe(z, now)).filter((m): m is Meta => !!m).sort((a, b) => a.off - b.off || a.city.localeCompare(b.city))
  }, [])
  const byId = useMemo(() => new Map(metas.map((m) => [m.id, m])), [metas])
  const query = q.trim().toLowerCase()
  const suggested = useMemo(() => {
    const ids = [HOME_ZONE, profileZone && validZone(profileZone) ? profileZone : '', tz ?? '', 'UTC'].filter((z, i, a) => z && a.indexOf(z) === i)
    return ids.map((id) => byId.get(id)).filter((m): m is Meta => !!m)
  }, [byId, profileZone, tz])
  const matches = useMemo(() => (query ? metas.filter((m) => query.split(/\s+/).every((w) => m.hay.includes(w))) : metas), [metas, query])
  const rows = query ? matches : [...suggested, ...metas.filter((m) => !suggested.includes(m))]
  useEffect(() => setActive(0), [query])
  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const pick = (id: string) => {
    onPick(id === HOME_ZONE ? undefined : id)
    onClose()
  }
  const tag = (id: string) => (id === HOME_ZONE ? 'Yours' : id === profileZone ? 'Profile' : '')
  const row = (m: Meta, i: number) => (
    <button key={m.id} type="button" role="option" data-i={i} aria-selected={i === active} className={'tz-row' + (i === active ? ' on' : '')}
      onMouseMove={() => setActive(i)} onClick={() => pick(m.id)}>
      <span className="tz-check">{m.id === current && <Icon name="check" size={14} />}</span>
      <span className="grow tz-name">
        <span className="truncate"><strong>{m.city}</strong>{m.region && <span className="muted"> · {m.region}</span>}{tag(m.id) && <span className="chip tz-tag">{tag(m.id)}</span>}</span>
        {m.long && <span className="xsmall muted truncate">{m.long}</span>}
      </span>
      <span className="tz-time tabular">
        <span>{m.time}</span>
        <span className="xsmall muted">{gmtText(m.off)}</span>
      </span>
    </button>
  )

  return (
    <Dialog open onClose={onClose} title="Display time zone" width="30rem">
      <div className="tz-pick">
        <p className="small muted">Show times in another zone, for this window only. Events keep their real times; all-day events stay on their dates.</p>
        {tz && (
          <button type="button" className="btn tz-back" onClick={() => pick(HOME_ZONE)}>
            <Icon name="chevronLeft" size={14} />Back to {zoneCity(HOME_ZONE)} <span className="muted tabular">{gmtText(offsetMs(Date.now(), HOME_ZONE))}</span>
          </button>
        )}
        <div className="tz-search">
          <Icon name="search" size={14} />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search city, zone or GMT+9" aria-label="Search time zones"
            aria-controls="tz-list"
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') (e.preventDefault(), setActive((a) => Math.min(a + 1, rows.length - 1)))
              else if (e.key === 'ArrowUp') (e.preventDefault(), setActive((a) => Math.max(a - 1, 0)))
              else if (e.key === 'Enter' && rows[active]) (e.preventDefault(), pick(rows[active].id))
            }} />
        </div>
        <div className="tz-list" id="tz-list" role="listbox" aria-label="Time zones" ref={list}>
          {!query && suggested.length > 0 && <div className="menu-label">Suggested</div>}
          {!query && suggested.map((m, i) => row(m, i))}
          {!query && <div className="menu-label">All time zones</div>}
          {rows.slice(query ? 0 : suggested.length).map((m, i) => row(m, i + (query ? 0 : suggested.length)))}
          {query && !matches.length && <p className="muted small tz-empty">No time zone matches "{q.trim()}".</p>}
        </div>
      </div>
    </Dialog>
  )
}
