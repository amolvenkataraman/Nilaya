// Right-hand panel of Places: list / Suggested / Stats tabs, and a full detail sheet for the
// selected place (everything the classic page shows: status, stars, visits, distance, address,
// notes, coordinates with copy, directions, and the photos taken there).
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { Icon } from '../../components/Icon'
import { ErrorBox, SkeletonRows } from '../../components/ui'
import { HBars } from '../../components/charts'
import { toast } from '../../components/toast'
import { safeHref } from '../../lib/api'
import { fmtDate, parseDayKey, shortStamp } from '../../lib/dates'
import type { PlaceGroup } from '../../lib/types'
import { STATUSES, distanceM, fmtDistance, usePlacePhotos, usePlaceStats, useSuggestions, type Place, type Suggestion } from './api'

export type Tab = 'places' | 'suggested' | 'stats'
type Pos = { lat: number; lon: number } | null

const day = (iso: string | null | undefined) => (iso ? fmtDate(parseDayKey(iso.slice(0, 10)), { month: 'short', day: 'numeric', year: 'numeric' }) : '')
export const stars = (n: number | null | undefined) => (n ? '★'.repeat(n) + '☆'.repeat(5 - n) : '')

export function PlaceRow({ p, active, onSelect, catLabel, groupName, pos }: {
  p: Place; active: boolean; onSelect: () => void; catLabel: (k: string) => string; groupName: (id: number) => string; pos: Pos
}) {
  const st = STATUSES.find((s) => s.key === p.status)
  const dist = pos ? fmtDistance(distanceM(pos, { lat: p.latitude, lon: p.longitude })) : null
  return (
    <button className={'pl-item-main' + (active ? ' active' : '')} onClick={onSelect} aria-current={active || undefined}>
      <span className="pl-item-title">
        <span className={'pl-status-dot st-' + (p.status ?? 'saved')} aria-hidden="true" />
        <span className="truncate">{p.name}</span>
        {p.rating ? <span className="pl-rating" aria-label={`Rated ${p.rating} of 5`}>{stars(p.rating)}</span> : null}
      </span>
      <span className="pl-item-meta truncate">
        {[catLabel(p.category), st?.label, p.status === 'visited' && p.visited_on ? day(p.visited_on) : '', groupName(p.group_id), dist].filter(Boolean).join(' · ')}
      </span>
      {p.address && <span className="pl-item-addr truncate">{p.address}</span>}
    </button>
  )
}

export function PlaceDetail({ p, catLabel, group, canEdit, pos, onEdit, onClose }: {
  p: Place; catLabel: (k: string) => string; group?: PlaceGroup; canEdit: boolean; pos: Pos; onEdit: () => void; onClose: () => void
}) {
  const photos = usePlacePhotos(p.id)
  const st = STATUSES.find((s) => s.key === p.status)
  const coords = `${p.latitude.toFixed(6)}, ${p.longitude.toFixed(6)}`
  const copy = () => navigator.clipboard?.writeText(coords).then(() => toast.show('Coordinates copied'), () => toast.show(coords))
  const dist = pos ? fmtDistance(distanceM(pos, { lat: p.latitude, lon: p.longitude })) : null
  const ll = `${p.latitude.toFixed(6)},${p.longitude.toFixed(6)}`
  const row = (icon: string, children: ReactNode, key = icon) => (
    <div className="pl-d-row" key={key}><Icon name={icon} size={15} /><div className="grow">{children}</div></div>
  )
  const ph = photos.data
  return (
    <div className="pl-detail">
      <div className="pl-detail-bar">
        <button className="btn ghost sm" onClick={onClose}><Icon name="chevronLeft" size={14} />All places</button>
        <span className="spacer" />
        {canEdit && <button className="btn sm" onClick={onEdit}><Icon name="edit" size={14} />Edit</button>}
      </div>
      <h2 className="pl-d-title">{p.name}</h2>
      <div className="pl-d-chips">
        <span className="chip">{catLabel(p.category)}</span>
        {st && <span className={'chip st-chip st-' + st.key}><Icon name={st.icon} size={11} />{st.label}</span>}
        {p.rating ? <span className="chip pl-stars" aria-label={`Rated ${p.rating} of 5`}>{stars(p.rating)}</span> : null}
        {group && <span className="chip"><Icon name={group.is_public ? 'users' : 'folder'} size={11} />{group.name}</span>}
      </div>
      <div className="pl-d-rows">
        {p.status === 'visited' && p.visited_on && row('check', <>Visited {day(p.visited_on)}</>, 'visited')}
        {dist && row('location', <>{dist} from you</>, 'dist')}
        {p.address && row('pin', <span className="pre-wrap">{p.address}</span>, 'addr')}
        {p.description && row('list', <span className="pre-wrap">{p.description}</span>, 'desc')}
        {p.notes && row('comment', <span className="pre-wrap muted">{p.notes}</span>, 'notes')}
        {row('map', (
          <span className="row" style={{ gap: '0.375rem', flexWrap: 'wrap' }}>
            <code className="pl-coords">{coords}</code>
            {p.altitude != null && <span className="muted xsmall">{Math.round(p.altitude)} m</span>}
            <button className="btn ghost icon sm" onClick={copy} aria-label="Copy coordinates" title="Copy coordinates"><Icon name="copy" size={13} /></button>
          </span>
        ), 'coords')}
        {row('arrowRight', (
          <span className="row" style={{ gap: '0.375rem', flexWrap: 'wrap' }}>
            <a className="btn sm" href={`https://www.openstreetmap.org/directions?to=${ll}`} target="_blank" rel="noopener noreferrer">Directions (OSM)</a>
            <a className="btn sm" href={`https://www.google.com/maps/dir/?api=1&destination=${ll}`} target="_blank" rel="noopener noreferrer">Google Maps</a>
          </span>
        ), 'dir')}
        {p.updated_on && <p className="muted xsmall">Updated {shortStamp(p.updated_on)}</p>}
      </div>

      <section className="pl-d-photos" aria-label="Photos here">
        <div className="pl-d-sec">
          <h3>Photos here</h3>
        </div>
        {photos.isPending ? <SkeletonRows rows={1} /> : !ph ? <ErrorBox error={photos.error} retry={() => photos.refetch()} /> : ph.count === 0 ? (
          <p className="muted small">No photos taken here yet.</p>
        ) : (
          <>
            <p className="small">
              <strong>{ph.count.toLocaleString()}</strong> photos · <strong>{ph.visits}</strong> {ph.visits === 1 ? 'visit' : 'visits'}
              {ph.last_visit && <> · last {day(ph.last_visit)}</>}{ph.first_visit && <> · first {day(ph.first_visit)}</>}
            </p>
            <div className="pl-strip">
              {ph.photos.slice(0, 12).map((x) => {
                const src = safeHref(x.thumb_url)
                return (
                  <Link key={x.id} to={`/photos?photo=${x.id}`} className="pl-thumb" title={x.date_taken ? day(x.date_taken) : ''}>
                    {src && <img src={src} alt="" loading="lazy" decoding="async" />}
                  </Link>
                )
              })}
            </div>
          </>
        )}
      </section>
    </div>
  )
}

export function SuggestedTab({ onSave, onFocus }: { onSave: (s: Suggestion) => void; onFocus: (s: Suggestion) => void }) {
  const q = useSuggestions(true)
  if (q.isPending) return <SkeletonRows rows={5} />
  if (!q.data) return <ErrorBox error={q.error} retry={() => q.refetch()} />
  if (!q.data.length) return <p className="empty left">No suggestions: places you photograph often show up here.</p>
  return (
    <ul className="pl-items">
      <li className="help" style={{ padding: '0.5rem 0.75rem' }}>Spots where you took many photos on several days. Save the ones that matter.</li>
      {q.data.map((s, i) => (
        <li key={i} className="pl-item">
          <button className="pl-item-main" onClick={() => onFocus(s)}>
            <span className="pl-item-title"><span className="pl-status-dot ghost" aria-hidden="true" /><span className="truncate">{s.name}</span></span>
            <span className="pl-item-meta">{s.photos.toLocaleString()} photos · {s.days} days · {day(s.first_day)} – {day(s.last_day)}</span>
            {s.address && <span className="pl-item-addr truncate">{s.address}</span>}
          </button>
          <button className="btn sm pl-save" onClick={() => onSave(s)}><Icon name="plus" size={13} />Save</button>
        </li>
      ))}
    </ul>
  )
}

export function StatsTab({ onSelect, catLabel }: { onSelect: (id: string) => void; catLabel: (k: string) => string }) {
  const q = usePlaceStats(true)
  if (q.isPending) return <SkeletonRows rows={6} />
  if (!q.data) return <ErrorBox error={q.error} retry={() => q.refetch()} />
  const s = q.data
  const total = Math.max(1, s.total)
  return (
    <div className="pl-stats">
      <section>
        <h3>By status <span className="muted">{s.total}</span></h3>
        <div className="pl-stack" role="img" aria-label={STATUSES.map((st) => `${st.label} ${s.by_status[st.key] ?? 0}`).join(', ')}>
          {STATUSES.map((st) => (s.by_status[st.key] ? <span key={st.key} className={'st-' + st.key} style={{ width: `${(s.by_status[st.key] / total) * 100}%` }} /> : null))}
        </div>
        <ul className="pl-stack-legend">
          {STATUSES.map((st) => <li key={st.key}><span className={'pl-status-dot st-' + st.key} />{st.label}<strong className="tabular">{s.by_status[st.key] ?? 0}</strong></li>)}
        </ul>
      </section>
      <section>
        <h3>By category</h3>
        <HBars items={s.by_category.map((c) => ({ key: c.key, label: c.label, value: c.count }))} format={(v) => String(v)} />
      </section>
      <section>
        <h3>Most visited</h3>
        {s.most_visited.length === 0 ? <p className="muted small">No visits yet: they come from photos taken at your places.</p> : (
          <ol className="pl-top">
            {s.most_visited.map((m) => (
              <li key={m.id}>
                <button onClick={() => onSelect(m.id)}>
                  <span className="grow truncate">{m.name}<span className="muted xsmall"> · {catLabel(m.category)}</span></span>
                  <span className="tabular small">{m.visits} visits</span>
                  {m.last_visit && <span className="muted xsmall">last {day(m.last_visit)}</span>}
                </button>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  )
}
