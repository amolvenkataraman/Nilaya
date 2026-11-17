// Photos › Stats and Storage: the API shapes (GET /photos/stats, GET /photos/storage), their queries, and the
// normalisers that fill in a partial response (an older server or a cached copy) so every section still renders.
import { queryOptions } from '@tanstack/react-query'
import { get } from '../../lib/api'

export const HOUR = 60 * 60_000
export const n = (x: number) => (x ?? 0).toLocaleString()
export const pct = (part: number, whole: number, digits = 1) => (whole > 0 ? `${((part / whole) * 100).toFixed(digits)}%` : '0%')
export const monthKey = (y: number, m: number) => `${y}-${String(m).padStart(2, '0')}`

export interface Series {
  photos: number[]
  videos: number[]
  length_s: number[]
}
export interface MonthCount {
  month: string
  photos: number
  videos: number
  length_s: number
}
export interface Stats {
  totals: {
    total: number
    photos: number
    videos: number
    video_length_s: number
    avg_megapixels: number | null
    first: string | null
    last: string | null
  }
  periods: Record<'week' | 'month' | 'year' | 'ytd', { count: number; previous: number }>
  by_hour: Series
  by_weekday: Series
  by_day_of_month: Series
  by_month_of_year: Series
  by_month: MonthCount[]
  cameras: { make: string | null; model: string | null; count: number }[]
  countries: { name: string; count: number }[]
  cities: { name: string; count: number }[]
}
export interface Bucket {
  count: number
  optimized_kb: number
  total_kb: number
  overhead_kb: number
  length_s: number
}
/** One row of the storage tables: the classic page's columns (KB and seconds). */
export interface Breakdown {
  photo_count: number
  photo_kb: number
  raw_kb: number
  video_count: number
  video_kb: number
  original_kb: number
  video_s: number
  count: number
  optimized_kb: number
  total_kb: number
}
export interface Group {
  name: string | null
  count: number
  videos: number
  total_kb: number
  optimized_kb: number
}
export interface Storage {
  all: Bucket
  photo: Bucket
  video: Bucket
  by_library: (Breakdown & { id: number; name: string })[]
  by_year: (Breakdown & { year: number })[]
  by_month: (Breakdown & { month: string })[]
  undated: Breakdown | null
  by_camera: Group[]
  by_type: Group[]
  largest: { id: string; thumb_url: string; size_kb: number; video: boolean; date_taken: string | null }[]
}

const EMPTY_SERIES: Series = { photos: [], videos: [], length_s: [] }
const BUCKET0: Bucket = { count: 0, optimized_kb: 0, total_kb: 0, overhead_kb: 0, length_s: 0 }

export function statsOf(d: Partial<Stats>): Stats {
  const series = (x: unknown) => (x && typeof x === 'object' && Array.isArray((x as Series).photos) ? (x as Series) : EMPTY_SERIES)
  return {
    totals: { total: 0, photos: 0, videos: 0, video_length_s: 0, avg_megapixels: null, first: null, last: null, ...d.totals },
    periods: {
      week: { count: 0, previous: 0 },
      month: { count: 0, previous: 0 },
      year: { count: 0, previous: 0 },
      ytd: { count: 0, previous: 0 },
      ...d.periods,
    },
    by_hour: series(d.by_hour),
    by_weekday: series(d.by_weekday),
    by_day_of_month: series(d.by_day_of_month),
    by_month_of_year: series(d.by_month_of_year),
    by_month: Array.isArray(d.by_month) ? d.by_month : [],
    cameras: d.cameras ?? [],
    countries: d.countries ?? [],
    cities: d.cities ?? [],
  }
}

export function storageOf(d: Partial<Storage>): Storage {
  const arr = <T>(x: T[] | undefined) => (Array.isArray(x) ? x : [])
  const rows = <T>(x: T[] | undefined) => arr(x).filter((r) => r && typeof (r as unknown as Breakdown).photo_count === 'number')
  return {
    all: { ...BUCKET0, ...d.all },
    photo: { ...BUCKET0, ...d.photo },
    video: { ...BUCKET0, ...d.video },
    by_library: rows(d.by_library),
    by_year: rows(d.by_year),
    by_month: rows(d.by_month),
    undated: d.undated ?? null,
    by_camera: arr(d.by_camera),
    by_type: arr(d.by_type),
    largest: arr(d.largest),
  }
}

export const statsQuery = queryOptions({
  queryKey: ['photos', 'stats', 2],
  queryFn: ({ signal }) => get<Partial<Stats>>('photos/stats', undefined, signal),
  staleTime: HOUR,
})

export const storageQuery = queryOptions({
  queryKey: ['photos', 'storage', 2],
  queryFn: ({ signal }) => get<Partial<Storage>>('photos/storage', undefined, signal),
  staleTime: HOUR,
})

export const sumRows = (rows: Breakdown[]): Breakdown =>
  rows.reduce(
    (a, r) => {
      for (const k of Object.keys(a) as (keyof Breakdown)[]) a[k] += r[k] ?? 0
      return a
    },
    {
      photo_count: 0,
      photo_kb: 0,
      raw_kb: 0,
      video_count: 0,
      video_kb: 0,
      original_kb: 0,
      video_s: 0,
      count: 0,
      optimized_kb: 0,
      total_kb: 0,
    },
  )

/** Every month from the newest to the oldest with items; months without any show as empty rows (like the classic page). */
export function allMonths(rows: (Breakdown & { month: string })[], label: (d: Date) => string) {
  if (!rows.length) return []
  const byKey = new Map(rows.map((r) => [r.month, r]))
  const [y1, m1] = rows[0].month.split('-').map(Number)
  const [y0, m0] = rows[rows.length - 1].month.split('-').map(Number)
  const out: { key: string; name: string; muted: boolean; r: Breakdown }[] = []
  let y = y1
  let m = m1
  while (y > y0 || (y === y0 && m >= m0)) {
    const k = monthKey(y, m)
    const r = byKey.get(k)
    out.push({ key: k, name: label(new Date(y, m - 1, 15)), muted: !r, r: r ?? sumRows([]) })
    if (m === 1) {
      y--
      m = 12
    } else m--
  }
  return out
}
