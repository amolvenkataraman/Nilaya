// Small pills for a status or a label (Staff, Expired, "Normal and up") and key caps for shortcuts. Built here
// for Settings, Notifications, Users, Home and the public pages while the old `.chip`/`.kbd` classes go away;
// to be replaced by components/ui/chip.tsx (master has Chip, Kbd and Dot there now).
import type { ReactNode } from 'react'
import { cn } from '../../lib/cn'

export type ChipTone = 'default' | 'accent' | 'danger' | 'warning' | 'success'

const tones: Record<ChipTone, string> = {
  default: 'border-border bg-surface-2 text-muted',
  accent: 'border-transparent bg-accent-soft text-accent',
  danger: 'border-transparent bg-danger-soft text-danger',
  warning: 'border-transparent bg-warning-soft text-warning',
  success: 'border-transparent bg-success-soft text-success',
}

export function chipClass(tone: ChipTone = 'default', className?: string, small = false): string {
  return cn(
    'inline-flex items-center gap-1 rounded-full border px-1.75 text-xs font-medium whitespace-nowrap',
    small ? 'h-4.5' : 'h-5',
    tones[tone],
    className,
  )
}

export function Chip({
  tone,
  small,
  className,
  title,
  children,
}: {
  tone?: ChipTone
  /** A notch lower, for meta lines. */
  small?: boolean
  className?: string
  title?: string
  children: ReactNode
}) {
  return (
    <span className={chipClass(tone, className, small)} title={title}>
      {children}
    </span>
  )
}

/** One key cap ("K", "Enter", "⌘"). */
export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        'inline-flex h-4.5 items-center gap-0.5 rounded-xs border border-border bg-surface-2 px-1.25 font-sans text-2xs leading-none font-medium tracking-[0.02em] text-muted',
        className,
      )}
    >
      {children}
    </kbd>
  )
}
