// What the timeline URL asks for, read in one place: the filters drawer writes FILTER_KEYS, the sidebar asks
// whether the view is the plain timeline, and the timeline turns the params into its API filter, its heading
// ("Camera: Pixel 7 · In this map area") and where the stream starts.
import { addDays, parseDayKey } from '../../lib/dates'
import { userDayStart } from '../../lib/preferences'
import { placeText } from '../../lib/format'

/** Params the filters drawer owns (it rewrites all of them on Apply). */
export const FILTER_KEYS = [
  'kind',
  'from',
  'date',
  'camera',
  'camera_make',
  'country',
  'city',
  'objects',
  'min_blur',
  'max_blur',
  'order',
  'north',
  'south',
  'east',
  'west',
] as const
export type FilterKey = (typeof FILTER_KEYS)[number]
/** The map area: four params, one filter. */
export const BOUNDS = ['north', 'south', 'east', 'west'] as const

/** How many filters are on (the Filters button's count). */
export const filterCount = (params: URLSearchParams) =>
  FILTER_KEYS.filter((k) => !(BOUNDS as readonly string[]).includes(k) && params.get(k)).length +
  (BOUNDS.every((k) => params.get(k)) ? 1 : 0)

/** The sidebar's Timeline row is active unless something narrows the view (a date jump or "from" still counts as the timeline). */
const NARROWING = ['kind', 'city', 'country', 'q', 'camera', 'objects', 'after', 'camera_make', 'north', 'min_blur', 'max_blur', 'order']
export const isPlainTimeline = (params: URLSearchParams) => !NARROWING.some((k) => params.get(k))

const validIso = (v: string | null) => (v && v.length <= 40 && !Number.isNaN(Date.parse(v)) ? new Date(v) : null)
const dayParam = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '')

export type ApiFilter = Record<string, string | number | boolean | undefined>

export interface TimelineState {
  videos: boolean
  /** "San Francisco · Camera: Pixel 7 · In this map area" (empty when no such filter is on). */
  place: string
  oldest: boolean
  /** ?after=&before= (an event's photos, linked from Calendar) and its title. */
  after: Date | null
  before: Date | null
  eventTitle: string
  /** ?from=YYYY-MM-DD (filters): from that day's start. */
  fromKey: string
  /** ?date=YYYY-MM-DD: start the timeline at the end of that day. */
  day: Date | null
  /** Query params for GET /photos/timeline (undefined: none). */
  filter: ApiFilter | undefined
  /** The stream's first cursor. */
  startBefore: string | undefined
}

/** dayStartMin: when the user's day begins (photo days run from it to the next day's). */
export function parseTimelineState(params: URLSearchParams, dayStartMin: number): TimelineState {
  const str = (k: string, max: number) => (params.get(k) ?? '').slice(0, max)
  const num = (k: string) => {
    const v = params.get(k)
    return v && Number.isFinite(Number(v)) ? Number(v) : undefined
  }
  const videos = params.get('kind') === 'videos'
  const city = str('city', 128)
  const country = str('country', 64)
  const camera = str('camera', 128)
  const objects = str('objects', 256)
  const make = str('camera_make', 64)
  const [north, south, east, west] = BOUNDS.map(num)
  const area = north !== undefined && south !== undefined && east !== undefined && west !== undefined
  const minBlur = num('min_blur')
  const maxBlur = num('max_blur')
  const oldest = params.get('order') === 'oldest'
  const after = validIso(params.get('after'))
  const before = validIso(params.get('before'))
  const fromKey = dayParam(params.get('from'))
  const dateKey = dayParam(params.get('date'))
  const day = dateKey ? parseDayKey(dateKey) : null

  const filter: ApiFilter = {}
  if (videos) filter.video = true
  if (city) filter.city = city
  if (country) filter.country = country
  if (camera) filter.camera = camera
  if (objects) filter.objects = objects
  if (make) filter.camera_make = make
  if (area) Object.assign(filter, { north, south, east, west })
  if (minBlur !== undefined) filter.min_blur = minBlur
  if (maxBlur !== undefined) filter.max_blur = maxBlur
  if (oldest) filter.order = 'oldest'
  const rangeStart = after ?? (fromKey ? userDayStart(parseDayKey(fromKey), dayStartMin) : null)
  if (rangeStart) filter.after = rangeStart.toISOString()

  const sharp =
    minBlur === undefined && maxBlur === undefined
      ? ''
      : `Sharpness ${minBlur !== undefined && maxBlur !== undefined ? `${minBlur}–${maxBlur}` : minBlur !== undefined ? `over ${minBlur}` : `under ${maxBlur}`}`
  const place = [
    placeText(city || country || ''),
    camera && `Camera: ${camera}`,
    make && `Make: ${make}`,
    objects?.split(',').join(', '),
    area && 'In this map area',
    sharp,
  ]
    .filter(Boolean)
    .join(' · ')
  // Oldest first pages forward in time from the start of the range (the cursor is the last item shown).
  const dayEnd = day ? userDayStart(addDays(day, 1), dayStartMin) : null
  const startBefore = oldest ? undefined : (before ?? dayEnd)?.toISOString()
  return {
    videos,
    place,
    oldest,
    after,
    before,
    eventTitle: (params.get('title') ?? '').trim().slice(0, 200),
    fromKey,
    day,
    filter: Object.keys(filter).length ? filter : undefined,
    startBefore,
  }
}
