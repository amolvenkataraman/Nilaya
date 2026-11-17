// Photos › Albums: every album you own or that is shared with you, sorted (remembered per device), as a grid
// of covers or a list, and "New album".
import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { Icon } from '../../components/Icon'
import { Button, chipClass, ErrorBox, fieldClass, pageClass, PageHead, Segmented } from '../../components/ui'
import { cn } from '../../lib/cn'
import { plural } from '../../lib/format'
import { usePref } from '../../lib/storage'
import type { Album } from '../../lib/types'
import { useAlbums } from './actions'
import { AlbumCover } from './AlbumCover'
import { AlbumDialog } from './AlbumDialog'
import { albumMeta, albumSpan } from './albumText'
import { pulse } from './skeleton'

type Sort = 'name' | 'items' | 'size' | 'mine' | 'last-desc' | 'last-asc' | 'first-asc' | 'first-desc'
const SORTS: [Sort, string][] = [
  ['name', 'Name'],
  ['last-desc', 'Latest photo, newest first'],
  ['last-asc', 'Latest photo, oldest first'],
  ['first-asc', 'First photo, oldest first'],
  ['first-desc', 'First photo, newest first'],
  ['items', 'Most items'],
  ['size', 'Largest'],
  ['mine', 'Mine first'],
]
const time = (iso: string | null | undefined) => (iso ? new Date(iso).getTime() : Number.NaN)
/** Newest/oldest photo date (albums without dated photos last either way). */
function byDate(a: Album, b: Album, field: 'first' | 'last', dir: 1 | -1): number {
  const x = time(a[field])
  const y = time(b[field])
  if (Number.isNaN(x) || Number.isNaN(y)) return Number.isNaN(x) ? (Number.isNaN(y) ? a.name.localeCompare(b.name) : 1) : -1
  return (x - y) * dir
}
const COMPARE: Record<Sort, (a: Album, b: Album) => number> = {
  name: (a, b) => a.name.localeCompare(b.name),
  items: (a, b) => b.count - a.count,
  size: (a, b) => (b.size_kb ?? 0) - (a.size_kb ?? 0),
  mine: (a, b) => Number(b.mine) - Number(a.mine) || a.name.localeCompare(b.name),
  'last-desc': (a, b) => byDate(a, b, 'last', -1),
  'last-asc': (a, b) => byDate(a, b, 'last', 1),
  'first-asc': (a, b) => byDate(a, b, 'first', 1),
  'first-desc': (a, b) => byDate(a, b, 'first', -1),
}

const grid = 'grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-x-3.5 gap-y-4 max-md:grid-cols-2 max-md:gap-3'
const cover = 'mb-1.5 aspect-square rounded-md border border-border'

function Badges({ a }: { a: Album }) {
  return (
    <>
      {a.public && <span className={chipClass({ tone: 'accent' })}>Public</span>}
      {!a.mine && <span className={chipClass()}>Shared with you</span>}
    </>
  )
}

export function AlbumsPage() {
  const q = useAlbums()
  const [creating, setCreating] = useState(false)
  const [storedSort, setSort] = usePref<string>('app.photos.albumSort', 'name')
  const sort: Sort = SORTS.some(([k]) => k === storedSort) ? (storedSort as Sort) : 'name'
  const [view, setView] = usePref<string>('app.photos.albumView', 'grid')
  const navigate = useNavigate()
  const list = [...(q.data ?? [])].sort(COMPARE[sort])
  return (
    <div className={pageClass(true)}>
      <PageHead title="Albums" sub={q.data ? plural(q.data.length, 'album') : undefined}>
        {!!q.data?.length && (
          <>
            <select
              className={cn(fieldClass.select, 'w-auto! text-xs!')}
              value={sort}
              onChange={(e) => setSort(e.target.value)}
              aria-label="Sort albums"
            >
              {SORTS.map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
            <Segmented
              label="View"
              value={view === 'list' ? 'list' : 'grid'}
              onChange={setView}
              options={[
                { value: 'grid', icon: 'apps', title: 'Grid', label: <span className="sr-only">Grid</span> },
                { value: 'list', icon: 'list', title: 'List', label: <span className="sr-only">List</span> },
              ]}
            />
          </>
        )}
        <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
          <Icon name="plus" size={14} />
          <span>New album</span>
        </Button>
      </PageHead>
      {q.isPending ? (
        <div className={grid}>
          {Array.from({ length: 6 }, (_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: placeholders have no identity
            <div key={i} className="grid min-w-0 gap-0.5">
              <span className={cn(pulse, cover)} />
              <span className={cn(pulse, 'mt-2 h-3 w-3/5 rounded-xs')} />
            </div>
          ))}
        </div>
      ) : q.isError && !q.data ? (
        <ErrorBox error={q.error} retry={() => q.refetch()} />
      ) : !q.data.length ? (
        <div className="p-4 text-sm text-muted">
          <p>No albums yet. Albums collect photos from across your library and can be shared.</p>
          <Button size="sm" onClick={() => setCreating(true)}>
            <Icon name="plus" size={14} />
            Create an album
          </Button>
        </div>
      ) : view === 'list' ? (
        <ul className="m-0 grid list-none gap-px rounded-md border border-border bg-surface p-1">
          {list.map((a) => (
            <li key={a.id}>
              <Link
                to={`/photos/albums/${a.id}`}
                className="flex items-center gap-3 rounded-sm px-2 py-1.5 text-fg hover:bg-hover hover:no-underline"
              >
                <AlbumCover album={a} className="size-10 rounded-sm" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{a.name}</span>
                  {a.description && <span className="block truncate text-xs text-muted">{a.description}</span>}
                </span>
                <Badges a={a} />
                <span className="min-w-28 text-right text-xs text-muted tabular-nums max-md:hidden" title={albumSpan(a)}>
                  {albumMeta(a)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <div className={grid}>
          {list.map((a) => (
            <Link
              key={a.id}
              to={`/photos/albums/${a.id}`}
              className="group/card grid min-w-0 gap-0.5 rounded-md text-fg hover:no-underline"
            >
              <AlbumCover
                album={a}
                icon={28}
                className={cn(
                  cover,
                  'text-muted [&_img]:transition-transform [&_img]:duration-300 [&_img]:ease-out group-hover/card:[&_img]:scale-[1.03]',
                )}
              />
              <span className="truncate text-sm font-semibold">{a.name}</span>
              {a.description && (
                <span className="truncate text-xs text-muted" title={a.description}>
                  {a.description}
                </span>
              )}
              <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted tabular-nums" title={albumSpan(a)}>
                {albumMeta(a)}
                <Badges a={a} />
              </span>
            </Link>
          ))}
        </div>
      )}
      {creating && <AlbumDialog onClose={() => setCreating(false)} onSaved={(a) => navigate(`/photos/albums/${a.id}`)} />}
    </div>
  )
}
