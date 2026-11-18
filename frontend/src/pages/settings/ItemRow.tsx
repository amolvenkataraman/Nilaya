// One configured thing in a list: an icon tile, a title line, a meta line of small facts, extra lines, and
// actions on the right. API keys and calendar feeds use it as rows inside a card (`list`); Notifications'
// delivery channels as a stack of cards (`card`), where the actions drop under the text on phones.
// Built here to replace the old `.item-*` and `.chan-*` families; a candidate for components/ui.
import type { ReactNode } from 'react'
import { cn } from '../../lib/cn'
import { Icon, type IconName } from '../../components/Icon'

export function ItemRow({
  icon,
  title,
  sub,
  meta,
  children,
  actions,
  off = false,
  variant = 'list',
}: {
  icon: IconName
  /** The name, then chips. */
  title: ReactNode
  /** A line under the title (a channel's destination). */
  sub?: ReactNode
  /** Small facts separated by space: created, last used, expiry. */
  meta?: ReactNode
  /** Extra lines under the meta (a key's access chips). */
  children?: ReactNode
  actions?: ReactNode
  /** Disabled or expired: the text dims. */
  off?: boolean
  variant?: 'list' | 'card'
}) {
  const card = variant === 'card'
  return (
    <div
      data-set-row=""
      className={cn(
        'flex gap-3 py-3 pr-3 pl-4',
        card
          ? 'items-center rounded-md border border-border bg-surface shadow-card max-md:flex-wrap max-md:items-start'
          : 'items-start [[data-set-row]+&]:border-t [[data-set-row]+&]:border-border',
      )}
    >
      <span className="grid size-8 shrink-0 place-items-center rounded-sm border border-border bg-surface-2 text-muted" aria-hidden="true">
        <Icon name={icon} />
      </span>
      <div className={cn('grid min-w-0 flex-1', card ? 'gap-0.5 max-md:basis-[calc(100%-2.75rem)]' : 'gap-1', off && 'opacity-60')}>
        <div className="flex min-w-0 items-center gap-2 text-sm font-semibold">{title}</div>
        {sub}
        {meta && <div className={cn('flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted', card && 'min-w-0 items-center')}>{meta}</div>}
        {children}
      </div>
      {actions && <div className={cn('flex shrink-0 items-center', card ? 'gap-2 max-md:w-full max-md:pl-11' : 'gap-1')}>{actions}</div>}
    </div>
  )
}
