// The shared ColourPicker with the calendar palette, plus a last swatch for any #rrggbb (calendar colours can be
// anything; lib/colour keeps them readable). `delay` commits a dragged custom colour once the user pauses, so a
// setting saved on change doesn't send a request per pixel.
import { useRef, useState } from 'react'
import { Icon } from '../../components/Icon'
import { ColourPicker } from '../../components/ui'
import { cn } from '../../lib/cn'
import { CAL_COLOURS } from './colours'

/** The ring the shared ColourPicker draws around the chosen swatch. */
const CHOSEN = 'shadow-[0_0_0_2px_var(--app-surface),0_0_0_4px_var(--app-fg)]'
const RAINBOW = 'conic-gradient(#ef4444, #f59e0b, #10b981, #3b82f6, #8b5cf6, #ef4444)'

export function ColourChoice({
  value,
  onChange,
  none,
  noneColour,
  label = 'Colour',
  delay = 0,
}: {
  /** '' or null: no colour of its own (the `none` choice, when offered). */
  value: string | null
  onChange: (colour: string) => void
  /** Label of the "no colour" choice (sends ''); leave out to not offer one. */
  none?: string
  /** What "no colour" falls back to (the calendar's colour), drawn in that choice's swatch. */
  noneColour?: string
  label?: string
  delay?: number
}) {
  const custom = !!value && !CAL_COLOURS.includes(value)
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {none && noneColour && (
        // biome-ignore lint/a11y/useSemanticElements: a swatch radio, drawn like the shared ColourPicker's
        <button
          type="button"
          role="radio"
          aria-checked={!value}
          aria-label={none}
          title={none}
          onClick={() => onChange('')}
          className={cn('grid size-6 place-items-center rounded-full border-0 text-white', !value && CHOSEN)}
          style={{ background: noneColour }}
        >
          {!value && <Icon name="check" size={12} />}
        </button>
      )}
      <ColourPicker
        value={value || null}
        onChange={(c) => onChange(c ?? '')}
        colours={CAL_COLOURS}
        none={noneColour ? undefined : none}
        label={label}
      />
      <CustomColour value={custom ? value : ''} onPick={onChange} delay={delay} />
    </div>
  )
}

function CustomColour({ value, onPick, delay }: { value: string; onPick: (c: string) => void; delay: number }) {
  // What the native input shows: the saved custom colour, or what's being dragged until it's saved.
  const [shown, setShown] = useState(value || '#888888')
  const [saved, setSaved] = useState(value)
  if (value !== saved) {
    setSaved(value)
    if (value) setShown(value)
  }
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  return (
    <label
      className={cn(
        'relative grid size-6 cursor-pointer place-items-center rounded-full text-white',
        'focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent',
        value && CHOSEN,
      )}
      style={{ background: value ? shown : RAINBOW }}
      title="Custom colour"
    >
      {value && <Icon name="check" size={12} />}
      <input
        type="color"
        aria-label="Custom colour"
        value={shown}
        className="absolute inset-0 size-full cursor-pointer opacity-0"
        onChange={(e) => {
          const c = e.target.value
          setShown(c)
          if (!delay) return onPick(c)
          if (timer.current) clearTimeout(timer.current)
          timer.current = setTimeout(() => onPick(c), delay)
        }}
      />
    </label>
  )
}
