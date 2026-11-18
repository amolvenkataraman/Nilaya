// The right panel's detail sheets: a place (everything the classic page shows: status, stars, visits, distance,
// address, notes, coordinates with copy, directions, and the photos taken there) and a photo-derived suggestion
// (save, dismiss, the photos near it). CoordsRow and DirectionsLinks are shared by both.
import { type ReactNode, useState } from 'react'
import { Link } from 'react-router'
import { Icon, type IconName } from '../../components/Icon'
import { toast } from '../../components/toast'
import { Button, buttonClass, chipClass, Confirm, ErrorBox, SkeletonRows } from '../../components/ui'
import { cn } from '../../lib/cn'
import { shortStamp } from '../../lib/dates'
import { directionsUrl, distanceM, fmtCoords, fmtDistance, osmUrl } from '../../lib/map/geo'
import { safeHref } from '../../lib/api'
import {
  type Group,
  type Place,
  type PlacePhotos,
  type PlaceStatus,
  STATUSES,
  type Suggestion,
  stars,
  statusOf,
  useDeletePlace,
  usePhotosNear,
  usePlacePhotos,
  useSavePlace,
} from './api'
import { fmtDay, PHOTO_RADIUS_M, photosNear } from './placeText'
import { StatusDot } from './StatusDot'

export type Pos = { lat: number; lon: number } | null

const sheet = 'grid content-start gap-3 overflow-auto px-4 pt-2 pb-6'
const title = 'text-lg font-semibold tracking-[-0.01em] [overflow-wrap:anywhere]'
const linkBtn = buttonClass({ size: 'sm' })

function Row({ icon, children }: { icon: IconName; children: ReactNode }) {
  return (
    <div className="flex items-start gap-2.5 text-sm">
      <Icon name={icon} size={15} className="mt-0.5 flex-none text-muted" />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}

/** Coordinates to 6 decimals in a code chip, the altitude when known, and a copy button. */
export function CoordsRow({ lat, lng, altitude }: { lat: number; lng: number; altitude?: number | null }) {
  const text = fmtCoords(lat, lng, 6)
  return (
    <Row icon="map">
      <span className="flex flex-wrap items-center gap-1.5">
        <code className="rounded-xs bg-surface-2 px-1.5 py-0.5 font-mono text-xs">{text}</code>
        {altitude != null && <span className="text-xs text-muted">{Math.round(altitude)} m</span>}
        <Button
          variant="ghost"
          size="sm"
          icon
          onClick={() => toast.copy(text, 'Coordinates copied')}
          aria-label="Copy coordinates"
          title="Copy coordinates"
        >
          <Icon name="copy" size={13} />
        </Button>
      </span>
    </Row>
  )
}

/** Directions and "View on OSM". A saved place offers both routers; a suggestion only Google's (as before). */
export function DirectionsLinks({ lat, lng, osmDirections = true }: { lat: number; lng: number; osmDirections?: boolean }) {
  const out = { target: '_blank', rel: 'noopener noreferrer' }
  return (
    <Row icon="arrowRight">
      <span className="flex flex-wrap items-center gap-1.5">
        {osmDirections && (
          <a className={linkBtn} href={directionsUrl(lat, lng, 'osm')} {...out}>
            Directions (OSM)
          </a>
        )}
        <a className={linkBtn} href={directionsUrl(lat, lng, 'google')} {...out}>
          {osmDirections ? 'Google Maps' : 'Directions'}
        </a>
        <a className={linkBtn} href={osmUrl(lat, lng)} {...out}>
          View on OSM
        </a>
      </span>
    </Row>
  )
}

export function PlaceDetail({
  p,
  catLabel,
  group,
  canEdit,
  pos,
  onEdit,
  onClose,
  onShowGroup,
}: {
  p: Place
  catLabel: (k: string) => string
  group?: Group
  canEdit: boolean
  pos: Pos
  onEdit: () => void
  onClose: () => void
  onShowGroup?: () => void
}) {
  const photos = usePlacePhotos(p.id)
  const save = useSavePlace()
  const remove = useDeletePlace()
  const [confirm, setConfirm] = useState(false)
  const status = statusOf(p)
  const setStatus = (s: PlaceStatus) => s !== status && save.mutate({ id: p.id, body: { status: s } })
  const st = STATUSES.find((s) => s.key === p.status)
  const dist = pos ? fmtDistance(distanceM(pos, { lat: p.latitude, lon: p.longitude })) : null
  return (
    <div className={sheet}>
      <div className="-mx-2 flex items-center gap-1">
        <Button variant="ghost" size="sm" onClick={onClose}>
          <Icon name="chevronLeft" size={14} />
          All places
        </Button>
        <span className="flex-1" />
        {canEdit && (
          <Button size="sm" onClick={onEdit}>
            <Icon name="edit" size={14} />
            Edit
          </Button>
        )}
        {canEdit && (
          <Button variant="ghost" size="sm" icon onClick={() => setConfirm(true)} aria-label={`Delete ${p.name}`} title="Delete">
            <Icon name="trash" size={14} />
          </Button>
        )}
      </div>
      <Confirm
        open={confirm}
        title={`Delete "${p.name}"?`}
        body="This place will be removed from its group."
        onClose={() => setConfirm(false)}
        onConfirm={() => remove.mutate(p, { onSuccess: onClose })}
      />
      <h2 className={title}>{p.name}</h2>
      {group && (!group.visible || group.archived) && (
        <p className="flex items-center gap-2 rounded-sm bg-surface-2 px-2 py-1.5 text-xs text-muted">
          <Icon name="info" size={13} />
          <span className="flex-1">
            {group.archived
              ? `In ${group.name} (archived): not shown on the map.`
              : `${group.name} is turned off, so this place isn't on the map.`}
          </span>
          {!group.archived && onShowGroup && (
            <Button size="sm" onClick={onShowGroup}>
              Show group
            </Button>
          )}
        </p>
      )}
      {canEdit && (
        <fieldset className="m-0 grid grid-cols-3 gap-0.5 rounded-sm border border-border bg-surface-2 p-0.5" aria-label="Status">
          {STATUSES.map((x) => (
            <button
              key={x.key}
              type="button"
              aria-pressed={status === x.key}
              onClick={() => setStatus(x.key)}
              disabled={save.isPending}
              className={cn(
                'inline-flex h-6.5 items-center justify-center gap-1.5 rounded-xs border-0 px-2.5 text-xs font-medium',
                status === x.key
                  ? 'bg-surface text-fg shadow-[0_1px_2px_rgba(16,24,40,0.08),0_0_0_1px_var(--app-border)]'
                  : 'bg-transparent text-muted hover:text-fg',
              )}
            >
              <StatusDot status={x.key} />
              {x.label}
            </button>
          ))}
        </fieldset>
      )}
      <div className="flex flex-wrap gap-1">
        <span className={chipClass()}>{catLabel(p.category)}</span>
        {st && !canEdit && (
          <span className={chipClass({ tone: st.key === 'visited' ? 'success' : st.key === 'want_to_go' ? 'warning' : 'neutral' })}>
            <Icon name={st.icon} size={11} />
            {st.label}
          </span>
        )}
        {p.rating ? (
          <span className={cn(chipClass(), 'tracking-[-0.05em] text-warning')} role="img" aria-label={`Rated ${p.rating} of 5`}>
            {stars(p.rating)}
          </span>
        ) : null}
        {group && (
          <span className={chipClass()}>
            <Icon name={group.is_public ? 'users' : 'folder'} size={11} />
            {group.name}
          </span>
        )}
      </div>
      <div className="grid gap-2">
        {p.status === 'visited' && p.visited_on && <Row icon="check">Visited {fmtDay(p.visited_on)}</Row>}
        {dist && <Row icon="location">{dist} from you</Row>}
        {p.address && (
          <Row icon="pin">
            <span className="whitespace-pre-wrap [overflow-wrap:anywhere]">{p.address}</span>
          </Row>
        )}
        {p.description && (
          <Row icon="list">
            <span className="whitespace-pre-wrap [overflow-wrap:anywhere]">{p.description}</span>
          </Row>
        )}
        {p.notes && (
          <Row icon="comment">
            <span className="whitespace-pre-wrap text-muted [overflow-wrap:anywhere]">{p.notes}</span>
          </Row>
        )}
        <CoordsRow lat={p.latitude} lng={p.longitude} altitude={p.altitude} />
        <DirectionsLinks lat={p.latitude} lng={p.longitude} />
        {p.updated_on && (
          <p className="text-xs text-muted">
            {group && !group.mine ? `${group.name} (shared, read-only) · ` : ''}Updated {shortStamp(p.updated_on)}
          </p>
        )}
      </div>
      <PhotosHere
        data={photos.data}
        pending={photos.isPending}
        error={photos.error}
        retry={() => photos.refetch()}
        lat={p.latitude}
        lng={p.longitude}
      />
    </div>
  )
}

/** Photos within 150 m: visits summary, thumbnails, and "+N" to the rest in Photos. */
function PhotosHere({
  data: ph,
  pending,
  error,
  retry,
  lat,
  lng,
}: {
  data?: PlacePhotos
  pending: boolean
  error: unknown
  retry: () => void
  lat: number
  lng: number
}) {
  const thumb = 'aspect-square overflow-hidden rounded-xs bg-surface-2'
  return (
    <section className="grid gap-1.5 border-t border-border pt-3" aria-label="Photos here">
      <h3 className="text-sm">
        Photos here <span className="text-xs text-muted">within {PHOTO_RADIUS_M} m</span>
      </h3>
      {pending ? (
        <SkeletonRows rows={1} />
      ) : !ph ? (
        <ErrorBox error={error} retry={retry} />
      ) : ph.count === 0 ? (
        <p className="text-sm text-muted">None of your photos were taken here.</p>
      ) : (
        <>
          <p className="text-sm">
            <strong>{ph.count.toLocaleString()}</strong> photos · <strong>{ph.visits}</strong> {ph.visits === 1 ? 'visit' : 'visits'}
            {ph.last_visit && <> · last {fmtDay(ph.last_visit)}</>}
            {ph.first_visit && ph.visits > 1 && <> · first {fmtDay(ph.first_visit)}</>}
          </p>
          <div className="grid grid-cols-4 gap-[3px]">
            {ph.photos.slice(0, ph.count > 12 ? 11 : 12).map((x) => {
              const src = safeHref(x.thumb_url)
              return (
                <Link key={x.id} to={`/photos?photo=${x.id}`} className={thumb} title={x.date_taken ? fmtDay(x.date_taken) : ''}>
                  {src && <img src={src} alt="" loading="lazy" decoding="async" className="size-full object-cover" />}
                </Link>
              )
            })}
            {ph.count > 12 && (
              <Link
                className={cn(thumb, 'grid place-items-center text-sm font-semibold text-fg hover:bg-hover hover:no-underline')}
                to={photosNear(lat, lng)}
                title="All of them in Photos"
              >
                +{(ph.count - 11).toLocaleString()}
              </Link>
            )}
          </div>
        </>
      )}
    </section>
  )
}

/** A photo-derived suggestion: save it, dismiss it, see the photos taken there. */
export function SuggestionDetail({
  s,
  pos,
  onSave,
  onDismiss,
  onClose,
}: {
  s: Suggestion
  pos: Pos
  onSave: () => void
  onDismiss: () => void
  onClose: () => void
}) {
  const near = usePhotosNear(s.latitude, s.longitude)
  const dist = pos ? fmtDistance(distanceM(pos, { lat: s.latitude, lon: s.longitude })) : null
  return (
    <div className={sheet}>
      <div className="-mx-2 flex items-center gap-1">
        <Button variant="ghost" size="sm" onClick={onClose}>
          <Icon name="chevronLeft" size={14} />
          Suggestions
        </Button>
      </div>
      <h2 className={title}>{s.address || s.name}</h2>
      <p className="text-sm text-muted">
        Suggested · {s.photos.toLocaleString()} photos on {s.days} days · {fmtDay(s.first_day)}
        {s.first_day !== s.last_day ? ` – ${fmtDay(s.last_day)}` : ''}
      </p>
      <div className="flex items-center gap-1.5">
        <Button variant="primary" size="sm" onClick={onSave}>
          <Icon name="plus" size={14} />
          Save place
        </Button>
        <Button size="sm" onClick={onDismiss}>
          Dismiss
        </Button>
      </div>
      <div className="grid gap-2">
        {dist && <Row icon="location">{dist} from you</Row>}
        <CoordsRow lat={s.latitude} lng={s.longitude} />
        <DirectionsLinks lat={s.latitude} lng={s.longitude} osmDirections={false} />
      </div>
      <PhotosHere
        data={near.data}
        pending={near.isPending}
        error={near.error}
        retry={() => near.refetch()}
        lat={s.latitude}
        lng={s.longitude}
      />
    </div>
  )
}
