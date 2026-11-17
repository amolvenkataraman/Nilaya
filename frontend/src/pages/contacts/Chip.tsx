// A small rounded label (a tag, a status, a profile link). `chipClass` gives the same look to a link.
// Built here for Contacts; meant for components/ui once other apps drop their own chip classes.
import type { ReactNode } from 'react'
import { cn } from '../../lib/cn'

export type ChipTone = 'default' | 'neutral' | 'accent' | 'danger' | 'warning' | 'success'

const tones: Record<ChipTone, string> = {
  default: 'border-border bg-surface-2 text-muted',
  /** Same frame, body-coloured text: for chips that are content (tags in a form, profile links). */
  neutral: 'border-border bg-surface-2 text-fg',
  accent: 'border-transparent bg-accent-soft text-accent',
  danger: 'border-transparent bg-danger-soft text-danger',
  warning: 'border-transparent bg-warning-soft text-warning',
  success: 'border-transparent bg-success-soft text-success',
}

export function chipClass(tone: ChipTone = 'default', removable = false, className?: string): string {
  return cn(
    'inline-flex h-5 items-center whitespace-nowrap rounded-full border text-xs font-medium',
    removable ? 'gap-0.5 pr-0.5 pl-1.75' : 'gap-1 px-1.75',
    tones[tone],
    className,
  )
}

export function Chip({
  tone,
  removable,
  title,
  className,
  children,
}: {
  tone?: ChipTone
  /** Room for a remove button at the end. */
  removable?: boolean
  title?: string
  className?: string
  children: ReactNode
}) {
  return (
    <span className={chipClass(tone, removable, className)} title={title}>
      {children}
    </span>
  )
}
