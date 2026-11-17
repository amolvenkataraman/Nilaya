// The small rounded label (library, file type, object, status) as Tailwind classes, replacing the global
// `.chip` CSS for Photos and Places. `link` adds the hover look of chips that go somewhere.
import { cn } from '../../lib/cn'

export type ChipTone = 'neutral' | 'accent' | 'danger' | 'warning' | 'success'

const tones: Record<ChipTone, string> = {
  neutral: 'border-border bg-surface-2 text-muted',
  accent: 'border-transparent bg-accent-soft text-accent',
  danger: 'border-transparent bg-danger-soft text-danger',
  warning: 'border-transparent bg-warning-soft text-warning',
  success: 'border-transparent bg-success-soft text-success',
}

export const chipClass = (tone: ChipTone = 'neutral', link = false) =>
  cn(
    'inline-flex h-5 items-center gap-1 rounded-full border px-1.75 text-xs font-medium whitespace-nowrap',
    tones[tone],
    link && 'hover:border-accent hover:text-fg hover:no-underline',
  )
