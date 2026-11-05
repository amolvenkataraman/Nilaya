// Photos › one day (/photos/day/YYYY-MM-DD): every photo of that local day, the day's totals and places.
import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { get } from '../../lib/api'
import { addDays, dayKey, fmtDate, parseDayKey } from '../../lib/dates'
import type { Photo } from '../../lib/types'
import { Icon } from '../../components/Icon'
import { PhotoStream, type Zoom } from './PhotoStream'
import { PageHead, plural } from './parts'
import { fmtBytes } from './util'

type DayInfo = { photos: number; videos: number; size_kb: number }

export function DayPage({ zoom }: { zoom: Zoom }) {
  const { date = '' } = useParams()
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(date) && !isNaN(parseDayKey(date).getTime())
  const day = valid ? parseDayKey(date) : null
  const [items, setItems] = useState<Photo[]>([])
  const totals = useQuery({
    queryKey: ['photos', 'days', date, date],
    queryFn: () => get<Record<string, DayInfo>>('photos/days', { start: date, end: date }),
    enabled: valid,
    staleTime: 30 * 60_000,
  }).data?.[date]
  const places = useMemo(() => {
    const counts = new Map<string, { city: string | null; country: string | null; n: number }>()
    for (const p of items) {
      if (!p.city && !p.country) continue
      const k = `${p.city ?? ''}|${p.country ?? ''}`
      const c = counts.get(k) ?? { city: p.city, country: p.country, n: 0 }
      c.n++
      counts.set(k, c)
    }
    return [...counts.values()].sort((a, b) => b.n - a.n)
  }, [items])
  if (!day) return <div className="page ph-page"><PageHead back="/photos" title="Day" /><div className="empty left">That isn't a valid date.</div></div>
  const prev = dayKey(addDays(day, -1))
  const next = dayKey(addDays(day, 1))
  const sub = totals
    ? [totals.photos ? plural(totals.photos, 'photo') : '', totals.videos ? plural(totals.videos, 'video') : '', totals.size_kb ? fmtBytes(totals.size_kb) : ''].filter(Boolean).join(' · ') || 'No photos'
    : ' '
  return (
    <div className="page ph-page">
      <PageHead back="/photos" title={fmtDate(day, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })} sub={sub}>
        <div className="seg" role="group" aria-label="Other days">
          <Link to={`/photos/day/${prev}`} className="ph-seg-link" title="Previous day" aria-label="Previous day"><Icon name="chevronLeft" size={14} /></Link>
          <Link to={`/photos/day/${next}`} className="ph-seg-link" title="Next day" aria-label="Next day"><Icon name="chevronRight" size={14} /></Link>
        </div>
        <Link to={`/photos?date=${date}`} className="btn sm" title="Open the timeline at this day"><Icon name="photo" size={14} /><span>In timeline</span></Link>
      </PageHead>
      {places.length > 0 && (
        <div className="ph-places" aria-label="Places this day">
          <Icon name="pin" size={14} />
          {places.slice(0, 12).map((p) => (
            <Link key={`${p.city}|${p.country}`} className="chip" to={p.city ? `/photos?city=${encodeURIComponent(p.city)}` : `/photos?country=${encodeURIComponent(p.country!)}`}
              title={`${[p.city, p.country].filter(Boolean).join(', ')}: ${plural(p.n, 'item')}`}>
              {[p.city, p.country].filter(Boolean).join(', ')} <span className="muted">{p.n}</span>
            </Link>
          ))}
          {places.length > 12 && <span className="muted xsmall">+{places.length - 12} more</span>}
        </div>
      )}
      <PhotoStream
        queryKey={['photos', 'timeline']}
        path="photos/timeline"
        params={{ after: day.toISOString() }}
        startBefore={addDays(day, 1).toISOString()}
        zoom={zoom}
        dayLinks={false}
        onItems={setItems}
        empty="No photos on this day."
      />
    </div>
  )
}
