// Class names: clsx for conditions, tailwind-merge so a caller's class overrides a component's default
// (`cn('px-3', props.className)` with `px-1` gives `px-1`). tailwind-merge is told the app's own scale names
// (text-2xs, text-md, rounded-xs, shadow-pop, ...), otherwise it would read `text-2xs` as a colour and
// drop it next to `text-muted`.
import { clsx, type ClassValue } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

const merge = extendTailwindMerge({
  override: {
    theme: {
      text: ['3xs', '2xs', 'xs', 'sm', 'base', 'md', 'lg', 'xl'],
      color: [
        'transparent',
        'current',
        'white',
        'black',
        'bg',
        'surface',
        'surface-2',
        'fg',
        'muted',
        'border',
        'accent',
        'accent-hover',
        'accent-fg',
        'accent-soft',
        'danger',
        'danger-soft',
        'warning',
        'warning-soft',
        'success',
        'success-soft',
        'hover',
        'scrim',
      ],
      radius: ['xs', 'sm', 'md', 'full'],
      shadow: ['card', 'pop'],
      breakpoint: ['sm', 'md', 'lg', 'xl', '2xl'],
    },
  },
})

export function cn(...classes: ClassValue[]): string {
  return merge(clsx(classes))
}
