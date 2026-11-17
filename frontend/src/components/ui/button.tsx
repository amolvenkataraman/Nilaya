// Buttons. `buttonClass()` gives the same look to anything (a Link, a Base UI trigger's render prop);
// `<Button>` is a native button that defaults to type="button" so it never submits a form by accident.
import type { ComponentPropsWithRef } from 'react'
import { cn } from '../../lib/cn'

export type ButtonVariant = 'default' | 'primary' | 'danger' | 'solid-danger' | 'ghost'
export type ButtonSize = 'sm' | 'md'

const base =
  'inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-sm border text-sm font-medium transition-colors ' +
  'disabled:cursor-default disabled:opacity-55 [&_svg]:shrink-0'

const variants: Record<ButtonVariant, string> = {
  default:
    'border-border bg-surface text-fg hover:not-disabled:bg-[color-mix(in_srgb,var(--app-fg)_5%,var(--app-surface))] active:not-disabled:bg-[color-mix(in_srgb,var(--app-fg)_9%,var(--app-surface))]',
  primary: 'border-accent bg-accent text-accent-fg hover:not-disabled:border-accent-hover hover:not-disabled:bg-accent-hover',
  danger:
    'border-border bg-surface text-danger hover:not-disabled:border-[color-mix(in_srgb,var(--app-danger)_35%,var(--app-border))] hover:not-disabled:bg-danger-soft',
  'solid-danger': 'border-danger bg-danger text-white hover:not-disabled:brightness-95',
  ghost: 'border-transparent bg-transparent text-muted hover:not-disabled:bg-hover hover:not-disabled:text-fg',
}

const sizes: Record<ButtonSize, { text: string; icon: string }> = {
  md: { text: 'h-8 px-3', icon: 'size-8' },
  sm: { text: 'h-7 px-2 text-xs', icon: 'size-7' },
}

export function buttonClass({
  variant = 'default',
  size = 'md',
  icon = false,
  className,
}: {
  variant?: ButtonVariant
  size?: ButtonSize
  icon?: boolean
  className?: string
} = {}): string {
  return cn(base, variants[variant], icon ? sizes[size].icon : sizes[size].text, className)
}

export interface ButtonProps extends ComponentPropsWithRef<'button'> {
  variant?: ButtonVariant
  size?: ButtonSize
  /** Square, icon-only: give it an aria-label. */
  icon?: boolean
}

export function Button({ variant, size, icon, className, type = 'button', ...props }: ButtonProps) {
  return <button type={type} className={buttonClass({ variant, size, icon, className })} {...props} />
}
