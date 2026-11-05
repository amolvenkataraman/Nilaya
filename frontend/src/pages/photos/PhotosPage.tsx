import { useState, type ReactNode } from 'react'
import { Link, Route, Routes, useLocation, useNavigate, useParams, useSearchParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { get, safeHref } from '../../lib/api'
import { addDays, fmtDate, parseDayKey } from '../../lib/dates'
import type { Album, Library, Photo, PhotoSummary, YearGroup } from '../../lib/types'
import { AppShell, SideItem, SideSection } from '../../components/AppShell'
import { Icon } from '../../components/Icon'
import { ErrorBox } from '../../components/ui'
import { PhotoStream, usePhotoParam, type Zoom } from './PhotoStream'
import { Viewer } from './Viewer'
import { fmtBytes } from './util'
import { BrowsePage, StatsPage, StoragePage } from './Explore'
import './photos.css'

const useSummary = () => useQuery({ queryKey: ['photos', 'summary'], queryFn: () => get<PhotoSummary>('photos/summary'), staleTime: 10 * 60_000 })
const useAlbums = () => useQuery({ queryKey: ['photos', 'albums'], queryFn: () => get<Album[]>('photos/albums'), staleTime: 5 * 60_000 })
const useLibraries = () => useQuery({ queryKey: ['photos', 'libraries'], queryFn: () => get<Library[]>('photos/libraries'), staleTime: 10 * 60_000 })

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
  return (
    <AppShell
      app="photos"
      pageTitle="Photos"
      topbar={<Toolbar zoom={zoom} setZoom={setZoom} showZoom={!/\/albums\/?$/.test(location.pathname) || albumPage} />}
      sidebar={<Sidebar />}
    >
      <Routes>
        <Route index element={<TimelinePage zoom={zoom} />} />
        <Route path="albums" element={<AlbumsPage />} />
        <Route path="albums/:id" element={<AlbumPage zoom={zoom} />} />
        <Route path="stats" element={<StatsPage />} />
        <Route path="storage" element={<StoragePage />} />
        <Route path="browse" element={<BrowsePage />} />
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
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Search by place"
          aria-label="Search photos by city or country"
          list="ph-places"
          maxLength={128}
        />
        <datalist id="ph-places">
          {s?.cities.map((c) => <option key={'c' + c.name} value={c.name} />)}
          {s?.countries.map((c) => <option key={'n' + c.name} value={c.name} />)}
        </datalist>
      </form>
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
  const onTimeline = location.pathname === '/photos' || location.pathname === '/photos/'
  const kind = params.get('kind')
  const city = params.get('city')
  const country = params.get('country')
  const plain = onTimeline && !kind && !city && !country && !params.get('camera') && !params.get('objects')
  return (
    <>
      <SideSection>
        <SideItem icon="photo" label="Timeline" to="/photos" active={plain} count={s ? (s.photos + s.videos).toLocaleString() : undefined} />
        <SideItem icon="video" label="Videos" to="/photos?kind=videos" active={onTimeline && kind === 'videos'} count={s?.videos.toLocaleString()} />
        <SideItem icon="album" label="Albums" to="/photos/albums" active={location.pathname.startsWith('/photos/albums')} count={albums?.length} />
      </SideSection>
      <SideSection title="Explore">
        <SideItem icon="search" label="Browse" to="/photos/browse" active={location.pathname === '/photos/browse'} />
        <SideItem icon="chart" label="Stats" to="/photos/stats" active={location.pathname === '/photos/stats'} />
        <SideItem icon="layers" label="Storage" to="/photos/storage" active={location.pathname === '/photos/storage'} />
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
            <div key={l.id} className="side-item ph-lib" title={`${l.name} (${l.role})`}>
              <Icon name="folder" size={16} />
              <span className="grow truncate">{l.name}</span>
              <span className="side-count">{l.count.toLocaleString()}</span>
            </div>
          ))}
        </SideSection>
      )}
    </>
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

function TimelinePage({ zoom }: { zoom: Zoom }) {
  const [params] = useSearchParams()
  const kind = params.get('kind') === 'videos' ? 'videos' : 'all'
  const city = (params.get('city') ?? '').slice(0, 128)
  const country = (params.get('country') ?? '').slice(0, 64)
  const camera = (params.get('camera') ?? '').slice(0, 128)
  const objects = (params.get('objects') ?? '').slice(0, 256)
  const filter: Record<string, string | boolean | undefined> = {}
  if (kind === 'videos') filter.video = true
  if (city) filter.city = city
  if (country) filter.country = country
  if (camera) filter.camera = camera
  if (objects) filter.objects = objects
  const place = [city || country, camera && `Camera: ${camera}`, objects && objects.split(',').join(', ')].filter(Boolean).join(' · ')
  // ?date=YYYY-MM-DD (from Calendar's photo badges): start the timeline at the end of that day.
  const dateKey = /^\d{4}-\d{2}-\d{2}$/.test(params.get('date') ?? '') ? params.get('date')! : ''
  const day = dateKey ? parseDayKey(dateKey) : null
  const startBefore = day ? addDays(day, 1).toISOString() : undefined
  const title = place || (kind === 'videos' ? 'Videos' : day ? fmtDate(day, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) : 'Timeline')
  return (
    <div className="page ph-page">
      <PageHead title={title} sub={place ? <>Filtered photos</> : kind === 'videos' ? 'All your videos, newest first' : day ? 'This day and earlier' : <Summary />}>
        {(place || kind === 'videos' || day) && (
          <Link to="/photos" className="btn sm"><Icon name="x" size={14} />{day ? 'Back to latest' : 'Clear filter'}</Link>
        )}
      </PageHead>
      {!place && !day && kind === 'all' && <OnThisDay />}
      <PhotoStream
        startBefore={startBefore}
        queryKey={['photos', 'timeline']}
        path="photos/timeline"
        params={Object.keys(filter).length ? filter : undefined}
        zoom={zoom}
        empty={place ? `No photos match ${place}.` : kind === 'videos' ? 'No videos yet.' : 'No photos yet. Add some from the classic Photos app.'}
      />
    </div>
  )
}

function PageHead({ title, sub, children, back }: { title: ReactNode; sub?: ReactNode; children?: ReactNode; back?: string }) {
  return (
    <div className="page-head ph-head">
      {back && (
        <Link to={back} className="btn ghost icon" aria-label="Back" title="Back">
          <Icon name="chevronLeft" size={18} />
        </Link>
      )}
      <div className="grow" style={{ minWidth: 0 }}>
        <h1 className="truncate">{title}</h1>
        {sub && <p className="sub tabular">{sub}</p>}
      </div>
      {children}
    </div>
  )
}

function OnThisDay() {
  const q = useQuery({ queryKey: ['photos', 'on-this-day'], queryFn: () => get<YearGroup[]>('photos/on-this-day'), staleTime: 30 * 60_000 })
  const viewer = usePhotoParam()
  const groups = q.data ?? []
  if (!groups.length) return null
  const all: Photo[] = groups.flatMap((g) => g.items)
  const thisYear = new Date().getFullYear()
  const open = all.some((p) => p.id === viewer.current)
  return (
    <section className="otd" aria-label="On this day">
      <h2 className="otd-head"><Icon name="sparkle" size={15} />On this day</h2>
      <div className="otd-strip">
        {groups.map((g) => {
          const cover = g.items[0]
          const src = safeHref(cover.thumb_url)
          const ago = thisYear - g.year
          return (
            <button key={g.year} className="otd-card" onClick={() => viewer.open(cover.id)}>
              {src && <img src={src} alt="" loading="lazy" decoding="async" />}
              <span className="otd-label">
                <strong>{ago === 1 ? '1 year ago' : `${ago} years ago`}</strong>
                <span>{g.year} · {g.items.length} {g.items.length === 1 ? 'item' : 'items'}</span>
              </span>
            </button>
          )
        })}
      </div>
      {open && viewer.current && <Viewer id={viewer.current} items={all} onGo={viewer.go} onClose={viewer.close} />}
    </section>
  )
}

// ---------------------------------------------------------------- albums
function AlbumsPage() {
  const q = useAlbums()
  return (
    <div className="page ph-page">
      <PageHead title="Albums" sub={q.data ? `${q.data.length} ${q.data.length === 1 ? 'album' : 'albums'}` : undefined} />
      {q.isPending ? (
        <div className="albums">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="album-card">
              <span className="sk album-cover" />
              <span className="sk" style={{ width: '60%', height: '0.75rem', marginTop: '0.5rem' }} />
            </div>
          ))}
        </div>
      ) : q.isError && !q.data ? (
        <ErrorBox error={q.error} retry={() => q.refetch()} />
      ) : !q.data.length ? (
        <div className="empty left">No albums yet. Create one from the classic Photos app.</div>
      ) : (
        <div className="albums">
          {q.data.map((a) => {
            const src = a.cover ? safeHref(a.cover.thumb_url) : null
            return (
              <Link key={a.id} to={`/photos/albums/${a.id}`} className="album-card">
                <span className="album-cover">
                  {src ? <img src={src} alt="" loading="lazy" decoding="async" /> : <Icon name="album" size={28} />}
                </span>
                <span className="album-name truncate">{a.name}</span>
                {a.description && <span className="album-desc truncate" title={a.description}>{a.description}</span>}
                <span className="album-meta">
                  {a.count} {a.count === 1 ? 'item' : 'items'}
                  {a.public && <span className="chip accent">Public</span>}
                  {!a.mine && <span className="chip">Shared with you</span>}
                </span>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}

function AlbumPage({ zoom }: { zoom: Zoom }) {
  const { id = '' } = useParams()
  const albums = useAlbums()
  const album = albums.data?.find((a) => a.id === id)
  const valid = /^[0-9a-f-]{36}$/i.test(id)
  const title = album?.name ?? (albums.isPending ? <span className="sk" style={{ display: 'inline-block', width: '10rem', height: '1rem' }} /> : 'Album')
  const sub = album
    ? [`${album.count} ${album.count === 1 ? 'item' : 'items'}`, album.description, album.public ? 'Public' : '', album.mine ? '' : 'Shared with you'].filter(Boolean).join(' · ')
    : undefined
  return (
    <div className="page ph-page">
      <PageHead back="/photos/albums" title={title} sub={sub} />
      {valid ? (
        <PhotoStream queryKey={['photos', 'album', id]} path={`photos/albums/${id}/photos`} zoom={zoom} empty="This album is empty." />
      ) : (
        <div className="empty left">Album not found.</div>
      )}
    </div>
  )
}
