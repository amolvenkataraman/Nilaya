// Small inline pieces: a pill (status, count, label), a key hint and a colour dot.
import type { ComponentPropsWithRef, CSSProperties, ReactNode } from 'react'
import { cn } from '../../lib/cn'

export type ChipTone = 'neutral' | 'accent' | 'danger' | 'warning' | 'success'

const tones: Record<ChipTone, string> = {
  neutral: 'border-border bg-surface-2 text-muted',
  accent: 'border-transparent bg-accent-soft text-accent',
  danger: 'border-transparent bg-danger-soft text-danger',
  warning: 'border-transparent bg-warning-soft text-warning',
  success: 'border-transparent bg-success-soft text-success',
}

export function Chip({
  tone = 'neutral',
  size = 'md',
  className,
  ...p
}: ComponentPropsWithRef<'span'> & { tone?: ChipTone; size?: 'sm' | 'md' }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border font-medium whitespace-nowrap',
        size === 'sm' ? 'h-4 px-1.5 text-3xs' : 'h-5 px-1.75 text-xs',
        tones[tone],
        className,
      )}
      {...p}
    />
  )
}

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

/** A colour dot (calendar, project, label); grey when no colour is given. */
export function Dot({ colour, className, style }: { colour?: string | null; className?: string; style?: CSSProperties }) {
  return (
    <span
      aria-hidden="true"
      className={cn('size-2 flex-none rounded-full bg-muted', className)}
      style={colour ? { background: colour, ...style } : style}
    />
  )
}
