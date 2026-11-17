// Priority levels as the Tasks app shows them: none, low, medium, high, urgent (0/5/10/15/20). One place
// for the bucketing, names, colours and text tones that list groups, the bulk bar, the drawer, the table,
// the timeline and the calendar use (candidate for lib/priority.ts).
import { PRIORITIES } from '../../lib/types'

export type PrioLevel = 0 | 5 | 10 | 15 | 20

/** Every level, "None" first. */
export const PRIORITY_OPTIONS: readonly { value: PrioLevel; label: string }[] = [{ value: 0, label: 'None' }, ...PRIORITIES]

/** The level a stored priority belongs to (values between levels round down). */
export const prioLevel = (p: number): PrioLevel => (p >= 20 ? 20 : p >= 15 ? 15 : p >= 10 ? 10 : p >= 5 ? 5 : 0)

export const prioLabel = (p: number): string => PRIORITY_OPTIONS.find((o) => o.value === prioLevel(p))?.label ?? ''

/** Bar and dot colour (timeline, calendar): none and low are both quiet. */
export const prioColour = (p: number): string =>
  ({ 0: 'var(--app-muted)', 5: 'var(--app-muted)', 10: 'var(--app-accent)', 15: 'var(--app-warning)', 20: 'var(--app-danger)' })[
    prioLevel(p)
  ]

/** Text tone for a priority name (menus, table). */
export const prioTone = (p: number): string =>
  ({ 0: 'text-muted', 5: '', 10: 'text-accent', 15: 'text-warning', 20: 'text-danger' })[prioLevel(p)]
