// A place's status as a small dot (list rows, search results, the status switch, the stats legend), in the same
// tokens as the map pins: accent for saved, warning for want to go, success for visited. `ghost` is a dashed
// ring for a photo-derived suggestion.
import { cn } from '../../lib/cn'
import type { PlaceStatus } from './api'

export const STATUS_BG: Record<PlaceStatus, string> = { saved: 'bg-accent', want_to_go: 'bg-warning', visited: 'bg-success' }

export function StatusDot({ status, ghost = false }: { status?: PlaceStatus; ghost?: boolean }) {
  return (
    <span
      className={cn(
        'size-2 flex-none rounded-full',
        ghost ? 'border-[1.5px] border-dashed border-accent bg-transparent' : STATUS_BG[status ?? 'saved'],
      )}
      aria-hidden="true"
    />
  )
}
