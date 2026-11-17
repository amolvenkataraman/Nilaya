// The right panel's lists: your places (filter summary, rows rendered in pages of 500 so a big set doesn't make
// every map move janky, an edit button per row you can change) and the photo-derived suggestions.
import { useState } from 'react'
import { Icon } from '../../components/Icon'
import { Button, ErrorBox, SkeletonRows } from '../../components/ui'
import { cn } from '../../lib/cn'
import { distanceM, fmtDistance } from '../../lib/map/geo'
import { type Pin, STATUSES, type Suggestion, stars, statusOf } from './api'
import type { Pos } from './PlaceDetail'
import { fmtDay } from './placeText'
import { StatusDot } from './StatusDot'

const items = 'flex-1 overflow-auto p-1 max-md:overflow-visible'
const item = 'group/item flex items-start gap-1 rounded-sm hover:bg-hover'
const main = 'grid min-w-0 flex-1 gap-px rounded-sm border-0 bg-transparent py-2 pr-1 pl-3 text-left'
const itemTitle = 'flex min-w-0 items-center gap-2 text-sm font-medium'
const meta = 'truncate text-xs text-muted'

function PlaceRow({
  p,
  active,
  onSelect,
  catLabel,
  groupName,
  pos,
}: {
  p: Pin
  active: boolean
  onSelect: () => void
  catLabel: (k: string) => string
  groupName: (id: number) => string
  pos: Pos
}) {
  const st = STATUSES.find((s) => s.key === p.status)
  const dist = pos ? fmtDistance(distanceM(pos, { lat: p.latitude, lon: p.longitude })) : null
  return (
    <button type="button" className={main} onClick={onSelect} aria-current={active || undefined}>
      <span className={cn(itemTitle, active && 'text-accent')}>
        <StatusDot status={statusOf(p)} />
        <span className="truncate">{p.name}</span>
        {p.rating ? (
          <span
            className="ml-auto inline-flex flex-none items-center gap-0.5 text-xs tracking-[-0.05em] text-warning tabular-nums"
            role="img"
            aria-label={`Rated ${p.rating} of 5`}
          >
            {stars(p.rating)}
          </span>
        ) : null}
      </span>
      <span className={meta}>
        {[catLabel(p.category), st?.label, p.status === 'visited' && p.visited_on ? fmtDay(p.visited_on) : '', groupName(p.group_id), dist]
          .filter(Boolean)
          .join(' · ')}
      </span>
      {p.address && <span className={meta}>{p.address}</span>}
    </button>
  )
}

export function PlacesList({
  places,
  total,
  filtered,
  loading,
  error,
  retry,
  emptyText,
  selected,
  pos,
  catLabel,
  groupName,
  canEdit,
  onSelect,
  onEdit,
  onPrefetch,
  onClear,
}: {
  places: Pin[]
  /** Places in the groups that are on (the "of N" in the summary). */
  total: number
  filtered: boolean
  loading: boolean
  error: unknown
  retry: () => void
  emptyText: string
  selected: string | null
  pos: Pos
  catLabel: (k: string) => string
  groupName: (id: number) => string
  canEdit: (p: Pin) => boolean
  onSelect: (id: string) => void
  onEdit: (p: Pin) => void
  onPrefetch: (id: string) => void
  onClear: () => void
}) {
  const [limit, setLimit] = useState(200)
  return (
    <>
      {filtered && (
        <div className="flex h-11 flex-none items-center gap-2 border-b border-border pr-2 pl-4">
          <h2 className="flex-1 text-sm text-muted">
            {places.length} of {total} shown{pos ? ' · nearest first' : ''}
          </h2>
          <Button variant="ghost" size="sm" onClick={onClear}>
            Clear filters
          </Button>
        </div>
      )}
      {loading ? (
        <SkeletonRows rows={6} />
      ) : error ? (
        <ErrorBox error={error} retry={retry} />
      ) : !places.length ? (
        <div className="p-4 text-sm text-muted">{emptyText}</div>
      ) : (
        <ul className={items}>
          {places.slice(0, limit).map((p) => {
            const active = selected === p.id
            return (
              <li key={p.id} className={cn(item, active && 'bg-accent-soft')} onPointerEnter={() => onPrefetch(p.id)}>
                <PlaceRow p={p} active={active} onSelect={() => onSelect(p.id)} catLabel={catLabel} groupName={groupName} pos={pos} />
                {canEdit(p) && (
                  <Button
                    variant="ghost"
                    size="sm"
                    icon
                    className={cn(
                      'mt-1.5 mr-1',
                      active ? 'opacity-100' : 'opacity-0 group-hover/item:opacity-100 focus-visible:opacity-100 touch:opacity-100',
                    )}
                    onClick={() => onEdit(p)}
                    aria-label={`Edit ${p.name}`}
                    title="Edit"
                  >
                    <Icon name="edit" size={14} />
                  </Button>
                )}
              </li>
            )
          })}
          {places.length > limit && (
            <li className="flex justify-center p-2">
              <Button size="sm" onClick={() => setLimit((l) => l + 500)}>
                Show {Math.min(500, places.length - limit).toLocaleString()} more of {(places.length - limit).toLocaleString()}
              </Button>
            </li>
          )}
        </ul>
      )}
    </>
  )
}

export function SuggestedTab({
  items: list,
  pending,
  error,
  retry,
  onSave,
  onFocus,
  onDismiss,
}: {
  items?: Suggestion[]
  pending: boolean
  error: unknown
  retry: () => void
  onSave: (s: Suggestion) => void
  onFocus: (s: Suggestion) => void
  onDismiss: (s: Suggestion) => void
}) {
  if (pending) return <SkeletonRows rows={5} />
  if (!list) return <ErrorBox error={error} retry={retry} />
  if (!list.length) return <p className="p-4 text-sm text-muted">No suggestions: places you photograph often show up here.</p>
  return (
    <ul className={items}>
      <li className="px-3 py-2 text-xs text-muted">Spots where you took many photos on several days. Save the ones that matter.</li>
      {list.map((s) => (
        <li key={`${s.latitude},${s.longitude}`} className={item}>
          <button type="button" className={main} onClick={() => onFocus(s)}>
            <span className={itemTitle}>
              <StatusDot ghost />
              <span className="truncate">{s.name}</span>
            </span>
            <span className="text-xs text-muted">
              {s.photos.toLocaleString()} photos · {s.days} days · {fmtDay(s.first_day)} – {fmtDay(s.last_day)}
            </span>
            {s.address && <span className={meta}>{s.address}</span>}
          </button>
          <Button size="sm" className="mt-2 mr-2" onClick={() => onSave(s)}>
            <Icon name="plus" size={13} />
            Save
          </Button>
          <Button
            variant="ghost"
            size="sm"
            icon
            className="mt-2 mr-1 -ml-1"
            onClick={() => onDismiss(s)}
            aria-label={`Dismiss ${s.name}`}
            title="Dismiss"
          >
            <Icon name="x" size={13} />
          </Button>
        </li>
      ))}
    </ul>
  )
}
