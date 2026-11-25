// What the task drawer's property fields share: the save callback's shape, the quiet button that shows a
// value until clicked, the small form inside their popovers, the ghost select, and how a date reads.
import { fieldClass } from '../../components/ui'
import { fmtDate, fmtTime, isEndOfDay } from '../../lib/dates'
import type { TaskPatch } from '../../lib/types'

export type Save = (body: TaskPatch) => void

/** A property's value as a button that looks like text until hovered. */
export const propBtn =
  'inline-flex min-h-8 max-w-full flex-wrap items-center gap-1 rounded-sm border border-transparent bg-transparent px-2 py-0.5 text-left text-sm hover:border-border'
/** The form at the bottom of a property popover (a custom date, repeat or reminder). */
export const popForm = 'grid gap-1.5 px-2 pt-1.5 pb-2'
export const popRow = 'flex items-center gap-1.5'
export const popInput = fieldClass.input({ size: 'sm', className: 'min-w-0' })
export const popSelect = fieldClass.select({ size: 'sm', className: 'min-w-0' })
/** A select that looks like text until hovered (a member's role, a task's project or status). */
export const ghostSelect = fieldClass.select({ variant: 'ghost', width: 'content', className: 'max-w-full' })

/** "Fri, Nov 6, 5:00 PM"; all-day dates (23:59) without the time; the year only when it isn't this one. */
export function fmtWhen(iso: string): string {
  const d = new Date(iso)
  const day = fmtDate(d, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    ...(d.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}),
  })
  return isEndOfDay(d) ? day : `${day}, ${fmtTime(d)}`
}
