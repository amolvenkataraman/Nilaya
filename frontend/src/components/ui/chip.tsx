// Small inline pieces: a pill (status, count, label, tag), a key hint and a colour dot. `chipClass` gives the pill
// look to a link or a button (a label toggle, "+15m", a profile link).
import type { ComponentPropsWithRef, CSSProperties, ReactNode } from 'react'
import { cn } from '../../lib/cn'

/** neutral: quiet grey text · content: the same frame with body-coloured text (tags, links that are content). */
export type ChipTone = 'neutral' | 'content' | 'accent' | 'danger' | 'warning' | 'success'
/** md: the default · sm: a notch lower, for meta lines · xs: inside a line of text (a notification's priority). */
export type ChipSize = 'xs' | 'sm' | 'md'

const tones: Record<ChipTone, string> = {
  neutral: 'border-border bg-surface-2 text-muted',
  content: 'border-border bg-surface-2 text-fg',
  accent: 'border-transparent bg-accent-soft text-accent',
  danger: 'border-transparent bg-danger-soft text-danger',
  warning: 'border-transparent bg-warning-soft text-warning',
  success: 'border-transparent bg-success-soft text-success',
}

const sizes: Record<ChipSize, string> = {
  xs: 'h-4 text-3xs',
  sm: 'h-4.5 text-xs',
  md: 'h-5 text-xs',
}

export interface ChipOptions {
  tone?: ChipTone
  size?: ChipSize
  /** Room for a remove button at the end. */
  removable?: boolean
  /** A link or button: hover shows it goes somewhere. */
  interactive?: boolean
}

export function chipClass({ tone = 'neutral', size = 'md', removable = false, interactive = false }: ChipOptions = {}): string {
  return cn(
    'inline-flex items-center rounded-full border py-0 font-medium whitespace-nowrap',
    sizes[size],
    removable ? 'gap-0.5 pr-0.5 pl-1.75' : size === 'xs' ? 'gap-1 px-1.5' : 'gap-1 px-1.75',
    tones[tone],
    interactive && 'cursor-pointer hover:border-accent hover:text-fg hover:no-underline',
  )
}

export function Chip({ tone, size, removable, className, ...p }: ComponentPropsWithRef<'span'> & Omit<ChipOptions, 'interactive'>) {
  return <span className={cn(chipClass({ tone, size, removable }), className)} {...p} />
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
