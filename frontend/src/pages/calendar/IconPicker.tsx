// A row of icon choices (calendars, categories, events), the icon counterpart of the shared ColourPicker.
// Built here first; meant for components/ui once Habits uses it too.
import { Icon } from '../../components/Icon'
import { cn } from '../../lib/cn'

export function IconPicker({
  value,
  onChange,
  icons,
  none,
  label = 'Icon',
  size = 'md',
}: {
  value: string
  onChange: (icon: string) => void
  icons: readonly string[]
  /** Label of the "no icon" choice (value ''); leave out to not offer one. */
  none?: string
  label?: string
  size?: 'sm' | 'md'
}) {
  const option = (icon: string, title: string, glyph: string, glyphSize: number) => (
    // biome-ignore lint/a11y/useSemanticElements: an icon radio, drawn like the shared ColourPicker's swatches
    <button
      key={icon || '-'}
      type="button"
      role="radio"
      aria-checked={value === icon}
      aria-label={title}
      title={title}
      onClick={() => onChange(icon)}
      className={cn(
        'grid place-items-center rounded-sm border p-0',
        size === 'sm' ? 'size-7' : 'size-8',
        value === icon ? 'border-accent bg-accent-soft text-accent' : 'border-border bg-surface text-muted hover:text-fg',
      )}
    >
      <Icon name={glyph} size={glyphSize} />
    </button>
  )
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
      {none && option('', none, 'x', 13)}
      {icons.map((i) => option(i, i, i, 15))}
    </div>
  )
}
