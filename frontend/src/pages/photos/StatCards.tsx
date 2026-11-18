// The card pieces of Photos › Stats, Storage and Superlatives: a number tile (label, big value, muted
// detail), a titled card with actions on the right, the grids they sit in, and the small select those
// cards use. Kept together because the three pages lay out the same way.
import type { ReactNode } from 'react'
import { fieldClass } from '../../components/ui'
import { cn } from '../../lib/cn'

/** Tiles in a row; they wrap to fit (one per row on narrow phones). */
export const tilesClass = 'mb-3 grid grid-cols-[repeat(auto-fit,minmax(min(100%,10rem),1fr))] gap-3'
/** Cards two or three across, at least 22rem each. */
export const cardGridClass = 'grid grid-cols-[repeat(auto-fill,minmax(min(100%,22rem),1fr))] gap-3'
/** Help line under a chart. */
export const helpClass = 'text-xs text-muted'
/** The compact select in card heads (the field look at 1.75rem, sized to its text). */
export const smallSelectClass = fieldClass.select({ size: 'sm', width: 'content', className: 'max-w-full' })

const card = 'min-w-0 rounded-md border border-border bg-surface shadow-card'

export function StatTile({
  label,
  value,
  sub,
  swatch,
}: {
  label: string
  value: ReactNode
  sub?: ReactNode
  /** Background class of a colour key before the label. */
  swatch?: string
}) {
  return (
    <div className={cn(card, 'grid content-start gap-1 px-4 py-3')}>
      <span className="m-0 flex items-center gap-1.5 text-xs font-semibold text-muted">
        {swatch && <i className={cn('inline-block size-2.5 flex-none rounded-[2px]', swatch)} aria-hidden="true" />}
        {label}
      </span>
      <span className="text-xl font-semibold tracking-[-0.02em] wrap-anywhere tabular-nums">{value}</span>
      {sub && <span className="text-xs text-muted wrap-anywhere tabular-nums [&_strong]:font-semibold [&_strong]:text-fg">{sub}</span>}
    </div>
  )
}

/** "MP", "items" after a tile's number. */
export const Unit = ({ children }: { children: ReactNode }) => (
  <span className="text-sm font-medium tracking-normal text-muted">{children}</span>
)

/** A card head: the title, and actions (selects, tabs) that wrap under it when there's no room. */
export function CardHead({ children }: { children: ReactNode }) {
  return <div className="flex min-h-11 flex-wrap items-center gap-2 gap-y-1.5 border-b border-border py-2 pr-3 pl-4">{children}</div>
}

export function StatCard({
  title,
  children,
  wide,
  actions,
}: {
  title: string
  children: ReactNode
  /** Spans the whole grid row. */
  wide?: boolean
  actions?: ReactNode
}) {
  return (
    <section className={cn(card, wide && 'col-span-full')}>
      <CardHead>
        <h2 className="mr-auto flex items-center gap-2 text-sm font-semibold">{title}</h2>
        {actions && <div className="flex min-w-0 flex-wrap gap-1.5">{actions}</div>}
      </CardHead>
      <div className="grid gap-2 px-4 py-3">{children}</div>
    </section>
  )
}

export const statCardClass = card
