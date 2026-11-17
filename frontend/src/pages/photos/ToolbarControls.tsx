// Photos top-bar controls for photo grids: the select-mode toggle, the thumbnail-label menu and the thumbnail
// size switch (desktop only; phones pick a size by pinching in the browser).
import { Icon } from '../../components/Icon'
import { Button, Menu, MenuItem, MenuLabel, Segmented } from '../../components/ui'
import { selection } from './selection'
import { TILE_LABELS, setTileLabel, tileLabel } from './tileLabel'

import type { Zoom } from './PhotoStream'

export function SelectToggle() {
  const mode = selection.useSelect((s) => s.mode)
  return (
    <Button
      size="sm"
      className="aria-pressed:border-transparent aria-pressed:bg-accent-soft aria-pressed:text-accent"
      aria-pressed={mode}
      onClick={() => selection.setMode(!mode)}
      title="Select photos (shift-click for a range)"
    >
      <Icon name="check" size={14} />
      <span className="max-md:hidden">Select</span>
    </Button>
  )
}

export function LabelMenu() {
  const l = tileLabel.use()
  return (
    <Menu
      align="end"
      label="Label on thumbnails"
      trigger={(p) => (
        <Button {...p} variant="ghost" size="sm" icon aria-label="Label on thumbnails" title="Label on thumbnails">
          <Icon name="tag" size={15} />
        </Button>
      )}
    >
      {(close) => (
        <>
          <MenuLabel>Label on thumbnails</MenuLabel>
          {TILE_LABELS.map(([k, name]) => (
            <MenuItem
              key={k}
              active={l === k}
              end={l === k ? '✓' : undefined}
              onClick={() => {
                close()
                setTileLabel(k)
              }}
            >
              {name}
            </MenuItem>
          ))}
        </>
      )}
    </Menu>
  )
}

const SIZES = (['s', 'm', 'l'] as const).map((z) => ({
  value: z,
  title: { s: 'Small thumbnails', m: 'Medium thumbnails', l: 'Large thumbnails' }[z],
  label: (
    <>
      <ZoomGlyph z={z} />
      <span className="sr-only">{{ s: 'Small', m: 'Medium', l: 'Large' }[z]}</span>
    </>
  ),
}))

export function ZoomSwitch({ zoom, setZoom }: { zoom: Zoom; setZoom: (z: Zoom) => void }) {
  return (
    <Segmented value={zoom} onChange={setZoom} options={SIZES} label="Thumbnail size" className="ml-auto max-md:hidden [&>button]:px-2" />
  )
}

/** A 3×3, 2×2 or 1×1 grid of squares. */
function ZoomGlyph({ z }: { z: Zoom }) {
  const n = { s: 3, m: 2, l: 1 }[z]
  const cell = 12 / n
  const rects = []
  for (let r = 0; r < n; r++)
    for (let c = 0; c < n; c++)
      rects.push(<rect key={`${r}${c}`} x={c * cell + 0.75} y={r * cell + 0.75} width={cell - 1.5} height={cell - 1.5} rx="1" />)
  return (
    <svg width="0.75rem" height="0.75rem" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
      {rects}
    </svg>
  )
}
