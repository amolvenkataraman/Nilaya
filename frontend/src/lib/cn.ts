// Class names from conditions: `cn('px-3', active && 'bg-hover', className)`.
// No tailwind-merge (9 kB): when two utilities set the same property, the stylesheet decides, not the
// argument order. So components expose variants as props (size, variant) instead of letting callers override
// their base classes, and a caller's className should only add properties the component doesn't set.
import { clsx, type ClassValue } from 'clsx'

export function cn(...classes: ClassValue[]): string {
  return clsx(classes)
}
