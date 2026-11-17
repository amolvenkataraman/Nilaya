// Form fields with one look and one way to show help and errors. `fieldClass` styles a bare input, select or
// textarea where a wrapper doesn't fit (inside a table cell, a menu).
import type { ComponentPropsWithRef, ReactNode } from 'react'
import { cn } from '../../lib/cn'

const control =
  'w-full rounded-sm border border-border bg-surface text-sm text-fg transition-[border-color,box-shadow] ' +
  'placeholder:text-[color-mix(in_srgb,var(--app-muted)_80%,transparent)] hover:border-[color-mix(in_srgb,var(--app-muted)_45%,var(--app-border))] ' +
  'focus:border-accent focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--app-accent)_18%,transparent)] focus:outline-none disabled:opacity-60'

export const fieldClass = {
  input: cn(control, 'h-8 px-2.5'),
  textarea: cn(control, 'min-h-20 resize-y px-2.5 py-2 leading-normal'),
  select: cn(
    control,
    'h-8 appearance-none bg-[length:0.3125rem_0.3125rem] bg-no-repeat pr-7 pl-2.5',
    'bg-[image:linear-gradient(45deg,transparent_50%,var(--app-muted)_50%),linear-gradient(135deg,var(--app-muted)_50%,transparent_50%)]',
    'bg-[position:calc(100%-0.875rem)_52%,calc(100%-0.5625rem)_52%]',
  ),
}

/** A labelled field: the control goes in children; `hint` below it, replaced by `error` when there is one. */
export function Field({
  label,
  hint,
  error,
  children,
  className,
}: {
  label: ReactNode
  hint?: ReactNode
  error?: string | null
  children: ReactNode
  className?: string
}) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: the control is passed in as children
    <label className={cn('grid gap-1.25', className)}>
      <span className="text-xs font-medium text-muted">{label}</span>
      {children}
      {error ? (
        <span className="text-xs text-danger" role="alert">
          {error}
        </span>
      ) : (
        hint && <span className="text-xs text-muted">{hint}</span>
      )}
    </label>
  )
}

export const Input = ({ className, ...p }: ComponentPropsWithRef<'input'>) => <input className={cn(fieldClass.input, className)} {...p} />
export const Textarea = ({ className, ...p }: ComponentPropsWithRef<'textarea'>) => (
  <textarea className={cn(fieldClass.textarea, className)} {...p} />
)
export const Select = ({ className, ...p }: ComponentPropsWithRef<'select'>) => (
  <select className={cn(fieldClass.select, className)} {...p} />
)

/** Two or three fields side by side; stacked on phones. */
export function FieldRow({ children, cols = 2 }: { children: ReactNode; cols?: 2 | 3 }) {
  return <div className={cn('grid gap-3 max-md:grid-cols-1', cols === 3 ? 'grid-cols-3' : 'grid-cols-2')}>{children}</div>
}
