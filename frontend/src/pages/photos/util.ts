import { dayDiff, fmtDate } from '../../lib/dates'

/** Video length in seconds -> "1:05". */
export function fmtDuration(sec: number | null): string {
  if (!sec || sec < 0) return ''
  const m = Math.floor(sec / 60)
  const s = Math.round(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

/** Day header: "Today", "Yesterday", "Fri, Jul 31" (year added when not this year). */
export function dayLabel(d: Date, now = new Date()): string {
  const diff = dayDiff(d, now)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Yesterday'
  return fmtDate(d, d.getFullYear() === now.getFullYear()
    ? { weekday: 'short', month: 'short', day: 'numeric' }
    : { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
}

export function fmtBytes(kb: number): string {
  if (kb >= 1024 * 1024) return `${(kb / 1024 / 1024).toFixed(1)} GB`
  if (kb >= 1024) return `${Math.round(kb / 1024)} MB`
  return `${kb} KB`
}
