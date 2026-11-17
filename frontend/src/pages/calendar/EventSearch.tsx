// Search events (name, location, description) within ±200 days; pick one to jump there and open it.
// "/" opens it. It closes when focus leaves it, so it needs no document-wide click listener.
import { useState } from 'react'
import { Icon } from '../../components/Icon'
import { Button, useDebounced, useHotkey } from '../../components/ui'
import { layerOpen } from '../../components/layers'
import { cn } from '../../lib/cn'
import { addDays, startOfDay } from '../../lib/dates'
import type { CalEvent, Calendar } from '../../lib/types'
import { useEventSearch } from './api'
import { eventDays } from './range'
import { fmtDateIn, fmtTimeIn, useCalPrefs } from './zone'

const SPAN_DAYS = 200
const MAX_RESULTS = 12

export function EventSearch({ calendars, onPick }: { calendars?: Calendar[]; onPick: (e: CalEvent) => void }) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [active, setActive] = useState(0)
  const q = useDebounced(text.trim(), 300)
  const [lastQ, setLastQ] = useState(q)
  if (q !== lastQ) {
    setLastQ(q)
    setActive(0)
  }
  const { tz } = useCalPrefs()
  const today = startOfDay(new Date())
  const res = useEventSearch(q, addDays(today, -SPAN_DAYS).toISOString(), addDays(today, SPAN_DAYS).toISOString(), open && q.length >= 2)
  const items = (res.data ?? [])
    .slice()
    .sort((a, b) => Math.abs(new Date(a.start).getTime() - Date.now()) - Math.abs(new Date(b.start).getTime() - Date.now()))
    .slice(0, MAX_RESULTS)
  useHotkey(
    (e) => e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey && !layerOpen(['dialog', 'palette']),
    (e) => {
      e.preventDefault()
      setOpen(true)
    },
  )
  const colour = (id: number) => calendars?.find((c) => c.id === id)?.colour ?? 'var(--app-muted)'
  const pick = (e: CalEvent) => {
    onPick(e)
    setOpen(false)
    setText('')
  }
  if (!open)
    return (
      <Button variant="ghost" icon onClick={() => setOpen(true)} aria-label="Search events" title="Search events (/)">
        <Icon name="search" size={17} />
      </Button>
    )
  return (
    <div
      className="relative flex h-8 w-[min(18rem,40vw)] items-center gap-1.5 rounded-sm border border-accent bg-surface px-2"
      onBlur={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && setOpen(false)}
    >
      <Icon name="search" size={14} />
      <input
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Search events"
        aria-label="Search events"
        className="min-w-0 flex-1 border-0 bg-transparent text-sm outline-none"
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation()
            setOpen(false)
          } else if (e.key === 'ArrowDown') {
            e.preventDefault()
            setActive((a) => Math.min(a + 1, items.length - 1))
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setActive((a) => Math.max(a - 1, 0))
          } else if (e.key === 'Enter' && items[active]) {
            e.preventDefault()
            pick(items[active])
          }
        }}
      />
      {res.isFetching && <span className="spinner" />}
      {q.length >= 2 && !res.isPending && (
        // Clicks on results keep focus in the field (else it would blur and close before the click lands).
        <ul
          className="absolute top-[calc(100%+4px)] right-0 z-60 max-h-[60vh] w-[min(26rem,90vw)] overflow-auto rounded-md bg-surface p-1 shadow-pop"
          role="listbox"
          aria-label="Matching events"
          onMouseDown={(e) => e.preventDefault()}
        >
          {items.length === 0 && <li className="p-2 text-sm text-muted">No events match "{q}".</li>}
          {items.map((e, i) => {
            const s = e.all_day ? eventDays(e).first : new Date(e.start) // all-day: its calendar date
            const z = e.all_day ? undefined : tz // timed: in the display zone
            return (
              <li key={e.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={i === active}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-sm border-0 px-2 py-1.75 text-left text-sm text-fg',
                    i === active ? 'bg-hover' : 'bg-transparent',
                  )}
                  onMouseMove={() => setActive(i)}
                  onClick={() => pick(e)}
                >
                  <span className="size-2 flex-none rounded-full" style={{ background: e.display_colour || colour(e.calendar_id) }} />
                  <span className="min-w-0 flex-auto truncate">
                    {e.name}
                    {e.location && <span className="text-muted"> · {e.location}</span>}
                  </span>
                  <span className="text-xs text-muted tabular-nums">
                    {fmtDateIn(
                      s,
                      { month: 'short', day: 'numeric', year: s.getFullYear() !== today.getFullYear() ? 'numeric' : undefined },
                      z,
                    )}
                    {e.all_day ? '' : (e.kind === 'deadline' ? ' · due ' : ' · ') + fmtTimeIn(s, z)}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
