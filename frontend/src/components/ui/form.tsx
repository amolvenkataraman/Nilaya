// Form fields with one look and one way to show help and errors. `fieldClass` styles a bare input, select or
// textarea where a wrapper doesn't fit (inside a table cell, a menu). Sizes and widths are options, so a caller never
// overrides the height or width with `!`.
import type { ComponentPropsWithRef, ReactNode } from 'react'
import { cn } from '../../lib/cn'

/** sm sits beside small buttons (h-7, text-xs); xs fits a dense cell; lg is a title (an event's name). */
export type FieldSize = 'xs' | 'sm' | 'md' | 'lg'
/** fill: the column's width · content: no width of its own (a select fits its options; className may set one) ·
 *  fill-phone: full width on phones, content beside a label on desktop. */
export type FieldWidth = 'fill' | 'content' | 'fill-phone'
/** ghost: no frame until hovered, for a value that reads as text (a task's status in the drawer). */
export type FieldVariant = 'default' | 'ghost'

export interface FieldOptions {
  size?: FieldSize
  width?: FieldWidth
  variant?: FieldVariant
  className?: string
}

const base =
  'rounded-sm border text-fg transition-[border-color,box-shadow] placeholder:text-[color-mix(in_srgb,var(--app-muted)_80%,transparent)] ' +
  'focus:border-accent focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--app-accent)_18%,transparent)] focus:outline-none disabled:opacity-60'

const variants: Record<FieldVariant, string> = {
  default: 'border-border-strong bg-surface hover:border-muted',
  ghost: 'border-transparent bg-transparent hover:border-border',
}

const heights: Record<FieldSize, string> = { xs: 'h-6 text-xs', sm: 'h-7 text-xs', md: 'h-8 text-sm', lg: 'h-10 text-md font-medium' }
const widths: Record<FieldWidth, string> = { fill: 'w-full', content: '', 'fill-phone': 'max-md:w-full' }

const control = ({ size = 'md', width = 'fill', variant = 'default' }: FieldOptions) =>
  cn(base, variants[variant], heights[size], widths[width])

const arrow =
  'appearance-none bg-[length:0.3125rem_0.3125rem] bg-no-repeat ' +
  'bg-[image:linear-gradient(45deg,transparent_50%,var(--app-muted)_50%),linear-gradient(135deg,var(--app-muted)_50%,transparent_50%)] ' +
  'bg-[position:calc(100%-0.875rem)_52%,calc(100%-0.5625rem)_52%]'

export type TextareaSize = 'xs' | 'sm' | 'md' | 'lg'
const textareaHeights: Record<TextareaSize, string> = { xs: 'min-h-10', sm: 'min-h-14', md: 'min-h-20', lg: 'min-h-24' }

export const fieldClass = {
  input: (o: FieldOptions = {}) => cn(control(o), o.size === 'xs' ? 'px-1.25' : 'px-2.5', o.className),
  select: (o: FieldOptions = {}) => cn(control(o), arrow, 'pr-7 pl-2.5', o.className),
  /** xs: a comment box (min 2.5rem) · sm: a short note (3.5rem) · md: a description (5rem) · lg: a task's notes (6rem). */
  textarea: ({ size = 'md', className }: { size?: TextareaSize; className?: string } = {}) =>
    cn(base, variants.default, 'w-full resize-y px-2.5 py-2 text-sm leading-normal', textareaHeights[size], className),
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

type FieldProps<E extends 'input' | 'select'> = Omit<ComponentPropsWithRef<E>, 'size' | 'width'> & Omit<FieldOptions, 'className'>

export const Input = ({ size, width, variant, className, ...p }: FieldProps<'input'>) => (
  <input className={fieldClass.input({ size, width, variant, className })} {...p} />
)
export const Select = ({ size, width, variant, className, ...p }: FieldProps<'select'>) => (
  <select className={fieldClass.select({ size, width, variant, className })} {...p} />
)
export const Textarea = ({ size, className, ...p }: ComponentPropsWithRef<'textarea'> & { size?: TextareaSize }) => (
  <textarea className={fieldClass.textarea({ size, className })} {...p} />
)

/** Two or three fields side by side; stacked on phones. */
export function FieldRow({ children, cols = 2 }: { children: ReactNode; cols?: 2 | 3 }) {
  return <div className={cn('grid gap-3 max-md:grid-cols-1', cols === 3 ? 'grid-cols-3' : 'grid-cols-2')}>{children}</div>
}
