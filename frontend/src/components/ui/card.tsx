// A bordered surface with an optional titled head and a padded body: Home's cards, Usage, profile pages, the habit
// page's sections and the public pages.
import type { ComponentPropsWithRef, ReactNode } from 'react'
import { Link } from 'react-router'
import { cn } from '../../lib/cn'
import { Icon, type IconName } from '../Icon'
import { buttonClass } from './button'

export const cardClass = 'min-w-0 rounded-md border border-border bg-surface shadow-card'

export function Card({ className, ...props }: ComponentPropsWithRef<'section'>) {
  return <section className={cn(cardClass, className)} {...props} />
}

/** The head row: a title (with an optional icon), then whatever goes on the right (count, links, buttons). */
export function CardHead({
  title,
  icon,
  titleId,
  children,
}: {
  title: ReactNode
  icon?: IconName
  titleId?: string
  children?: ReactNode
}) {
  return (
    <div className="flex min-h-11 items-center gap-2 border-b border-border py-2 pr-2 pl-4">
      <h2 id={titleId} className="flex items-center gap-2 text-sm font-semibold">
        {icon && <Icon name={icon} className="text-muted" />}
        {title}
      </h2>
      {children}
    </div>
  )
}

/** Muted text in a card head ("3/5", "page views · API calls"). */
export function CardCount({ children }: { children: ReactNode }) {
  return <span className="text-xs font-medium text-muted tabular-nums">{children}</span>
}

/** A quiet "go there" link at the right of a card head ("Calendar ›"). */
export function CardLink({ to, children, label }: { to: string; children?: ReactNode; label?: string }) {
  return (
    <Link
      to={to}
      aria-label={label}
      className={buttonClass({ variant: 'ghost', size: 'sm', icon: !children, className: 'hover:no-underline' })}
    >
      {children}
      {/* The button's gap is wider than this link wants between the label and its chevron. */}
      <Icon name="chevronRight" size={14} className={children ? '-ml-1' : undefined} />
    </Link>
  )
}

export function CardBody({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('px-4 py-3', className)}>{children}</div>
}

/** A card with a head and a padded body in one: the common case (the habit page's sections). */
export function TitledCard({
  titleId,
  title,
  icon,
  action,
  bodyClass = 'px-4 py-3',
  children,
}: {
  titleId: string
  title: ReactNode
  icon?: IconName
  action?: ReactNode
  /** Replaces the body's padding. */
  bodyClass?: string
  children: ReactNode
}) {
  return (
    <section className={cardClass} aria-labelledby={titleId}>
      <CardHead titleId={titleId} title={title} icon={icon}>
        {action}
      </CardHead>
      <div className={cn('overflow-hidden', bodyClass)}>{children}</div>
    </section>
  )
}
