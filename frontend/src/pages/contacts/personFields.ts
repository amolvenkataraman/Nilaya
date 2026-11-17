// How contact fields are worded and parsed: keep-in-touch intervals, relationship labels, birthdays
// (with or without a year). Pure, shared by the list, the person pane, the form and the merge dialog.
import { dayDiff, fmtDate, parseDayKey } from '../../lib/dates'

export const KIT = [
  [0, 'Off'],
  [7, 'Every week'],
  [14, 'Every 2 weeks'],
  [30, 'Every month'],
  [60, 'Every 2 months'],
  [90, 'Every 3 months'],
  [180, 'Every 6 months'],
  [365, 'Every year'],
] as const
export const kitLabel = (d: number) => KIT.find(([k]) => k === d)?.[1] ?? `Every ${d} days`
export const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]
export const relLabel = (k: string) => (k[0]?.toUpperCase() ?? '') + k.slice(1).replace(/_/g, ' ')
export const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s)

/** "1990-05-04" or "--05-04" (no year) -> parts; anything else -> null. */
export function parseBirthday(b: string | null | undefined): { year: string; month: string; day: string } | null {
  const m = /^(\d{4}|-{1,2})-?(\d{2})-(\d{2})$/.exec(b ?? '')
  if (!m) return null
  return { year: /^\d{4}$/.test(m[1]) ? m[1] : '', month: String(Number(m[2])), day: String(Number(m[3])) }
}

/** Build the API birthday string; '' when empty, null when incomplete or impossible. */
export function buildBirthday(year: string, month: string, day: string): string | null {
  if (!month && !day && !year) return ''
  if (!month || !day) return null
  const y = year ? Number(year) : 2000 // 2000 is a leap year, so Feb 29 is fine without a year
  const m = Number(month)
  const d = Number(day)
  if (year && !/^\d{4}$/.test(year)) return null
  const dt = new Date(y, m - 1, d)
  if (dt.getMonth() !== m - 1 || dt.getDate() !== d) return null
  const md = `${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  return year ? `${year}-${md}` : `--${md}`
}

export function fmtBirthday(b: string): string {
  const p = parseBirthday(b)
  if (!p) return b
  const d = new Date(p.year ? Number(p.year) : 2000, Number(p.month) - 1, Number(p.day))
  return fmtDate(d, p.year ? { month: 'long', day: 'numeric', year: 'numeric' } : { month: 'long', day: 'numeric' })
}

/** "Overdue by 3 days", "Due today", "Next catch-up in 5 days" for a keep-in-touch due date. */
export function kitStatus(nextDue: string): string {
  const days = dayDiff(new Date(), parseDayKey(nextDue))
  if (days < 0) return `Overdue by ${-days} day${days === -1 ? '' : 's'}`
  if (days === 0) return 'Due today'
  return `Next catch-up in ${days} day${days === 1 ? '' : 's'}`
}
