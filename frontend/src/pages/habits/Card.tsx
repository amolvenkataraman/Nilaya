// The framed surface Habits lays its lists and stats on, with an optional titled head. Same look as the
// dashboard cards, so Habits' dashboard card fits in; meant to become the shared card (DashCard) later.
import type { ReactNode } from 'react'
import { cn } from '../../lib/cn'

export const cardClass = 'min-w-0 rounded-md border border-border bg-surface shadow-card'

export function CardHead({ id, title, children }: { id?: string; title: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex min-h-11 items-center gap-2 border-b border-border py-2 pr-2 pl-4">
      <h2 id={id} className="flex items-center gap-2 text-sm font-semibold">
        {title}
      </h2>
      {children}
    </div>
  )
}

/** A card with a head and a padded body (the habit page's sections). */
export function Card({
  id,
  title,
  action,
  bodyClass,
  children,
}: {
  id: string
  title: ReactNode
  action?: ReactNode
  bodyClass?: string
  children: ReactNode
}) {
  return (
    <section className={cardClass} aria-labelledby={id}>
      <CardHead id={id} title={title}>
        {action}
      </CardHead>
      <div className={cn('overflow-hidden', bodyClass ?? 'px-4 py-3')}>{children}</div>
    </section>
  )
}
