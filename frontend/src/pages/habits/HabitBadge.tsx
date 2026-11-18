// How a habit looks: its icon (from the app's icon set; four shapes it lacks are drawn here), its colour as
// --hc (the accent when it has none) and the rounded badge with the icon or the first letter.
// The icon and colour lists are the ones the classic Habits page offered.
import type { CSSProperties } from 'react'
import { Icon, asIcon, type IconName } from '../../components/Icon'
import type { Habit } from './api'

export const HABIT_ICONS = [
  'drop',
  'book',
  'run',
  'dumbbell',
  'leaf',
  'moon',
  'heart',
  'pen',
  'coffee',
  'sun',
  'brain',
  'ban',
  'music',
  'bed',
] as const satisfies readonly IconName[]

/** '' is the default: the app's accent (teal). */
export const HABIT_COLOURS: [string, string][] = [
  ['', 'Teal'],
  ['#2a78d6', 'Blue'],
  ['#6250d6', 'Violet'],
  ['#e87ba4', 'Pink'],
  ['#e34948', 'Red'],
  ['#eb6834', 'Orange'],
  ['#eda100', 'Yellow'],
  ['#008300', 'Green'],
  ['#1baf7a', 'Aqua'],
]

// flame, skip, minus and pause aren't habit icons but HabitIcon draws them in rows and buttons.
const KNOWN = new Set<string>([...HABIT_ICONS, 'flame', 'skip', 'minus', 'pause'])

/** A habit icon, `size` in rem. */
export function HabitIcon({ name, size = 1 }: { name: IconName; size?: number }) {
  return <Icon name={name} size={`${size}rem`} />
}

/** Style that gives an element the habit's colour as --hc (accent when the habit has none). */
export const hc = (h: Pick<Habit, 'colour'>): CSSProperties => ({ ['--hc' as string]: h.colour || 'var(--app-accent)' })

export function HabitBadge({ habit, size = 2 }: { habit: Habit; size?: number }) {
  return (
    <span
      className={
        'inline-grid flex-none place-items-center rounded-[30%] text-xs font-bold ' +
        'bg-[color-mix(in_srgb,var(--hc)_15%,var(--app-surface))] text-(--hc) ' +
        'dark:bg-[color-mix(in_srgb,var(--hc)_26%,var(--app-surface))] dark:text-[color-mix(in_srgb,var(--hc)_65%,white)]'
      }
      style={{ ...hc(habit), width: `${size}rem`, height: `${size}rem` }}
      aria-hidden="true"
    >
      {KNOWN.has(habit.icon) ? (
        <HabitIcon name={asIcon(habit.icon)} size={size * 0.5} />
      ) : (
        <span>{habit.name.slice(0, 1).toUpperCase()}</span>
      )}
    </span>
  )
}
