// Small pure helpers shared by the Contacts views.
import { fmtDate } from '../../lib/dates'

export const KIT = [[0, 'Off'], [7, 'Every week'], [14, 'Every 2 weeks'], [30, 'Every month'], [60, 'Every 2 months'], [90, 'Every 3 months'], [180, 'Every 6 months'], [365, 'Every year']] as const
export const kitLabel = (d: number) => KIT.find(([k]) => k === d)?.[1] ?? `Every ${d} days`
export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
export const relLabel = (k: string) => (k[0]?.toUpperCase() ?? '') + k.slice(1).replace(/_/g, ' ')
export const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s)
export const plural = (n: number, word: string, many = word + 's') => `${n.toLocaleString()} ${n === 1 ? word : many}`

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

// The app-wide "g then a letter" jump (Shell) shares letters with page shortcuts (g n, g t, g s…):
// page shortcuts ignore the key that follows a "g".
let gAt = 0
if (typeof window !== 'undefined') {
  window.addEventListener('keydown', (e) => {
    const el = e.target as HTMLElement | null
    if (e.key === 'g' && !e.metaKey && !e.ctrlKey && !e.altKey && !(el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)))) gAt = Date.now()
  }, true)
}
export const afterG = (e: KeyboardEvent) => e.key !== 'g' && Date.now() - gAt < 900
