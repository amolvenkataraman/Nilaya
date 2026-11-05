// Habit icons and colours, the same set as the classic Habits page (habits/static/habits/lib.js),
// plus goal/schedule wording and the client-side schedule rule.
import type { CSSProperties } from 'react'
import type { Habit, Period } from './api'

const PATHS: Record<string, string> = {
  drop: 'M8 2s4.5 4.8 4.5 8a4.5 4.5 0 0 1-9 0C3.5 6.8 8 2 8 2z',
  book: 'M2.5 3c2-.6 3.9-.4 5.5.8 1.6-1.2 3.5-1.4 5.5-.8v10c-2-.6-3.9-.4-5.5.8-1.6-1.2-3.5-1.4-5.5-.8zM8 3.8v10',
  run: 'M9.5 3.5a1 1 0 1 0 0-.01M6 14l2-4 2 2v2.5M5 8l2.5-2.5h3l1.5 2.5h2M8 10 7 6',
  dumbbell: 'M1.5 8h13M4 5v6M12 5v6M2.5 6.5v3M13.5 6.5v3',
  leaf: 'M3 13c0-6 4-10 10.5-10.5C13 9 9 13 3 13zM3 13l6-6',
  moon: 'M13.5 9.5A5.5 5.5 0 1 1 6.5 2.5a4.5 4.5 0 0 0 7 7z',
  heart: 'M8 13.5S2 10 2 6a3 3 0 0 1 6-1 3 3 0 0 1 6 1c0 4-6 7.5-6 7.5z',
  pen: 'M10.5 2.5l3 3-8 8H2.5v-3zM9 4l3 3',
  coffee: 'M3 6h8v4a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3zM11 7h1.5a1.5 1.5 0 0 1 0 3H11M5.5 2.5v1.5M8 2.5v1.5',
  sun: 'M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM8 1v1.5M8 13.5V15M1 8h1.5M13.5 8H15M3 3l1 1M12 12l1 1M3 13l1-1M12 4l1-1',
  brain: 'M8 3v10M8 3a2.5 2.5 0 0 0-4.5 1.5A2.5 2.5 0 0 0 3 9a2.5 2.5 0 0 0 2 4h3M8 3a2.5 2.5 0 0 1 4.5 1.5A2.5 2.5 0 0 1 13 9a2.5 2.5 0 0 1-2 4H8',
  ban: 'M8 14A6 6 0 1 0 8 2a6 6 0 0 0 0 12zM3.8 3.8l8.4 8.4',
  music: 'M6 12V3.5l7-1.5v8.5M6 12a2 2 0 1 1-2-2 2 2 0 0 1 2 2zM13 10.5a2 2 0 1 1-2-2 2 2 0 0 1 2 2z',
  bed: 'M1.5 4v9M1.5 10h13v3M14.5 10V8a2 2 0 0 0-2-2H7v4M4.5 8.5a1.2 1.2 0 1 0 0-.01',
  flame: 'M8 14.5c2.8 0 4.5-1.9 4.5-4.4 0-2.4-1.6-3.9-2.6-5.6-.5 1.3-1.2 2-2 2.3.3-2.3-.6-4.2-2.4-5.3.2 2-1 3.4-2.1 4.8C2.6 7.4 3.5 9 3.5 10.1c0 2.5 1.7 4.4 4.5 4.4z',
  skip: 'M3.5 3.5v9l6-4.5zM12.5 3.5v9',
  minus: 'M3 8h10',
  pause: 'M5.5 3.5v9M10.5 3.5v9',
}
export const HABIT_ICONS = ['drop', 'book', 'run', 'dumbbell', 'leaf', 'moon', 'heart', 'pen', 'coffee', 'sun', 'brain', 'ban', 'music', 'bed']
export const HABIT_COLOURS: [string, string][] = [
  ['', 'Teal'], ['#2a78d6', 'Blue'], ['#6250d6', 'Violet'], ['#e87ba4', 'Pink'], ['#e34948', 'Red'],
  ['#eb6834', 'Orange'], ['#eda100', 'Yellow'], ['#008300', 'Green'], ['#1baf7a', 'Aqua'],
]

export function HIcon({ name, size = 1 }: { name: string; size?: number }) {
  const d = PATHS[name]
  if (!d) return null
  return (
    <svg viewBox="0 0 16 16" width={`${size}rem`} height={`${size}rem`} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  )
}

/** Style that gives an element the habit's colour as --hc (accent when the habit has none). */
export const hc = (h: Pick<Habit, 'colour'>): CSSProperties => ({ ['--hc' as string]: h.colour || 'var(--app-accent)' })

export function HabitBadge({ habit, size = 2 }: { habit: Habit; size?: number }) {
  return (
    <span className="h-badge" style={{ ...hc(habit), width: `${size}rem`, height: `${size}rem` }} aria-hidden="true">
      {PATHS[habit.icon] ? <HIcon name={habit.icon} size={size * 0.5} /> : <span>{habit.name.slice(0, 1).toUpperCase()}</span>}
    </span>
  )
}

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
export const WEEKDAY_LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']
export const WEEKDAY_NAMES = DAY_NAMES

const fmtNum = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0+$/, '').replace(/\.$/, ''))
export { fmtNum }

export function scheduleText(h: Habit): string {
  if (h.schedule === 'weekdays') {
    if (h.weekdays === 127) return 'Every day'
    if (h.weekdays === 31) return 'Weekdays'
    if (h.weekdays === 96) return 'Weekends'
    return DAY_NAMES.filter((_, i) => (h.weekdays >> i) & 1).join(', ')
  }
  if (h.schedule === 'interval') return h.interval === 1 ? 'Every day' : `Every ${h.interval} days`
  return 'Every day'
}

export function goalText(h: Habit): string {
  const per = { day: 'a day', week: 'a week', month: 'a month' }[h.period]
  if (h.kind === 'yesno') {
    if (h.period === 'day') return scheduleText(h)
    return `${fmtNum(h.target)} ${h.target === 1 ? 'time' : 'times'} ${per}`
  }
  const amount = `${fmtNum(h.target)}${h.unit ? ' ' + h.unit : ''}`
  return `${h.goal === 'at_most' ? 'At most' : 'At least'} ${amount} ${per}`
}

export function streakText(n: number, unit: Period): string {
  const u = { day: 'day', week: 'week', month: 'month' }[unit]
  return `${n} ${u}${n === 1 ? '' : 's'}`
}

const parse = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d)
}
export { parse as parseDay }

/** Same rule as habits/service.py is_scheduled (start/end dates + weekdays/interval). */
export function isScheduled(h: Habit, day: string): boolean {
  if (day < h.start_date || (h.end_date && day > h.end_date)) return false
  const d = parse(day)
  if (h.schedule === 'weekdays') return !!((h.weekdays >> ((d.getDay() + 6) % 7)) & 1)
  if (h.schedule === 'interval') {
    const diff = Math.round((d.getTime() - parse(h.start_date).getTime()) / 86_400_000)
    return diff % Math.max(1, h.interval) === 0
  }
  return true
}

/** Does one day's value meet a daily goal? (Week/month goals are judged by the server.) */
export function dayMet(h: Habit, value: number): boolean {
  if (h.goal === 'at_most') return value <= h.target
  const daily = h.period === 'day' ? h.target : 1
  return value >= (h.kind === 'yesno' ? 1 : daily)
}
