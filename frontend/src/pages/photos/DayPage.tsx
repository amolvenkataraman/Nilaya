// Photos › one day (/photos/day/YYYY-MM-DD): every photo of that local day, the day's totals and places.
import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { addDays, dayKey, fmtDate, parseDayKey } from '../../lib/dates'
import type { Photo } from '../../lib/types'
import { Icon } from '../../components/Icon'
import { PhotoStream, type Zoom } from './PhotoStream'
import { buttonClass, chipClass } from '../../components/ui'
import { PageHead, pageClass } from './PageHead'
import { dayInfoQuery } from './queries'
import { fmtBytes, plural } from '../../lib/format'

const dayLink =
  'inline-grid h-6 place-items-center rounded-[calc(var(--app-radius-sm)-2px)] px-2 text-muted hover:bg-surface hover:text-fg hover:no-underline'

export function DayPage({ zoom }: { zoom: Zoom }) {
  const { date = '' } = useParams()
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(parseDayKey(date).getTime())
  const day = valid ? parseDayKey(date) : null
  const [items, setItems] = useState<Photo[]>([])
  const totals = useQuery({ ...dayInfoQuery(date, date), enabled: valid }).data?.[date]
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
  if (!day)
    return (
      <div className={pageClass(true)}>
        <PageHead back="/photos" title="Day" />
        <div className="p-4 text-sm text-muted">That isn't a valid date.</div>
      </div>
    )
  const prev = dayKey(addDays(day, -1))
  const next = dayKey(addDays(day, 1))
  const sub = totals
    ? [
        totals.photos ? plural(totals.photos, 'photo') : '',
        totals.videos ? plural(totals.videos, 'video') : '',
        totals.size_kb ? fmtBytes(totals.size_kb) : '',
      ]
        .filter(Boolean)
        .join(' · ') || 'No photos'
    : ' '
  return (
    <div className={pageClass(true)}>
      <PageHead back="/photos" title={fmtDate(day, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })} sub={sub}>
        <nav className="inline-flex gap-0.5 rounded-sm border border-border bg-surface-2 p-0.5" aria-label="Other days">
          <Link to={`/photos/day/${prev}`} className={dayLink} title="Previous day" aria-label="Previous day">
            <Icon name="chevronLeft" size={14} />
          </Link>
          <Link to={`/photos/day/${next}`} className={dayLink} title="Next day" aria-label="Next day">
            <Icon name="chevronRight" size={14} />
          </Link>
        </nav>
        <Link to={`/photos?date=${date}`} className={buttonClass({ size: 'sm' })} title="Open the timeline at this day">
          <Icon name="photo" size={14} />
          <span>In timeline</span>
        </Link>
      </PageHead>
      {places.length > 0 && (
        <nav className="-mt-1 mb-3.5 flex flex-wrap items-center gap-1 text-muted" aria-label="Places this day">
          <Icon name="pin" size={14} />
          {places.slice(0, 12).map((p) => (
            <Link
              key={`${p.city}|${p.country}`}
              className={chipClass({ interactive: true })}
              to={p.city ? `/photos?city=${encodeURIComponent(p.city)}` : `/photos?country=${encodeURIComponent(p.country!)}`}
              title={`${[p.city, p.country].filter(Boolean).join(', ')}: ${plural(p.n, 'item')}`}
            >
              {[p.city, p.country].filter(Boolean).join(', ')} <span className="text-muted">{p.n}</span>
            </Link>
          ))}
          {places.length > 12 && <span className="text-xs text-muted">+{places.length - 12} more</span>}
        </nav>
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
