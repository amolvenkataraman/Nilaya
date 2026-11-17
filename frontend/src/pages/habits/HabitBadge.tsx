// How a habit looks: its icon (from the app's icon set; four shapes it lacks are drawn here), its colour as
// --hc (the accent when it has none) and the rounded badge with the icon or the first letter.
// The icon and colour lists are the ones the classic Habits page offered.
import type { CSSProperties, ReactElement } from 'react'
import { Icon } from '../../components/Icon'
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
]

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

/** Shapes components/Icon doesn't have yet, on its 24px grid and stroke (to move there). */
const EXTRA: Record<string, ReactElement> = {
  flame: (
    <path d="M12 21.75c4.2 0 6.75-2.85 6.75-6.6 0-3.6-2.4-5.85-3.9-8.4-.75 1.95-1.8 3-3 3.45.45-3.45-.9-6.3-3.6-7.95.3 3-1.5 5.1-3.15 7.2C3.9 11.1 5.25 13.5 5.25 15.15c0 3.75 2.55 6.6 6.75 6.6z" />
  ),
  skip: <path d="M5.25 5.25v13.5l9-6.75zM18.75 5.25v13.5" />,
  minus: <path d="M4.5 12h15" />,
  pause: <path d="M8.25 5.25v13.5M15.75 5.25v13.5" />,
}
const KNOWN = new Set([...HABIT_ICONS, ...Object.keys(EXTRA)])

/** A habit icon, `size` in rem. */
export function HabitIcon({ name, size = 1 }: { name: string; size?: number }) {
  const s = `${size}rem`
  if (!EXTRA[name]) return <Icon name={name} size={s} />
  return (
    <svg
      width={s}
      height={s}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {EXTRA[name]}
    </svg>
  )
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
      {KNOWN.has(habit.icon) ? <HabitIcon name={habit.icon} size={size * 0.5} /> : <span>{habit.name.slice(0, 1).toUpperCase()}</span>}
    </span>
  )
}
