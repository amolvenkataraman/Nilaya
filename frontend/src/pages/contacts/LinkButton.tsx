// A button that reads like a link ("Add email", a relationship's name): no frame, underline on hover.
import type { ComponentPropsWithRef } from 'react'
import { cn } from '../../lib/cn'

export function LinkButton({
  className,
  plain,
  type = 'button',
  ...props
}: ComponentPropsWithRef<'button'> & {
  /** Body-coloured text instead of the accent (a list of names). */
  plain?: boolean
}) {
  return (
    <button
      type={type}
      className={cn(
        'inline-flex items-center gap-1 justify-self-start border-0 bg-transparent p-0 text-left text-sm hover:underline',
        plain ? 'text-fg' : 'text-accent',
        className,
      )}
      {...props}
    />
  )
}
