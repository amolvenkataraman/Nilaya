// Small controls every app uses: a segmented switch (views, layouts, ranges), a colour picker and a search box.
// biome-ignore-all lint/a11y/useSemanticElements: styled toggle and swatch buttons with ARIA roles (group, radio); native fieldset and radio inputs can't take these looks without preflight
import type { ComponentPropsWithRef, ReactNode } from 'react'
import { cn } from '../../lib/cn'
import { Icon, type IconName } from '../Icon'

export interface SegmentOption<T extends string> {
  value: T
  label: ReactNode
  icon?: IconName
  /** Tooltip, e.g. with the keyboard shortcut. */
  title?: string
}

/** One of a few mutually exclusive options, all visible (List / Board / Table, Week / Month). */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  className,
}: {
  value: T
  onChange: (value: T) => void
  options: readonly SegmentOption<T>[]
  /** What the group chooses, for screen readers ("Layout"). */
  label: string
  className?: string
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn('inline-flex gap-0.5 rounded-sm border border-border bg-surface-2 p-0.5', className)}
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={o.value === value}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={cn(
            // No preflight: a button brings the browser's border and background unless told otherwise. One
            // background class per state, since cn() doesn't resolve conflicts.
            'inline-flex h-6.5 items-center gap-1.25 rounded-xs border-0 px-2.5 text-xs font-medium',
            o.value === value
              ? 'bg-surface text-fg shadow-[0_1px_2px_rgba(16,24,40,0.08),0_0_0_1px_var(--app-border)]'
              : 'bg-transparent text-muted hover:text-fg',
          )}
        >
          {o.icon && <Icon name={o.icon} size={14} />}
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** Round swatches; the chosen one gets a ring. `none` adds a first swatch for "no colour". */
export function ColourPicker({
  value,
  onChange,
  colours,
  none,
  label = 'Colour',
  names,
}: {
  value: string | null
  onChange: (colour: string | null) => void
  colours: readonly string[]
  /** Label of the "no colour" choice; leave out to not offer one. */
  none?: string
  label?: string
  /** Names for the swatches ("Blue"), for tooltips and screen readers; the colour value otherwise. */
  names?: Readonly<Record<string, string>>
}) {
  const swatch = 'grid size-6 place-items-center rounded-full'
  const chosen = 'shadow-[0_0_0_2px_var(--app-surface),0_0_0_4px_var(--app-fg)]'
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
      {none && (
        <button
          type="button"
          role="radio"
          aria-checked={value === null}
          aria-label={none}
          title={none}
          onClick={() => onChange(null)}
          className={cn(swatch, 'border border-border bg-surface text-muted', value === null && chosen)}
        >
          {value === null && <Icon name="check" size={12} />}
        </button>
      )}
      {colours.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={value === c}
          aria-label={names?.[c] ?? c}
          title={names?.[c] ?? c}
          onClick={() => onChange(c)}
          className={cn(swatch, 'border-0 text-white', value === c && chosen)}
          style={{ background: c }}
        >
          {value === c && <Icon name="check" size={12} />}
        </button>
      ))}
    </div>
  )
}

/** A search field with a magnifier and an optional key hint ("/"). */
export function SearchBox({
  className,
  kbd,
  ...input
}: ComponentPropsWithRef<'input'> & {
  /** A shortcut that focuses it, shown at the right. */
  kbd?: string
}) {
  return (
    <label
      className={cn(
        'flex h-8 min-w-0 items-center gap-2 rounded-sm border border-border bg-bg px-2.5 text-sm text-muted',
        'focus-within:border-accent focus-within:shadow-[0_0_0_3px_color-mix(in_srgb,var(--app-accent)_18%,transparent)]',
        className,
      )}
    >
      <Icon name="search" size={14} />
      <input
        type="search"
        className="h-full min-w-0 flex-1 border-0 bg-transparent p-0 text-fg outline-none placeholder:text-muted"
        {...input}
      />
      {kbd && <kbd className="kbd">{kbd}</kbd>}
    </label>
  )
}
