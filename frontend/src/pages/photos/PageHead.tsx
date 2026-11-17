// The page frame and heading every Photos screen uses: a padded column (`pageClass`) and a title row with an
// optional back link, a muted subtitle and actions on the right.
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { Icon } from '../../components/Icon'
import { buttonClass } from '../../components/ui'
import { cn } from '../../lib/cn'

/** A page's padded column. `wide` lets it use the whole width (the timeline, grids, tables). */
export const pageClass = (wide = false) =>
  cn('mx-auto w-full px-6 pt-5 pb-8 max-md:px-4 max-md:pt-3.5 max-md:pb-6', !wide && 'max-w-[96rem]')

export function PageHead({
  title,
  sub,
  children,
  back,
  className = 'mb-3',
}: {
  title: ReactNode
  sub?: ReactNode
  children?: ReactNode
  back?: string
  /** The space below (default mb-3). */
  className?: string
}) {
  return (
    <div className={cn('flex flex-wrap items-center gap-3', className)}>
      {back && (
        <Link to={back} className={buttonClass({ variant: 'ghost', icon: true })} aria-label="Back" title="Back">
          <Icon name="chevronLeft" size={18} />
        </Link>
      )}
      <div className="min-w-0 flex-auto">
        <h1 className="truncate">{title}</h1>
        {sub && <p className="text-sm text-muted tabular-nums">{sub}</p>}
      </div>
      {children}
    </div>
  )
}
