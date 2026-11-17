// The Photos app: top bar (search, filters, select, tile label, thumbnail size), sidebar (views, explore,
// albums, places, libraries, hidden mode, tools) and the routes. The timeline itself (filters read from the URL
// by parseTimelineState) and "On this day" live here too; the other screens are their own files, and the
// rarely opened ones load on demand.
import { useQuery } from '@tanstack/react-query'
import { lazy, Suspense, useEffect, useState } from 'react'
import { Link, Route, Routes, useLocation, useSearchParams } from 'react-router'
import { AppShell, SIDE_SECTION, SIDE_TITLE, SideItem, SideSection } from '../../components/AppShell'
import { Icon } from '../../components/Icon'
import { buttonClass, pageClass, PageHead, useHotkey } from '../../components/ui'
import { safeHref } from '../../lib/api'
import { cn } from '../../lib/cn'
import { fmtDate, fmtTime, isSameDay, parseDayKey } from '../../lib/dates'
import { fmtBytes } from '../../lib/format'
import { photoSummaryQuery } from '../../lib/photoQueries'
import { usePref } from '../../lib/storage'
import type { Photo, PhotoSummary } from '../../lib/types'
import { startIngest, useAlbums, useHiddenMode, useLibraries, useLibraryVisibility, useToggleHidden } from './actions'
import { AlbumPage } from './AlbumPage'
import { AlbumsPage } from './AlbumsPage'
import { DayPage } from './DayPage'
import { FiltersButton, Scrubber } from './Filters'
import { PhotoStream, type Zoom } from './PhotoStream'
import { onThisDayQuery } from './queries'
import { SearchBox, SearchResults } from './Search'
import { SuperlativesPage } from './Superlatives'
import { isPlainTimeline, parseTimelineState } from './timelineState'
import { LabelMenu, SelectToggle, ZoomSwitch } from './ToolbarControls'
import { usePhotoParam } from './usePhotoParam'
import { Viewer } from './Viewer'

// Rarely opened screens load on demand, so the timeline doesn't pull in Leaflet (map, games) or the stats pages.
const PhotoMapPage = lazy(() => import('./PhotoMap').then((m) => ({ default: m.PhotoMapPage })))
const GeoguessrPage = lazy(() => import('./Geoguessr').then((m) => ({ default: m.GeoguessrPage })))
const LocatePage = lazy(() => import('./LocatePage').then((m) => ({ default: m.LocatePage })))
const BrowsePage = lazy(() => import('./BrowsePage').then((m) => ({ default: m.BrowsePage })))
const StatsPage = lazy(() => import('./StatsPage').then((m) => ({ default: m.StatsPage })))
const StoragePage = lazy(() => import('./StoragePage').then((m) => ({ default: m.StoragePage })))

const useSummary = () => useQuery(photoSummaryQuery<PhotoSummary>())

/** Screens without a photo grid (no zoom, filters, select or label controls). */
const NO_GRID = /\/(map|stats|storage|browse|superlatives|geoguessr|locate)\/?$/

export default function PhotosPage() {
  const [storedZoom, setZoom] = usePref<string>('app.photos.zoom', 'm')
  const zoom: Zoom = storedZoom === 's' || storedZoom === 'l' ? storedZoom : 'm'
  const location = useLocation()
  const albumPage = /\/albums\/[^/]+/.test(location.pathname)
  const showZoom = (!/\/albums\/?$/.test(location.pathname) || albumPage) && !NO_GRID.test(location.pathname)
  const hidden = useHiddenMode().data?.show ?? false
  const toggleHidden = useToggleHidden()
  // Shift+H: show/hide hidden photos (as on the classic pages).
  useHotkey(
    (e) => e.key === 'H' && e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey && !e.repeat,
    (e) => {
      e.preventDefault()
      if (!toggleHidden.isPending) toggleHidden.mutate(!hidden)
    },
  )
  return (
    <AppShell
      app="photos"
      pageTitle="Photos"
      topbar={
        <>
          <SearchBox />
          {showZoom && (
            <>
              <FiltersButton />
              <SelectToggle />
              <LabelMenu />
              <ZoomSwitch zoom={zoom} setZoom={setZoom} />
            </>
          )}
        </>
      }
      sidebar={<Sidebar />}
    >
      {hidden && (
        <div
          className="fixed bottom-18 left-1/2 z-30 inline-flex -translate-x-1/2 items-center gap-2 rounded-full bg-fg py-1.25 pr-1.5 pl-3 text-xs font-medium text-bg shadow-pop"
          role="status"
        >
          <Icon name="ban" size={14} />
          <span>Showing hidden photos</span>
          <button
            type="button"
            className="rounded-full border-0 bg-[color-mix(in_srgb,var(--app-bg)_18%,transparent)] px-2.5 py-0.75 text-xs font-semibold hover:bg-[color-mix(in_srgb,var(--app-bg)_30%,transparent)]"
            onClick={() => toggleHidden.mutate(false)}
            disabled={toggleHidden.isPending}
          >
            Turn off
          </button>
        </div>
      )}
      <Suspense fallback={<div aria-busy="true" />}>
        <Routes>
          <Route index element={<TimelinePage zoom={zoom} />} />
          <Route path="albums" element={<AlbumsPage />} />
          <Route path="albums/:id" element={<AlbumPage zoom={zoom} />} />
          <Route path="day/:date" element={<DayPage zoom={zoom} />} />
          <Route path="superlatives" element={<SuperlativesPage />} />
          <Route path="stats" element={<StatsPage />} />
          <Route path="storage" element={<StoragePage />} />
          <Route path="browse" element={<BrowsePage />} />
          <Route path="map" element={<PhotoMapPage />} />
          <Route path="geoguessr" element={<GeoguessrPage />} />
          <Route path="locate" element={<LocatePage />} />
          <Route path="*" element={<TimelinePage zoom={zoom} />} />
        </Routes>
      </Suspense>
    </AppShell>
  )
}

// ---------------------------------------------------------------- sidebar
/** A sidebar row that isn't a link (the libraries, the hidden-mode switch): SideItem's look. */
const sideRow = 'flex h-8 w-full min-w-0 items-center rounded-sm px-2 text-sm text-fg'
const check = 'm-0 size-3.5 flex-none accent-accent'

function Sidebar() {
  const location = useLocation()
  const [params] = useSearchParams()
  const s = useSummary().data
  const albums = useAlbums().data
  const libs = useLibraries().data
  const hidden = useHiddenMode().data
  const toggleHidden = useToggleHidden()
  const { toggle, only } = useLibraryVisibility()
  // Local echo so the controlled checkbox flips in the same event (the query cache notifies a tick later).
  const [echo, setEcho] = useState<Record<number, boolean>>({})
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new list from the server replaces the echo
  useEffect(() => setEcho({}), [libs])
  const [hiddenEcho, setHiddenEcho] = useState<boolean | null>(null)
  // biome-ignore lint/correctness/useExhaustiveDependencies: the server's answer replaces the echo
  useEffect(() => setHiddenEcho(null), [hidden?.show])
  const onTimeline = location.pathname === '/photos' || location.pathname === '/photos/'
  const kind = params.get('kind')
  const city = params.get('city')
  const country = params.get('country')
  const plain = onTimeline && isPlainTimeline(params)
  const canIngest = !!libs?.some((l) => l.role === 'owner' || l.role === 'editor')
  const at = (p: string) => location.pathname === `/photos/${p}`
  return (
    <>
      <SideSection>
        <SideItem
          icon="photo"
          label="Timeline"
          to="/photos"
          active={plain}
          count={s ? (s.photos + s.videos).toLocaleString() : undefined}
        />
        <SideItem
          icon="video"
          label="Videos"
          to="/photos?kind=videos"
          active={onTimeline && kind === 'videos'}
          count={s?.videos.toLocaleString()}
        />
        <SideItem
          icon="album"
          label="Albums"
          to="/photos/albums"
          active={location.pathname.startsWith('/photos/albums')}
          count={albums?.length}
        />
      </SideSection>
      <SideSection title="Explore">
        <SideItem icon="search" label="Browse" to="/photos/browse" active={at('browse')} />
        <SideItem icon="map" label="Map" to="/photos/map" active={at('map')} />
        <SideItem icon="trophy" label="Superlatives" to="/photos/superlatives" active={at('superlatives')} />
        <SideItem icon="chart" label="Stats" to="/photos/stats" active={at('stats')} />
        <SideItem icon="layers" label="Storage" to="/photos/storage" active={at('storage')} />
      </SideSection>
      {albums && albums.length > 0 && (
        <SideSection title="Albums">
          {albums.slice(0, 8).map((a) => (
            <SideItem
              key={a.id}
              icon="layers"
              label={a.name}
              to={`/photos/albums/${a.id}`}
              active={location.pathname === `/photos/albums/${a.id}`}
              count={a.count}
            />
          ))}
        </SideSection>
      )}
      {s && (s.countries.length > 0 || s.cities.length > 0) && (
        <SideSection title="Places">
          {s.countries.map((c) => (
            <SideItem
              key={`n${c.name}`}
              icon="map"
              label={c.name}
              to={`/photos?country=${encodeURIComponent(c.name)}`}
              active={onTimeline && country === c.name}
              count={c.count.toLocaleString()}
            />
          ))}
          {s.cities.slice(0, 6).map((c) => (
            <SideItem
              key={`c${c.name}`}
              icon="pin"
              label={c.name}
              to={`/photos?city=${encodeURIComponent(c.name)}`}
              active={onTimeline && city === c.name}
              count={c.count.toLocaleString()}
            />
          ))}
        </SideSection>
      )}
      {libs && libs.length > 0 && (
        <SideSection title="Libraries">
          {libs.map((l) => (
            <div
              key={l.id}
              className={cn(sideRow, 'group/lib gap-1.5')}
              title={`${l.name} (${l.role})${l.visible ? '' : ': hidden from the timeline and stats'}`}
            >
              <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  className={check}
                  checked={echo[l.id] ?? l.visible}
                  onChange={(e) => {
                    setEcho((x) => ({ ...x, [l.id]: e.target.checked }))
                    toggle(l.id, e.target.checked)
                  }}
                  aria-label={`Show ${l.name} in the timeline`}
                />
                <span
                  className={cn(
                    'min-w-0 flex-1 truncate',
                    !l.visible && 'text-muted line-through decoration-[color-mix(in_srgb,var(--app-muted)_50%,transparent)]',
                  )}
                >
                  {l.name}
                </span>
              </label>
              {libs.length > 1 && (
                <button
                  type="button"
                  className="hidden rounded-xs border-0 bg-transparent px-1 text-xs text-accent group-focus-within/lib:inline-block group-hover/lib:inline-block hover:bg-accent-soft touch:inline-block"
                  onClick={() => only.mutate(l.id)}
                  disabled={only.isPending}
                  aria-label={`Show only ${l.name}`}
                  title="Show only this library"
                >
                  Only
                </button>
              )}
              <span className="text-xs text-muted tabular-nums group-focus-within/lib:hidden group-hover/lib:hidden touch:hidden">
                {l.count.toLocaleString()}
              </span>
            </div>
          ))}
        </SideSection>
      )}
      <SideSection title="More">
        {canIngest && <SideItem icon="refresh" label="Ingest new photos" onClick={startIngest} />}
        <label
          className={cn(sideRow, 'cursor-pointer gap-2.5 hover:bg-hover [&>svg]:flex-none [&>svg]:text-muted')}
          title="Shift+H. Only your own hidden photos; turns itself off after 30 minutes."
        >
          <Icon name="ban" size={16} />
          <span className="min-w-0 flex-1 truncate">Show hidden photos</span>
          <input
            type="checkbox"
            role="switch"
            className={check}
            checked={hiddenEcho ?? !!hidden?.show}
            aria-checked={hiddenEcho ?? !!hidden?.show}
            disabled={!hidden || toggleHidden.isPending}
            onChange={(e) => {
              setHiddenEcho(e.target.checked)
              toggleHidden.mutate(e.target.checked, { onError: () => setHiddenEcho(null) })
            }}
          />
        </label>
      </SideSection>
      <Tools open={at('geoguessr') || at('locate')} />
    </>
  )
}

/** Rarely used tools, folded away at the bottom of the sidebar (open state remembered). */
function Tools({ open }: { open: boolean }) {
  const location = useLocation()
  const [shown, setShown] = usePref<boolean>('app.photos.tools', false)
  const at = (p: string) => location.pathname === `/photos/${p}`
  return (
    <details className={cn(SIDE_SECTION, 'group/tools')} open={shown || open} onToggle={(e) => setShown(e.currentTarget.open)}>
      <summary className={cn(SIDE_TITLE, 'cursor-pointer list-none rounded-sm hover:text-fg [&::-webkit-details-marker]:hidden')}>
        <span className="flex-1">Tools</span>
        <Icon name="chevronDown" size={12} className="-rotate-90 transition-transform duration-150 ease-out group-open/tools:rotate-0" />
      </summary>
      <SideItem icon="globe" label="Geoguessr" to="/photos/geoguessr" active={at('geoguessr')} />
      <SideItem icon="pin" label="Add missing locations" to="/photos/locate" active={at('locate')} />
    </details>
  )
}

// ---------------------------------------------------------------- timeline
function Summary() {
  const s = useSummary().data
  if (!s) return <span className="inline-block h-3 w-64 animate-[sk_1.3s_ease-in-out_infinite] rounded-xs bg-surface-2" />
  const n = (x: number) => x.toLocaleString()
  const range =
    s.first && s.last
      ? `${fmtDate(new Date(s.first), { month: 'short', year: 'numeric' })} – ${fmtDate(new Date(s.last), { month: 'short', year: 'numeric' })}`
      : ''
  return (
    <>
      {[
        `${n(s.photos)} photos`,
        s.videos ? `${n(s.videos)} videos` : '',
        range,
        s.countries.length ? `${s.countries.length} ${s.countries.length === 1 ? 'country' : 'countries'}` : '',
        s.cities.length ? `${s.cities.length}${s.cities.length >= 8 ? '+' : ''} cities` : '',
        s.size_kb ? fmtBytes(s.size_kb) : '',
      ]
        .filter(Boolean)
        .join(' · ')}
    </>
  )
}

/** "Mon, Nov 3, 2026, 10:00 AM – 12:30 PM" (or across days). */
function fmtRange(a: Date | null, b: Date | null): string {
  const day = (d: Date) => fmtDate(d, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
  if (a && b) return isSameDay(a, b) ? `${day(a)}, ${fmtTime(a)} – ${fmtTime(b)}` : `${day(a)}, ${fmtTime(a)} – ${day(b)}, ${fmtTime(b)}`
  if (a) return `Since ${day(a)}, ${fmtTime(a)}`
  if (b) return `Before ${day(b)}, ${fmtTime(b)}`
  return ''
}

function TimelinePage({ zoom }: { zoom: Zoom }) {
  const [params] = useSearchParams()
  if (params.get('q')?.trim()) return <SearchResults zoom={zoom} />
  return <Timeline zoom={zoom} params={params} />
}

function Timeline({ zoom, params }: { zoom: Zoom; params: URLSearchParams }) {
  const t = parseTimelineState(params)
  const { place, videos, oldest, after, before, eventTitle, fromKey, day } = t
  const ranged = !!(after || before)
  const fromLabel = fromKey ? `From ${fmtDate(parseDayKey(fromKey), { month: 'short', day: 'numeric', year: 'numeric' })}` : ''
  const title = ranged
    ? `Photos from ${eventTitle || fmtRange(after, before)}`
    : place ||
      (videos
        ? 'Videos'
        : oldest && !day && !fromKey
          ? 'Oldest first'
          : day
            ? fmtDate(day, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
            : fromLabel || 'Timeline')
  const sub = ranged ? (
    eventTitle ? (
      fmtRange(after, before)
    ) : (
      'Photos taken in this time range'
    )
  ) : place ? (
    <>
      Filtered photos{fromLabel ? ` · ${fromLabel.toLowerCase()}` : ''}
      {oldest ? ' · oldest first' : ''}
    </>
  ) : videos ? (
    `All your videos, ${oldest ? 'oldest' : 'newest'} first`
  ) : oldest && !day && !fromKey ? (
    'Your whole library from the first photo on'
  ) : day ? (
    fromKey ? (
      `${fromLabel} to this day`
    ) : (
      'This day and earlier'
    )
  ) : fromKey ? (
    'This day and later'
  ) : (
    <Summary />
  )
  const filtered = !!(place || videos || day || ranged || fromKey || oldest)
  const scrubber = !place && !ranged && !fromKey && !oldest && !videos
  return (
    // The month scrubber sits over the right edge: leave it room (it hides on narrow screens).
    <div className={cn(pageClass(true), 'has-[[data-scrubber]]:pr-14 max-[1000px]:has-[[data-scrubber]]:pr-4')}>
      <SearchBox inline />
      <PageHead title={title} sub={sub}>
        {filtered && (
          <Link to="/photos" className={buttonClass({ size: 'sm' })}>
            <Icon name="x" size={14} />
            {ranged ? 'Clear' : day && !place ? 'Back to latest' : 'Clear filter'}
          </Link>
        )}
      </PageHead>
      {!filtered && <OnThisDay />}
      {scrubber && <ScrubberFromSummary />}
      <PhotoStream
        dayInfo={!place && !videos}
        startBefore={t.startBefore}
        queryKey={['photos', 'timeline']}
        path="photos/timeline"
        params={t.filter}
        zoom={zoom}
        empty={
          ranged
            ? 'No photos were taken in this time range.'
            : place
              ? `No photos match ${place}.`
              : videos
                ? 'No videos yet.'
                : filtered
                  ? 'No photos in this range.'
                  : 'No photos yet. Use Ingest new photos in the sidebar to add some.'
        }
      />
    </div>
  )
}

function ScrubberFromSummary() {
  const s = useSummary().data
  return <Scrubber first={s?.first ?? null} last={s?.last ?? null} />
}

function OnThisDay() {
  const q = useQuery(onThisDayQuery)
  const viewer = usePhotoParam()
  const groups = q.data ?? []
  if (!groups.length) return null
  const all: Photo[] = groups.flatMap((g) => g.items)
  const thisYear = new Date().getFullYear()
  return (
    <section className="mb-5" aria-label="On this day">
      <h2 className="mb-2 flex items-center gap-1.5 text-sm [&>svg]:text-accent">
        <Icon name="sparkle" size={15} />
        On this day
      </h2>
      <div className="flex snap-x snap-mandatory gap-2 overflow-x-auto pb-1">
        {groups.map((g) => {
          const cover = g.items[0]
          const src = safeHref(cover.thumb_url)
          const ago = thisYear - g.year
          return (
            <button
              key={g.year}
              type="button"
              className="group/otd relative aspect-[4/5] w-40 flex-none cursor-pointer snap-start overflow-hidden rounded-md border-0 bg-surface-2 p-0 text-left max-md:w-32"
              onClick={() => viewer.open(cover.id, 'otd')}
            >
              {src && (
                <img
                  src={src}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  className="size-full object-cover transition-transform duration-300 ease-out group-hover/otd:scale-[1.03]"
                />
              )}
              <span className="absolute inset-x-0 bottom-0 grid bg-[linear-gradient(transparent,rgba(0,0,0,0.65))] px-2.5 pt-6 pb-2 text-xs text-white">
                <strong className="text-sm">{ago === 1 ? '1 year ago' : `${ago} years ago`}</strong>
                <span>
                  {g.year} · {g.items.length} {g.items.length === 1 ? 'item' : 'items'}
                </span>
              </span>
            </button>
          )
        })}
      </div>
      {viewer.source === 'otd' && viewer.current && <Viewer id={viewer.current} items={all} onGo={viewer.go} onClose={viewer.close} />}
    </section>
  )
}
