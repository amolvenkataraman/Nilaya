// Right-hand panel of Places: list / Suggested / Stats tabs, and a full detail sheet for the
// selected place (everything the classic page shows: status, stars, visits, distance, address,
// notes, coordinates with copy, directions, and the photos taken there).
import { useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { Icon } from '../../components/Icon'
import { Confirm, ErrorBox, SkeletonRows } from '../../components/ui'
import { HBars } from '../../components/charts'
import { toast } from '../../components/toast'
import { get, safeHref } from '../../lib/api'
import { fmtDate, parseDayKey, shortStamp } from '../../lib/dates'
import { photosInArea } from '../photos/util'
import { STATUSES, distanceM, fmtDistance, useDeletePlace, usePlacePhotos, usePlaceStats, useSavePlace, type Group, type Pin, type PlacePhotos, type PlaceStatus, type Place, type Suggestion } from './api'

const PHOTO_RADIUS_M = 150
const photosNear = (lat: number, lng: number, r = PHOTO_RADIUS_M) => {
  const dLat = r / 111320
  const dLng = r / (111320 * Math.max(Math.cos((lat * Math.PI) / 180), 0.01))
  return photosInArea(lat + dLat, lat - dLat, lng + dLng, lng - dLng)
}

export type Tab = 'places' | 'suggested' | 'stats'
type Pos = { lat: number; lon: number } | null

const day = (iso: string | null | undefined) => (iso ? fmtDate(parseDayKey(iso.slice(0, 10)), { month: 'short', day: 'numeric', year: 'numeric' }) : '')
export const stars = (n: number | null | undefined) => (n ? '★'.repeat(n) + '☆'.repeat(5 - n) : '')

export function PlaceRow({ p, active, onSelect, catLabel, groupName, pos }: {
  p: Pin; active: boolean; onSelect: () => void; catLabel: (k: string) => string; groupName: (id: number) => string; pos: Pos
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

export function PlaceDetail({ p, catLabel, group, canEdit, pos, onEdit, onClose, onShowGroup }: {
  p: Place; catLabel: (k: string) => string; group?: Group; canEdit: boolean; pos: Pos; onEdit: () => void; onClose: () => void; onShowGroup?: () => void
}) {
  const photos = usePlacePhotos(p.id)
  const save = useSavePlace()
  const remove = useDeletePlace()
  const [confirm, setConfirm] = useState(false)
  const setStatus = (status: PlaceStatus) => status !== (p.status ?? 'saved') && save.mutate({ id: p.id, body: { status } })
  const st = STATUSES.find((s) => s.key === p.status)
  const coords = `${p.latitude.toFixed(6)}, ${p.longitude.toFixed(6)}`
  const copy = () => navigator.clipboard?.writeText(coords).then(() => toast.show('Coordinates copied'), () => toast.show(coords))
  const dist = pos ? fmtDistance(distanceM(pos, { lat: p.latitude, lon: p.longitude })) : null
  const ll = `${p.latitude.toFixed(6)},${p.longitude.toFixed(6)}`
  const row = (icon: string, children: ReactNode, key = icon) => (
    <div className="pl-d-row" key={key}><Icon name={icon} size={15} /><div className="grow">{children}</div></div>
  )
  return (
    <div className="pl-detail">
      <div className="pl-detail-bar">
        <button className="btn ghost sm" onClick={onClose}><Icon name="chevronLeft" size={14} />All places</button>
        <span className="spacer" />
        {canEdit && <button className="btn sm" onClick={onEdit}><Icon name="edit" size={14} />Edit</button>}
        {canEdit && <button className="btn ghost icon sm" onClick={() => setConfirm(true)} aria-label={`Delete ${p.name}`} title="Delete"><Icon name="trash" size={14} /></button>}
      </div>
      <Confirm open={confirm} title={`Delete "${p.name}"?`} body="This place will be removed from its group." onClose={() => setConfirm(false)} onConfirm={() => remove.mutate(p, { onSuccess: onClose })} />
      <h2 className="pl-d-title">{p.name}</h2>
      {group && (!group.visible || group.archived) && (
        <p className="pl-off-note"><Icon name="info" size={13} />
          <span className="grow">{group.archived ? `In ${group.name} (archived): not shown on the map.` : `${group.name} is turned off, so this place isn't on the map.`}</span>
          {!group.archived && onShowGroup && <button className="btn sm" onClick={onShowGroup}>Show group</button>}
        </p>
      )}
      {canEdit && (
        <div className="seg pl-status-seg" role="group" aria-label="Status">
          {STATUSES.map((x) => (
            <button key={x.key} aria-pressed={(p.status ?? 'saved') === x.key} onClick={() => setStatus(x.key)} disabled={save.isPending}>
              <span className={'pl-status-dot st-' + x.key} aria-hidden="true" />{x.label}
            </button>
          ))}
        </div>
      )}
      <div className="pl-d-chips">
        <span className="chip">{catLabel(p.category)}</span>
        {st && !canEdit && <span className={'chip st-chip st-' + st.key}><Icon name={st.icon} size={11} />{st.label}</span>}
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
            <a className="btn sm" href={`https://www.openstreetmap.org/?mlat=${p.latitude.toFixed(6)}&mlon=${p.longitude.toFixed(6)}#map=17/${p.latitude.toFixed(6)}/${p.longitude.toFixed(6)}`} target="_blank" rel="noopener noreferrer">View on OSM</a>
          </span>
        ), 'dir')}
        {p.updated_on && <p className="muted xsmall">{group && !group.mine ? `${group.name} (shared, read-only) · ` : ''}Updated {shortStamp(p.updated_on)}</p>}
      </div>
      <PhotosHere data={photos.data} pending={photos.isPending} error={photos.error} retry={() => photos.refetch()} lat={p.latitude} lng={p.longitude} />
    </div>
  )
}

/** Photos within 150 m: visits summary, thumbnails, and "+N" to the rest in Photos. */
function PhotosHere({ data: ph, pending, error, retry, lat, lng }: { data?: PlacePhotos; pending: boolean; error: unknown; retry: () => void; lat: number; lng: number }) {
  return (
    <section className="pl-d-photos" aria-label="Photos here">
      <div className="pl-d-sec">
        <h3>Photos here <span className="muted xsmall">within {PHOTO_RADIUS_M} m</span></h3>
      </div>
      {pending ? <SkeletonRows rows={1} /> : !ph ? <ErrorBox error={error} retry={retry} /> : ph.count === 0 ? (
        <p className="muted small">None of your photos were taken here.</p>
      ) : (
        <>
          <p className="small">
            <strong>{ph.count.toLocaleString()}</strong> photos · <strong>{ph.visits}</strong> {ph.visits === 1 ? 'visit' : 'visits'}
            {ph.last_visit && <> · last {day(ph.last_visit)}</>}{ph.first_visit && ph.visits > 1 && <> · first {day(ph.first_visit)}</>}
          </p>
          <div className="pl-strip">
            {ph.photos.slice(0, ph.count > 12 ? 11 : 12).map((x) => {
              const src = safeHref(x.thumb_url)
              return (
                <Link key={x.id} to={`/photos?photo=${x.id}`} className="pl-thumb" title={x.date_taken ? day(x.date_taken) : ''}>
                  {src && <img src={src} alt="" loading="lazy" decoding="async" />}
                </Link>
              )
            })}
            {ph.count > 12 && <Link className="pl-thumb pl-more" to={photosNear(lat, lng)} title="All of them in Photos">+{(ph.count - 11).toLocaleString()}</Link>}
          </div>
        </>
      )}
    </section>
  )
}

/** A photo-derived suggestion: save it, dismiss it, see the photos taken there. */
export function SuggestionDetail({ s, pos, onSave, onDismiss, onClose }: { s: Suggestion; pos: Pos; onSave: () => void; onDismiss: () => void; onClose: () => void }) {
  const near = useQuery({
    queryKey: ['places', 'photos-near', s.latitude.toFixed(4), s.longitude.toFixed(4)],
    queryFn: () => get<PlacePhotos>('places/photos-near', { latitude: s.latitude.toFixed(6), longitude: s.longitude.toFixed(6), limit: 12 }),
    staleTime: 30 * 60_000,
  })
  const coords = `${s.latitude.toFixed(6)}, ${s.longitude.toFixed(6)}`
  const ll = `${s.latitude.toFixed(6)},${s.longitude.toFixed(6)}`
  const dist = pos ? fmtDistance(distanceM(pos, { lat: s.latitude, lon: s.longitude })) : null
  return (
    <div className="pl-detail">
      <div className="pl-detail-bar">
        <button className="btn ghost sm" onClick={onClose}><Icon name="chevronLeft" size={14} />Suggestions</button>
      </div>
      <h2 className="pl-d-title">{s.address || s.name}</h2>
      <p className="muted small">Suggested · {s.photos.toLocaleString()} photos on {s.days} days · {day(s.first_day)}{s.first_day !== s.last_day ? ` – ${day(s.last_day)}` : ''}</p>
      <div className="row" style={{ gap: '0.375rem' }}>
        <button className="btn primary sm" onClick={onSave}><Icon name="plus" size={14} />Save place</button>
        <button className="btn sm" onClick={onDismiss}>Dismiss</button>
      </div>
      <div className="pl-d-rows">
        {dist && <div className="pl-d-row"><Icon name="location" size={15} /><div className="grow">{dist} from you</div></div>}
        <div className="pl-d-row"><Icon name="map" size={15} /><div className="grow row" style={{ gap: '0.375rem' }}>
          <code className="pl-coords">{coords}</code>
          <button className="btn ghost icon sm" onClick={() => navigator.clipboard?.writeText(coords).then(() => toast.show('Coordinates copied'), () => toast.show(coords))} aria-label="Copy coordinates" title="Copy coordinates"><Icon name="copy" size={13} /></button>
        </div></div>
        <div className="pl-d-row"><Icon name="arrowRight" size={15} /><div className="grow row" style={{ gap: '0.375rem', flexWrap: 'wrap' }}>
          <a className="btn sm" href={`https://www.google.com/maps/dir/?api=1&destination=${ll}`} target="_blank" rel="noopener noreferrer">Directions</a>
          <a className="btn sm" href={`https://www.openstreetmap.org/?mlat=${s.latitude.toFixed(6)}&mlon=${s.longitude.toFixed(6)}#map=17/${s.latitude.toFixed(6)}/${s.longitude.toFixed(6)}`} target="_blank" rel="noopener noreferrer">View on OSM</a>
        </div></div>
      </div>
      <PhotosHere data={near.data} pending={near.isPending} error={near.error} retry={() => near.refetch()} lat={s.latitude} lng={s.longitude} />

    </div>
  )
}

export function SuggestedTab({ items, pending, error, retry, onSave, onFocus, onDismiss }: {
  items?: Suggestion[]; pending: boolean; error: unknown; retry: () => void
  onSave: (s: Suggestion) => void; onFocus: (s: Suggestion) => void; onDismiss: (s: Suggestion) => void
}) {
  if (pending) return <SkeletonRows rows={5} />
  if (!items) return <ErrorBox error={error} retry={retry} />
  if (!items.length) return <p className="empty left">No suggestions: places you photograph often show up here.</p>
  return (
    <ul className="pl-items">
      <li className="help" style={{ padding: '0.5rem 0.75rem' }}>Spots where you took many photos on several days. Save the ones that matter.</li>
      {items.map((s, i) => (
        <li key={i} className="pl-item">
          <button className="pl-item-main" onClick={() => onFocus(s)}>
            <span className="pl-item-title"><span className="pl-status-dot ghost" aria-hidden="true" /><span className="truncate">{s.name}</span></span>
            <span className="pl-item-meta">{s.photos.toLocaleString()} photos · {s.days} days · {day(s.first_day)} – {day(s.last_day)}</span>
            {s.address && <span className="pl-item-addr truncate">{s.address}</span>}
          </button>
          <button className="btn sm pl-save" onClick={() => onSave(s)}><Icon name="plus" size={13} />Save</button>
          <button className="btn ghost icon sm pl-dismiss" onClick={() => onDismiss(s)} aria-label={`Dismiss ${s.name}`} title="Dismiss"><Icon name="x" size={13} /></button>
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
      <div className="pl-tiles">
        {([['Places', s.total], ['Visited', s.by_status.visited ?? 0], ['Want to go', s.by_status.want_to_go ?? 0]] as const).map(([l, n]) => (
          <div key={l} className="pl-tile"><strong className="tabular">{n.toLocaleString()}</strong><span>{l}</span></div>
        ))}
      </div>
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
        <h3>Most visited <span className="muted xsmall">days with your photos within {PHOTO_RADIUS_M} m</span></h3>
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
