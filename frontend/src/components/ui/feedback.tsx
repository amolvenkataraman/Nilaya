// Loading, error and empty states: skeleton rows while a list loads, an error line with Retry when it can't,
// and a quiet message (with an optional next step) when there's nothing to show.
import type { ReactNode } from 'react'
import { cn } from '../../lib/cn'
import { Icon, type IconName } from '../Icon'
import { Button } from './button'

export function SkeletonRows({ rows = 4, avatar = false }: { rows?: number; avatar?: boolean }) {
  return (
    <div role="status" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: placeholders have no identity
        <div key={i} className="flex items-center gap-2 px-4 py-2">
          {avatar && <span className="sk size-4 rounded-full" />}
          <span className="sk sk-line" style={{ width: `${55 + ((i * 17) % 35)}%` }} />
        </div>
      ))}
    </div>
  )
}

export function ErrorBox({ error, retry }: { error: unknown; retry?: () => void }) {
  return (
    <div className="flex items-center gap-2 px-4 py-3 text-sm text-danger" role="alert">
      <Icon name="alert" />
      <span className="grow">{(error as Error)?.message || 'Something went wrong.'}</span>
      {retry && (
        <Button size="sm" onClick={retry}>
          Retry
        </Button>
      )}
    </div>
  )
}

/** Nothing to show yet: a muted line, an icon, and a way forward when there is one. */
export function EmptyState({
  icon,
  children,
  action,
  className,
}: {
  icon?: IconName
  children: ReactNode
  action?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('grid justify-items-center gap-2 p-4 text-center text-sm text-muted', className)}>
      {icon && <Icon name={icon} size={24} />}
      <div>{children}</div>
      {action}
    </div>
  )
}
