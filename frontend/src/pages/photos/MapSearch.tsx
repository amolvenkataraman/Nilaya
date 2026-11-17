// Place search floating over a tool's map (Add missing locations): the server's geocoder via useGeocode; a hit
// flies the map there and drops the pin. Results are a list of buttons (Tab to them; Enter takes the first).
import { useState } from 'react'
import { Icon } from '../../components/Icon'
import { type GeoHit, useGeocode } from '../../lib/map/useGeocode'

const note = 'px-2 py-1.5 text-sm text-muted'

export function MapSearch({ onPick }: { onPick: (h: GeoHit) => void }) {
  const [text, setText] = useState('')
  const [open, setOpen] = useState(false)
  const { hits, off, waiting, error } = useGeocode(text)
  const show = open && text.trim().length >= 3
  const pick = (h: GeoHit) => {
    onPick(h)
    setOpen(false)
  }
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: closes the results when focus leaves the box
    <div
      className="absolute top-3 left-3 z-500 w-[min(22rem,calc(100%-1.5rem))] max-md:top-2 max-md:left-2 max-md:w-[calc(100%-1rem)]"
      onBlur={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setOpen(false)}
    >
      {/* biome-ignore lint/a11y/useSemanticElements: a form, for Enter to take the first hit */}
      <form
        className="flex h-9 w-full items-center gap-2 rounded-full border border-border bg-surface px-3 text-muted shadow-[var(--card-shadow),0_1px_3px_rgba(16,24,40,0.16)]"
        role="search"
        onSubmit={(e) => {
          e.preventDefault()
          if (hits[0]) pick(hits[0])
        }}
      >
        <Icon name="search" />
        <input
          className="min-w-0 flex-1 border-0 bg-transparent text-sm text-fg outline-none"
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key !== 'Escape') return
            setOpen(false)
            e.currentTarget.blur()
          }}
          placeholder="Search for a place"
          aria-label="Search for a place on the map"
          maxLength={200}
        />
      </form>
      {show && (
        <ul className="mt-1 grid rounded-md border border-border bg-surface p-1 shadow-pop" aria-label="Places">
          {off ? (
            <li className={note}>Search is off (the server is in offline mode).</li>
          ) : waiting ? (
            <li className={note}>Searching…</li>
          ) : error ? (
            <li className={note}>Search failed.</li>
          ) : !hits.length ? (
            <li className={note}>No places found.</li>
          ) : (
            hits.map((h) => (
              <li key={`${h.lat},${h.lng},${h.name}`}>
                <button
                  type="button"
                  className="grid w-full min-w-0 rounded-sm border-0 bg-transparent px-2 py-1.5 text-left hover:bg-hover focus-visible:bg-hover"
                  onClick={() => pick(h)}
                >
                  <strong className="truncate">{h.name}</strong>
                  <span className="truncate text-xs text-muted">{h.address}</span>
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  )
}
