// The small muted heading over a block of the person pane, the overview and the merge dialog.
import type { ReactNode } from 'react'
import { cn } from '../../lib/cn'

export function SectionLabel({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('flex gap-1.5 text-xs font-semibold text-muted', className)}>{children}</div>
}
