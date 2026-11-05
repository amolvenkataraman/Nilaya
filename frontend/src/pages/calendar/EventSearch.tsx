// Search events (name, location, description) within ±200 days; pick one to jump there and open it.
import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Icon } from '../../components/Icon'
import { useDebounced, useHotkey } from '../../components/ui'
import { get } from '../../lib/api'
import { addDays, dayKey, fmtDate, fmtTime, startOfDay } from '../../lib/dates'
import type { CalEvent, Calendar } from '../../lib/types'

export function EventSearch({ calendars, onPick }: { calendars?: Calendar[]; onPick: (e: CalEvent) => void }) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [active, setActive] = useState(0)
  const q = useDebounced(text.trim(), 300)
  const box = useRef<HTMLDivElement>(null)
  const today = startOfDay(new Date())
  const start = addDays(today, -200).toISOString()
  const end = addDays(today, 200).toISOString()
  const res = useQuery({
    queryKey: ['calendar', 'search', q],
    queryFn: ({ signal }) => get<CalEvent[]>('calendar/events', { q, start, end }, signal),
    enabled: open && q.length >= 2,
    staleTime: 60_000,
  })
  const items = (res.data ?? []).slice().sort((a, b) => Math.abs(new Date(a.start).getTime() - Date.now()) - Math.abs(new Date(b.start).getTime() - Date.now())).slice(0, 12)
  useEffect(() => setActive(0), [q])
  useHotkey((e) => e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey && !document.querySelector('.dialog,.palette'), (e) => (e.preventDefault(), setOpen(true)))
  useEffect(() => {
    if (!open) return
    const down = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false)
    document.addEventListener('pointerdown', down, true)
    return () => document.removeEventListener('pointerdown', down, true)
  }, [open])
  const colour = (id: number) => calendars?.find((c) => c.id === id)?.colour ?? 'var(--app-muted)'
  const pick = (e: CalEvent) => {
    onPick(e)
    setOpen(false)
    setText('')
  }
  if (!open) return <button className="btn ghost icon" onClick={() => setOpen(true)} aria-label="Search events" title="Search events (/)"><Icon name="search" size={17} /></button>
  return (
    <div className="ev-search" ref={box}>
      <Icon name="search" size={14} />
      <input autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder="Search events" aria-label="Search events"
        onKeyDown={(e) => {
          if (e.key === 'Escape') (e.stopPropagation(), setOpen(false))
          else if (e.key === 'ArrowDown') (e.preventDefault(), setActive((a) => Math.min(a + 1, items.length - 1)))
          else if (e.key === 'ArrowUp') (e.preventDefault(), setActive((a) => Math.max(a - 1, 0)))
          else if (e.key === 'Enter' && items[active]) (e.preventDefault(), pick(items[active]))
        }} />
      {res.isFetching && <span className="spinner" />}
      {q.length >= 2 && !res.isPending && (
        <ul className="ev-search-results" role="listbox">
          {items.length === 0 && <li className="muted small" style={{ padding: '0.5rem' }}>No events match "{q}".</li>}
          {items.map((e, i) => {
            const s = new Date(e.start)
            return (
              <li key={e.id}>
                <button role="option" aria-selected={i === active} className={i === active ? 'on' : ''} onMouseMove={() => setActive(i)} onClick={() => pick(e)}>
                  <span className="dot" style={{ background: e.display_colour || colour(e.calendar_id) }} />
                  <span className="grow truncate">{e.name}{e.location && <span className="muted"> · {e.location}</span>}</span>
                  <span className="muted xsmall tabular">{fmtDate(s, { month: 'short', day: 'numeric', year: s.getFullYear() !== today.getFullYear() ? 'numeric' : undefined })}{e.all_day ? '' : (e.kind === 'deadline' ? ' · due ' : ' · ') + fmtTime(s)}</span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
export const searchDateKey = (e: CalEvent) => dayKey(new Date(e.start))
