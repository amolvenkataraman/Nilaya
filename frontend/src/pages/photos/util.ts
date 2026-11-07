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

/** Total duration in seconds -> always h:mm:ss ("0:04:05", "123:04:05"), like the classic Storage page. */
export function fmtHms(sec: number): string {
  const t = Math.max(0, Math.round(sec || 0))
  const pad = (x: number) => String(x).padStart(2, '0')
  return `${Math.floor(t / 3600)}:${pad(Math.floor((t % 3600) / 60))}:${pad(t % 60)}`
}

/** Size in KB -> "812 KB", "4.2 MB", "312 MB", "18.4 GB", "1.24 TB". */
/** precise: the classic Storage page's precision (GB with 2 decimals, MB with 1). */
export function fmtBytes(kb: number, precise = false): string {
  if (kb < 0) return '−' + fmtBytes(-kb, precise)
  if (kb >= 1024 ** 3) return `${(kb / 1024 ** 3).toFixed(2)} TB`
  if (kb >= 1024 * 1024) return `${(kb / 1024 / 1024).toFixed(precise ? 2 : 1)} GB`
  if (precise) return `${(kb / 1024).toFixed(1)} MB`
  if (kb >= 1024) return kb < 100 * 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${Math.round(kb / 1024)} MB`
  return `${kb} KB`
}

/** The timeline filtered to a map area (GET /photos/timeline?north=&south=&east=&west=). Longitudes are
 *  wrapped into ±180 (a box across the date line has west > east); a box wider than the world is all of it. */
export function photosInArea(north: number, south: number, east: number, west: number): string {
  const wrap = (v: number) => ((((v + 180) % 360) + 360) % 360) - 180
  const whole = east - west >= 360
  const r = (v: number) => v.toFixed(5)
  return `/photos?north=${r(Math.min(90, north))}&south=${r(Math.max(-90, south))}&east=${r(whole ? 180 : wrap(east))}&west=${r(whole ? -180 : wrap(west))}`
}
