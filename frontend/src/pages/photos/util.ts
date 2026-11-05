import { dayDiff, fmtDate } from '../../lib/dates'

/** Video length in seconds -> "1:05". */
export function fmtDuration(sec: number | null): string {
  if (!sec || sec < 0) return ''
  const t = Math.round(sec)
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60
  const pad = (x: number) => String(x).padStart(2, '0')
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`  // 12:04:29, not 724:29
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
  if (kb >= 1024) return kb < 100 * 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${Math.round(kb / 1024)} MB`
  return `${kb} KB`
}
