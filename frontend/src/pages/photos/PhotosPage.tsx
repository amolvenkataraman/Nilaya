import { useEffect, useRef, useState } from 'react'
import { Link, Route, Routes, useLocation, useNavigate, useSearchParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { get, safeHref } from '../../lib/api'
import { addDays, fmtDate, fmtTime, isSameDay, parseDayKey } from '../../lib/dates'
import type { Photo, PhotoSummary, YearGroup } from '../../lib/types'
import { AppShell, SideItem, SideSection } from '../../components/AppShell'
import { Icon } from '../../components/Icon'
import { useHotkey } from '../../components/ui'
import { PhotoStream, usePhotoParam, type Zoom } from './PhotoStream'
import { Viewer } from './Viewer'
import { fmtBytes } from './util'
import { BrowsePage, StatsPage, StoragePage } from './Explore'
import { LabelMenu, SelectToggle } from './select'
import { FiltersButton, Scrubber } from './Filters'
import { PhotoMapPage } from './PhotoMap'
import { AlbumPage, AlbumsPage } from './albums'
import { DayPage } from './DayPage'
import { SuperlativesPage } from './Superlatives'
import { GeoguessrPage, LocatePage } from './Games'
import { startIngest, useAlbums, useHiddenMode, useLibraries, useLibraryVisibility, useToggleHidden } from './actions'
import { PageHead } from './parts'
import './photos.css'

const useSummary = () => useQuery({ queryKey: ['photos', 'summary'], queryFn: () => get<PhotoSummary>('photos/summary'), staleTime: 10 * 60_000 })

const ZOOM_KEY = 'app.photos.zoom'
function readZoom(): Zoom {
  try {
    const v = localStorage.getItem(ZOOM_KEY)
    return v === 's' || v === 'l' ? v : 'm'
  } catch {
    return 'm'
  }
}

export default function PhotosPage() {
  const [zoom, setZoomState] = useState<Zoom>(readZoom)
  const setZoom = (z: Zoom) => {
    setZoomState(z)
    try {
      localStorage.setItem(ZOOM_KEY, z)
    } catch { /* ignore */ }
  }
  const location = useLocation()
  const albumPage = /\/albums\/[^/]+/.test(location.pathname)
  const hidden = useHiddenMode().data?.show ?? false
  const toggleHidden = useToggleHidden()
  // Shift+H: show/hide hidden photos (as on the classic pages).
  useHotkey((e) => e.key === 'H' && e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey && !e.repeat, (e) => {
    e.preventDefault()
    if (!toggleHidden.isPending) toggleHidden.mutate(!hidden)
  })
  return (
    <AppShell
      app="photos"
      pageTitle="Photos"
      topbar={<Toolbar zoom={zoom} setZoom={setZoom} showZoom={(!/\/albums\/?$/.test(location.pathname) || albumPage) && !/\/(map|stats|storage|browse|superlatives|geoguessr|locate)\/?$/.test(location.pathname)} />}
      sidebar={<Sidebar />}
    >
      {hidden && (
        <div className="ph-hidden-pill" role="status">
          <Icon name="ban" size={14} />
          <span>Showing hidden photos</span>
          <button onClick={() => toggleHidden.mutate(false)} disabled={toggleHidden.isPending}>Turn off</button>
        </div>
      )}
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
    </AppShell>
  )
}

// ---------------------------------------------------------------- top bar
function Toolbar({ zoom, setZoom, showZoom }: { zoom: Zoom; setZoom: (z: Zoom) => void; showZoom: boolean }) {
  const s = useSummary().data
  const navigate = useNavigate()
  const [text, setText] = useState('')
  const input = useRef<HTMLInputElement>(null)
  useHotkey((e) => e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey, (e) => {
    if (!input.current || input.current.offsetParent === null || document.querySelector('.dialog,.viewer,.drawer')) return
    e.preventDefault()
    input.current.focus()
  })
  const submit = () => {
    const t = text.trim()
    if (!t) return navigate('/photos')
    const lc = t.toLowerCase()
    const country = s?.countries.find((c) => c.name.toLowerCase() === lc)
    const city = s?.cities.find((c) => c.name.toLowerCase() === lc)
    const p = new URLSearchParams()
    if (country && !city) p.set('country', country.name)
    else p.set('city', city?.name ?? t)
    setText('')
    navigate('/photos?' + p.toString())
  }
  return (
    <>
      <form className="ph-search" role="search" onSubmit={(e) => (e.preventDefault(), submit())}>
        <Icon name="search" />
        <input
          ref={input}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Search by place  ( / )"
          aria-label="Search photos by city or country"
          list="ph-places"
          maxLength={128}
        />
        <datalist id="ph-places">
          {s?.cities.map((c) => <option key={'c' + c.name} value={c.name} />)}
          {s?.countries.map((c) => <option key={'n' + c.name} value={c.name} />)}
        </datalist>
      </form>
      {showZoom && <FiltersButton />}
      {showZoom && <SelectToggle />}
      {showZoom && <LabelMenu />}
      {showZoom && (
        <div className="seg ph-zoom" role="group" aria-label="Thumbnail size">
          {(['s', 'm', 'l'] as Zoom[]).map((z) => (
            <button key={z} aria-pressed={zoom === z} onClick={() => setZoom(z)} title={{ s: 'Small thumbnails', m: 'Medium thumbnails', l: 'Large thumbnails' }[z]}>
              <ZoomGlyph z={z} />
              <span className="sr-only">{{ s: 'Small', m: 'Medium', l: 'Large' }[z]}</span>
            </button>
          ))}
        </div>
      )}
    </>
  )
}

function ZoomGlyph({ z }: { z: Zoom }) {
  const n = { s: 3, m: 2, l: 1 }[z]
  const cell = 12 / n
  const rects = []
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) rects.push(<rect key={`${r}${c}`} x={c * cell + 0.75} y={r * cell + 0.75} width={cell - 1.5} height={cell - 1.5} rx="1" />)
  return <svg width="0.75rem" height="0.75rem" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">{rects}</svg>
}

// ---------------------------------------------------------------- sidebar
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
  useEffect(() => setEcho({}), [libs])
  const [hiddenEcho, setHiddenEcho] = useState<boolean | null>(null)
  useEffect(() => setHiddenEcho(null), [hidden?.show])
  const onTimeline = location.pathname === '/photos' || location.pathname === '/photos/'
  const kind = params.get('kind')
  const city = params.get('city')
  const country = params.get('country')
  const plain = onTimeline && !kind && !city && !country && !params.get('camera') && !params.get('objects') && !params.get('after')
  const canIngest = !!libs?.some((l) => l.role === 'owner' || l.role === 'editor')
  const at = (p: string) => location.pathname === `/photos/${p}`
  return (
    <>
      <SideSection>
        <SideItem icon="photo" label="Timeline" to="/photos" active={plain} count={s ? (s.photos + s.videos).toLocaleString() : undefined} />
        <SideItem icon="video" label="Videos" to="/photos?kind=videos" active={onTimeline && kind === 'videos'} count={s?.videos.toLocaleString()} />
        <SideItem icon="album" label="Albums" to="/photos/albums" active={location.pathname.startsWith('/photos/albums')} count={albums?.length} />
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
            <SideItem key={a.id} icon="layers" label={a.name} to={`/photos/albums/${a.id}`} active={location.pathname === `/photos/albums/${a.id}`} count={a.count} />
          ))}
        </SideSection>
      )}
      {s && (s.countries.length > 0 || s.cities.length > 0) && (
        <SideSection title="Places">
          {s.countries.map((c) => (
            <SideItem key={'n' + c.name} icon="map" label={c.name} to={`/photos?country=${encodeURIComponent(c.name)}`} active={onTimeline && country === c.name} count={c.count.toLocaleString()} />
          ))}
          {s.cities.slice(0, 6).map((c) => (
            <SideItem key={'c' + c.name} icon="pin" label={c.name} to={`/photos?city=${encodeURIComponent(c.name)}`} active={onTimeline && city === c.name} count={c.count.toLocaleString()} />
          ))}
        </SideSection>
      )}
      {libs && libs.length > 0 && (
        <SideSection title="Libraries">
          {libs.map((l) => (
            <div key={l.id} className={'side-item ph-lib' + (l.visible ? '' : ' off')} title={`${l.name} (${l.role})${l.visible ? '' : ': hidden from the timeline and stats'}`}>
              <label className="ph-lib-check">
                <input type="checkbox" checked={echo[l.id] ?? l.visible} onChange={(e) => (setEcho((x) => ({ ...x, [l.id]: e.target.checked })), toggle(l.id, e.target.checked))} aria-label={`Show ${l.name} in the timeline`} />
                <span className="grow truncate">{l.name}</span>
              </label>
              {libs.length > 1 && (
                <button className="ph-lib-only" onClick={() => only.mutate(l.id)} disabled={only.isPending} aria-label={`Show only ${l.name}`} title="Show only this library">Only</button>
              )}
              <span className="side-count">{l.count.toLocaleString()}</span>
            </div>
          ))}
        </SideSection>
      )}
      <SideSection title="More">
        {canIngest && <SideItem icon="refresh" label="Ingest new photos" onClick={startIngest} />}
        <a className="side-item" href="/photos/upload/"><Icon name="arrowUp" size={16} /><span className="grow truncate">Upload</span><Icon name="external" size={12} /></a>
        <label className="side-item ph-hidden-toggle" title="Shift+H. Only your own hidden photos; turns itself off after 30 minutes.">
          <Icon name="ban" size={16} />
          <span className="grow truncate">Show hidden photos</span>
          <input type="checkbox" role="switch" checked={hiddenEcho ?? !!hidden?.show} disabled={!hidden || toggleHidden.isPending}
            onChange={(e) => (setHiddenEcho(e.target.checked), toggleHidden.mutate(e.target.checked, { onError: () => setHiddenEcho(null) }))} />
        </label>
      </SideSection>
      <Tools open={at('geoguessr') || at('locate')} />
    </>
  )
}

/** Rarely used tools, folded away at the bottom of the sidebar (open state remembered). */
function Tools({ open }: { open: boolean }) {
  const location = useLocation()
  const [shown, setShown] = useState(() => { try { return localStorage.getItem('app.photos.tools') === '1' } catch { return false } })
  const at = (p: string) => location.pathname === `/photos/${p}`
  return (
    <details className="side-section side-tools" open={shown || open} onToggle={(e) => {
      const v = (e.currentTarget as HTMLDetailsElement).open
      setShown(v)
      try { localStorage.setItem('app.photos.tools', v ? '1' : '0') } catch { /* ignore */ }
    }}>
      <summary className="side-title"><span className="grow">Tools</span><Icon name="chevronDown" size={12} /></summary>
      <SideItem icon="globe" label="Geoguessr" to="/photos/geoguessr" active={at('geoguessr')} />
      <SideItem icon="pin" label="Add missing locations" to="/photos/locate" active={at('locate')} />
    </details>
  )
}

// ---------------------------------------------------------------- timeline
function Summary() {
  const s = useSummary().data
  if (!s) return <span className="sk" style={{ display: 'inline-block', width: '16rem', height: '0.75rem' }} />
  const n = (x: number) => x.toLocaleString()
  const range = s.first && s.last
    ? `${fmtDate(new Date(s.first), { month: 'short', year: 'numeric' })} – ${fmtDate(new Date(s.last), { month: 'short', year: 'numeric' })}`
    : ''
  return (
    <>
      {[`${n(s.photos)} photos`, s.videos ? `${n(s.videos)} videos` : '', range,
        s.countries.length ? `${s.countries.length} ${s.countries.length === 1 ? 'country' : 'countries'}` : '',
        s.cities.length ? `${s.cities.length}${s.cities.length >= 8 ? '+' : ''} cities` : '', s.size_kb ? fmtBytes(s.size_kb) : '']
        .filter(Boolean).join(' · ')}
    </>
  )
}

const validIso = (v: string | null) => (v && v.length <= 40 && !isNaN(Date.parse(v)) ? new Date(v) : null)

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
  const kind = params.get('kind') === 'videos' ? 'videos' : 'all'
  const city = (params.get('city') ?? '').slice(0, 128)
  const country = (params.get('country') ?? '').slice(0, 64)
  const camera = (params.get('camera') ?? '').slice(0, 128)
  const objects = (params.get('objects') ?? '').slice(0, 256)
  // ?after=<ISO>&before=<ISO>&title=… (an event's photos, linked from Calendar) or ?from=YYYY-MM-DD (filters).
  const after = validIso(params.get('after'))
  const before = validIso(params.get('before'))
  const eventTitle = (params.get('title') ?? '').trim().slice(0, 200)
  const fromKey = /^\d{4}-\d{2}-\d{2}$/.test(params.get('from') ?? '') ? params.get('from')! : ''
  const filter: Record<string, string | boolean | undefined> = {}
  if (kind === 'videos') filter.video = true
  if (city) filter.city = city
  if (country) filter.country = country
  if (camera) filter.camera = camera
  if (objects) filter.objects = objects
  const rangeStart = after ?? (fromKey ? parseDayKey(fromKey) : null)
  if (rangeStart) filter.after = rangeStart.toISOString()
  const place = [city || country, camera && `Camera: ${camera}`, objects && objects.split(',').join(', ')].filter(Boolean).join(' · ')
  // ?date=YYYY-MM-DD (from Calendar's photo badges / filters): start the timeline at the end of that day.
  const dateKey = /^\d{4}-\d{2}-\d{2}$/.test(params.get('date') ?? '') ? params.get('date')! : ''
  const day = dateKey ? parseDayKey(dateKey) : null
  const ranged = !!(after || before)
  const startBefore = before ? before.toISOString() : day ? addDays(day, 1).toISOString() : undefined
  const fromLabel = fromKey ? `From ${fmtDate(parseDayKey(fromKey), { month: 'short', day: 'numeric', year: 'numeric' })}` : ''
  const title = ranged
    ? `Photos from ${eventTitle || fmtRange(after, before)}`
    : place || (kind === 'videos' ? 'Videos' : day ? fmtDate(day, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) : fromLabel || 'Timeline')
  const sub = ranged ? (eventTitle ? fmtRange(after, before) : 'Photos taken in this time range')
    : place ? <>Filtered photos{fromLabel ? ` · ${fromLabel.toLowerCase()}` : ''}</> : kind === 'videos' ? 'All your videos, newest first' : day ? (fromKey ? `${fromLabel} to this day` : 'This day and earlier') : fromKey ? 'This day and later' : <Summary />
  const filtered = !!(place || kind === 'videos' || day || ranged || fromKey)
  return (
    <div className="page ph-page">
      <PageHead title={title} sub={sub}>
        {filtered && (
          <Link to="/photos" className="btn sm"><Icon name="x" size={14} />{ranged ? 'Clear' : day && !place ? 'Back to latest' : 'Clear filter'}</Link>
        )}
      </PageHead>
      {!filtered && <OnThisDay />}
      {!place && !ranged && !fromKey && kind === 'all' && <ScrubberFromSummary />}
      <PhotoStream
        dayInfo={!place && kind === 'all'}
        startBefore={startBefore}
        queryKey={['photos', 'timeline']}
        path="photos/timeline"
        params={Object.keys(filter).length ? filter : undefined}
        zoom={zoom}
        empty={ranged ? 'No photos were taken in this time range.' : place ? `No photos match ${place}.` : kind === 'videos' ? 'No videos yet.' : filtered ? 'No photos in this range.' : 'No photos yet. Use Ingest or Upload in the sidebar to add some.'}
      />
    </div>
  )
}

function ScrubberFromSummary() {
  const s = useSummary().data
  return <Scrubber first={s?.first ?? null} last={s?.last ?? null} />
}

function OnThisDay() {
  const q = useQuery({ queryKey: ['photos', 'on-this-day'], queryFn: () => get<YearGroup[]>('photos/on-this-day'), staleTime: 30 * 60_000 })
  const viewer = usePhotoParam()
  const groups = q.data ?? []
  if (!groups.length) return null
  const all: Photo[] = groups.flatMap((g) => g.items)
  const thisYear = new Date().getFullYear()
  return (
    <section className="otd" aria-label="On this day">
      <h2 className="otd-head"><Icon name="sparkle" size={15} />On this day</h2>
      <div className="otd-strip">
        {groups.map((g) => {
          const cover = g.items[0]
          const src = safeHref(cover.thumb_url)
          const ago = thisYear - g.year
          return (
            <button key={g.year} className="otd-card" onClick={() => viewer.open(cover.id, 'otd')}>
              {src && <img src={src} alt="" loading="lazy" decoding="async" />}
              <span className="otd-label">
                <strong>{ago === 1 ? '1 year ago' : `${ago} years ago`}</strong>
                <span>{g.year} · {g.items.length} {g.items.length === 1 ? 'item' : 'items'}</span>
              </span>
            </button>
          )
        })}
      </div>
      {viewer.source === 'otd' && viewer.current && <Viewer id={viewer.current} items={all} onGo={viewer.go} onClose={viewer.close} />}
    </section>
  )
}
