// Pick a time zone to show the calendar in (Google Calendar's "display secondary/another time zone").
// The choice lasts for this window only (zone.ts keeps it in sessionStorage). Loaded on demand.
import { useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '../../components/Icon'
import { Button, Dialog, MenuLabel } from '../../components/ui'
import { cn } from '../../lib/cn'
import { pill } from './chips'
import { HOME_ZONE, allZones, gmtText, offsetMs, validZone, zoneCity, type Zone } from './zone'

interface Meta {
  id: string
  city: string
  region: string
  long: string
  off: number
  time: string
  hay: string
}

function describe(id: string, now: number): Meta | null {
  try {
    const parts = new Intl.DateTimeFormat(undefined, {
      timeZone: id,
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'long',
    }).formatToParts(now)
    const long = parts.find((p) => p.type === 'timeZoneName')?.value ?? ''
    const time = parts
      .filter((p) => p.type !== 'timeZoneName')
      .map((p) => p.value)
      .join('')
      .trim()
    const off = offsetMs(now, id)
    const city = zoneCity(id)
    const region = id.split('/').slice(0, -1).join(' / ').replace(/_/g, ' ')
    const gmt = gmtText(off)
    return { id, city, region, long, off, time, hay: `${id.replace(/_/g, ' ')} ${long} ${gmt} ${gmt.replace('GMT', '')}`.toLowerCase() }
  } catch {
    return null
  }
}

export default function ZonePicker({
  tz,
  profileZone,
  onPick,
  onClose,
}: {
  tz: Zone
  profileZone?: string
  onPick: (tz: Zone) => void
  onClose: () => void
}) {
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)
  const list = useRef<HTMLDivElement>(null)
  const current = tz ?? HOME_ZONE
  const metas = useMemo(() => {
    const now = Date.now()
    return allZones()
      .map((z) => describe(z, now))
      .filter((m): m is Meta => !!m)
      .sort((a, b) => a.off - b.off || a.city.localeCompare(b.city))
  }, [])
  const byId = useMemo(() => new Map(metas.map((m) => [m.id, m])), [metas])
  const query = q.trim().toLowerCase()
  const [lastQuery, setLastQuery] = useState(query)
  if (query !== lastQuery) {
    setLastQuery(query)
    setActive(0)
  }
  const suggested = useMemo(() => {
    const ids = [HOME_ZONE, profileZone && validZone(profileZone) ? profileZone : '', tz ?? '', 'UTC'].filter(
      (z, i, a) => z && a.indexOf(z) === i,
    )
    return ids.map((id) => byId.get(id)).filter((m): m is Meta => !!m)
  }, [byId, profileZone, tz])
  const matches = useMemo(() => (query ? metas.filter((m) => query.split(/\s+/).every((w) => m.hay.includes(w))) : metas), [metas, query])
  const rows = query ? matches : [...suggested, ...metas.filter((m) => !suggested.includes(m))]
  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const pick = (id: string) => {
    onPick(id === HOME_ZONE ? undefined : id)
    onClose()
  }
  const tag = (id: string) => (id === HOME_ZONE ? 'Yours' : id === profileZone ? 'Profile' : '')
  const row = (m: Meta, i: number) => (
    <button
      key={m.id}
      type="button"
      role="option"
      data-i={i}
      aria-selected={i === active}
      className={cn(
        'flex w-full cursor-pointer items-center gap-2 rounded-sm border-0 px-2 py-1.5 text-left text-fg',
        i === active ? 'bg-hover' : 'bg-transparent',
      )}
      onMouseMove={() => setActive(i)}
      onClick={() => pick(m.id)}
    >
      <span className="grid w-4 flex-none place-items-center text-accent">{m.id === current && <Icon name="check" size={14} />}</span>
      <span className="grid min-w-0 flex-auto text-sm">
        <span className="min-w-0 truncate">
          <strong>{m.city}</strong>
          {m.region && <span className="text-muted"> · {m.region}</span>}
          {tag(m.id) && <span className={cn(pill, 'ml-1.5 px-1.5! align-[1px] text-3xs!')}>{tag(m.id)}</span>}
        </span>
        {m.long && <span className="min-w-0 truncate text-xs text-muted">{m.long}</span>}
      </span>
      <span className="grid flex-none justify-items-end text-sm tabular-nums">
        <span>{m.time}</span>
        <span className="text-xs text-muted">{gmtText(m.off)}</span>
      </span>
    </button>
  )

  return (
    <Dialog open onClose={onClose} title="Display time zone" width="30rem">
      <div className="grid gap-2.5">
        <p className="text-sm text-muted">
          Show times in another zone, for this window only. Events keep their real times; all-day events stay on their dates.
        </p>
        {tz && (
          <Button className="justify-self-start" onClick={() => pick(HOME_ZONE)}>
            <Icon name="chevronLeft" size={14} />
            Back to {zoneCity(HOME_ZONE)} <span className="text-muted tabular-nums">{gmtText(offsetMs(Date.now(), HOME_ZONE))}</span>
          </Button>
        )}
        <div className="flex h-9 items-center gap-2 rounded-sm border border-border bg-surface px-2.5 text-muted focus-within:border-accent focus-within:shadow-[0_0_0_3px_var(--app-accent-soft)]">
          <Icon name="search" size={14} />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search city, zone or GMT+9"
            aria-label="Search time zones"
            aria-controls="tz-list"
            className="min-w-0 flex-1 border-0 bg-transparent text-fg outline-0"
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setActive((a) => Math.min(a + 1, rows.length - 1))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setActive((a) => Math.max(a - 1, 0))
              } else if (e.key === 'Enter' && rows[active]) {
                e.preventDefault()
                pick(rows[active].id)
              }
            }}
          />
        </div>
        <div
          className="-mx-1 max-h-[min(24rem,55vh)] overflow-y-auto overscroll-contain px-1"
          id="tz-list"
          role="listbox"
          aria-label="Time zones"
          ref={list}
        >
          {!query && suggested.length > 0 && <MenuLabel>Suggested</MenuLabel>}
          {!query && suggested.map((m, i) => row(m, i))}
          {!query && <MenuLabel>All time zones</MenuLabel>}
          {rows.slice(query ? 0 : suggested.length).map((m, i) => row(m, i + (query ? 0 : suggested.length)))}
          {query && !matches.length && <p className="m-0 p-2 text-sm text-muted">No time zone matches "{q.trim()}".</p>}
        </div>
      </div>
    </Dialog>
  )
}
