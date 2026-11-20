// Top search of Places: filters your places (the list below) and, from 3 characters, also searches the map
// (useGeocode: placewise on the server, debounced; "Map search isn't available" when it isn't running). A combobox: arrow keys
// move the active option (announced through aria-activedescendant), Enter picks it, Escape closes; the results
// close when focus leaves the box.
import { useEffect, useId, useState } from 'react'
import { Icon } from '../../components/Icon'
import { Button, useDebounced } from '../../components/ui'
import { cn } from '../../lib/cn'
import { type GeoHit, useGeocode } from '../../lib/map/useGeocode'
import { type Group, type Pin, statusOf, usePlaceSearch } from './api'
import { StatusDot } from './StatusDot'

const option =
  'flex w-full min-w-0 items-center gap-2 rounded-sm border-0 bg-transparent px-2 py-1.75 text-left text-sm text-fg [&>svg]:flex-none [&>svg]:text-muted'
const head = 'px-2 pt-1.5 pb-0.5 text-xs font-semibold tracking-[0.04em] text-muted uppercase'
const note = 'flex items-center gap-1.5 p-2 text-xs text-muted'

export function PlaceSearch({
  text,
  onText,
  places,
  groups,
  onPlace,
  onHit,
  onShowGroup,
}: {
  text: string
  onText: (t: string) => void
  places: Pin[]
  groups: Group[]
  onPlace: (p: Pin) => void
  onHit: (h: GeoHit) => void
  onShowGroup: (g: Group) => void
}) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const id = useId()
  const geo = useGeocode(text, open)
  const needle = text.trim().toLowerCase()
  // Places on the map match instantly; the server also searches groups that are turned off (not archived).
  const dq = useDebounced(needle, 250)
  const all = usePlaceSearch(open ? dq : '')
  const groupOf = (gid: number) => groups.find((g) => g.id === gid)
  const shown = needle
    ? places.filter((p) => p.name.toLowerCase().includes(needle) || (p.address ?? '').toLowerCase().includes(needle)).slice(0, 5)
    : []
  const more = needle
    ? (all.data ?? []).filter((p) => !shown.some((x) => x.id === p.id) && !places.some((x) => x.id === p.id)).slice(0, 6)
    : []
  const local = [...shown, ...more]
  const hits = geo.hits
  const count = local.length + hits.length
  // biome-ignore lint/correctness/useExhaustiveDependencies: new text or new map hits start the choice over
  useEffect(() => setActive(-1), [needle, hits.length])
  const pick = (i: number) => {
    setOpen(false)
    if (i < local.length) onPlace(local[i])
    else if (hits[i - local.length]) {
      onText('')
      onHit(hits[i - local.length])
    }
  }
  const show = open && !!needle
  const optId = (i: number) => `${id}-opt-${i}`
  return (
    // biome-ignore lint/a11y/useSemanticElements: a form, for Enter to pick; role=search makes it a landmark
    <form
      className={
        'relative flex h-9 w-[min(22rem,100%)] items-center gap-2 rounded-full border border-transparent bg-surface-2 pr-1 pl-3 text-muted ' +
        'focus-within:border-border focus-within:bg-surface focus-within:shadow-[0_1px_3px_rgba(16,24,40,.08)] max-md:min-w-20 max-md:flex-1'
      }
      role="search"
      onSubmit={(e) => {
        e.preventDefault()
        if (count) pick(Math.max(active, 0))
      }}
      onBlur={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setOpen(false)}
    >
      <Icon name="search" />
      <input
        className="min-w-0 flex-1 border-0 bg-transparent text-sm text-fg outline-none"
        value={text}
        onChange={(e) => {
          onText(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        placeholder="Search your places and the map"
        aria-label="Search places and the map"
        maxLength={200}
        role="combobox"
        aria-expanded={show}
        aria-controls={`${id}-list`}
        aria-autocomplete="list"
        aria-activedescendant={show && active >= 0 && active < count ? optId(active) : undefined}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            if (show) {
              e.stopPropagation()
              setOpen(false)
            }
          } else if (e.key === 'ArrowDown') {
            e.preventDefault()
            setOpen(true)
            setActive((a) => Math.min(a + 1, count - 1))
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setActive((a) => Math.max(a - 1, 0))
          }
        }}
      />
      {text && (
        <Button variant="ghost" size="sm" icon onClick={() => onText('')} aria-label="Clear search">
          <Icon name="x" size={14} />
        </Button>
      )}
      {show && (
        <div
          id={`${id}-list`}
          role="listbox"
          aria-label="Search results"
          // Focusable so a click on a heading or note keeps the results open (focus stays inside the form).
          tabIndex={-1}
          className={
            'absolute top-[calc(100%+6px)] left-0 z-1000 grid max-h-[60vh] w-[min(26rem,calc(100vw-1rem))] gap-px overflow-auto rounded-md bg-surface p-1 text-fg shadow-pop outline-none ' +
            'max-md:fixed max-md:top-13 max-md:right-2 max-md:left-2 max-md:w-auto'
          }
        >
          {local.length > 0 && (
            <div className={head} role="presentation">
              Your places
            </div>
          )}
          {local.map((p, i) => {
            const g = groupOf(p.group_id)
            const off = !!g && !g.visible
            return (
              <div key={p.id} className="flex min-w-0 items-center gap-1" role="presentation">
                <button
                  type="button"
                  id={optId(i)}
                  role="option"
                  tabIndex={-1}
                  aria-selected={active === i}
                  className={cn(option, 'flex-1', active === i && 'bg-hover')}
                  onMouseMove={() => setActive(i)}
                  onClick={() => pick(i)}
                >
                  <StatusDot status={statusOf(p)} />
                  <span className="min-w-0 flex-1 truncate">
                    {p.name}
                    <span className="text-xs text-muted">
                      {' '}
                      · {g?.name ?? ''}
                      {off ? ' (hidden)' : ''}
                      {p.address ? ` · ${p.address}` : ''}
                    </span>
                  </span>
                </button>
                {off && g && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="px-2 text-accent!"
                    onClick={() => onShowGroup(g)}
                    title={`Turn on ${g.name}`}
                  >
                    Show group
                  </Button>
                )}
              </div>
            )
          })}
          {hits.length > 0 && (
            <div className={head} role="presentation">
              On the map
            </div>
          )}
          {hits.map((h, j) => {
            const i = local.length + j
            return (
              <button
                type="button"
                id={optId(i)}
                role="option"
                tabIndex={-1}
                key={h.id}
                aria-selected={active === i}
                className={cn(option, active === i && 'bg-hover')}
                onMouseMove={() => setActive(i)}
                onClick={() => pick(i)}
              >
                <Icon name="pin" size={13} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{h.name}</span>
                  <span className="block truncate text-xs text-muted">{[h.kind, h.address].filter(Boolean).join(' · ')}</span>
                </span>
              </button>
            )
          })}
          {geo.off ? (
            <div className={note}>
              <Icon name="info" size={13} />
              Map search isn't available: the place service isn't running on the server.
            </div>
          ) : needle.length < 2 ? (
            !local.length && <div className={note}>Type 2 letters to search the map.</div>
          ) : geo.waiting ? (
            <div className={note}>
              <span className="spinner" />
              Searching the map…
            </div>
          ) : geo.error ? (
            <div className="flex items-center gap-1.5 p-2 text-xs text-danger">{(geo.error as Error).message}</div>
          ) : !hits.length && !local.length ? (
            <div className={note}>No results.</div>
          ) : null}
        </div>
      )}
    </form>
  )
}
