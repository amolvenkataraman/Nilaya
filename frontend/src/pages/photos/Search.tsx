// Smart search: the top-bar box and the results page (/photos?q=…). The server reads the query
// (places, things, cameras, dates, types, albums); we show how it was read as removable terms.
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { photoSummaryQuery } from '../../lib/photoQueries'
import type { PhotoSummary } from '../../lib/types'
import { Icon } from '../../components/Icon'
import { isTyping } from '../../components/ui'
import { PhotoStream, type Zoom } from './PhotoStream'
import { PageHead } from './parts'
import { countLabel, dropSpan, type SearchPage, type SearchTerm } from './search'
import './search.css'

const MAX = 200
const href = (q: string) => (q ? `/photos?q=${encodeURIComponent(q)}` : '/photos')

/** The search box: in the top bar, or `inline` at the top of the page on phones (the top bar has no room there).
 *  Enter searches, Esc clears, "/" focuses; it shows the current ?q= so it can be refined. */
export function SearchBox({ inline = false }: { inline?: boolean }) {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const current = (params.get('q') ?? '').slice(0, MAX)
  const [text, setText] = useState(current)
  useEffect(() => setText(current), [current]) // follow the URL (a removed term, Back)
  const input = useRef<HTMLInputElement>(null)
  // "/" focuses the box. Capture phase, so it wins over the app-wide "/" (command palette) while the box is shown.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const el = input.current
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey || isTyping(e) || !el || el.offsetParent === null) return
      if (document.querySelector('.dialog,.viewer,.drawer,.palette')) return
      e.preventDefault()
      e.stopImmediatePropagation()
      el.focus()
      el.select()
    }
    window.addEventListener('keydown', h, true)
    return () => window.removeEventListener('keydown', h, true)
  }, [])
  const submit = () => {
    const t = text.trim().replace(/\s+/g, ' ')
    navigate(href(t))
    if (t) input.current?.blur()
  }
  const clear = () => {
    setText('')
    if (current) navigate('/photos')
  }
  return (
    <form className={'ph-search ph-smart' + (inline ? ' ph-inline' : '')} role="search" onSubmit={(e) => (e.preventDefault(), submit())}>
      <Icon name="search" />
      <input
        ref={input}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== 'Escape') return
          e.preventDefault()
          if (text || current) clear()
          else input.current?.blur()
        }}
        placeholder="Search places, things, cameras, dates…"
        aria-label="Search photos"
        title="Try: dog toronto 2019 · videos in india · pixel 7 june 2023  ( / to focus, Esc to clear)"
        enterKeyHint="search"
        maxLength={MAX}
      />
      {text ? (
        <button type="button" className="ph-search-clear" onClick={clear} aria-label="Clear search"><Icon name="x" size={14} /></button>
      ) : <kbd className="ph-search-kbd" aria-hidden="true">/</kbd>}
    </form>
  )
}

const ICON: Record<SearchTerm['type'], string> = {
  place: 'pin', object: 'tag', camera: 'camera', date: 'calendar', media: 'photo', album: 'album', library: 'layers', text: 'search',
}
const kindOf = (t: SearchTerm) => (t.type === 'date' && /^\d{4}$/.test(t.value) ? 'Year' : t.kind)

/** The results: the normal day-grouped stream (selection, viewer) under how the query was read. */
export function SearchResults({ zoom }: { zoom: Zoom }) {
  const [params] = useSearchParams()
  const q = (params.get('q') ?? '').trim().slice(0, MAX)
  const [meta, setMeta] = useState<{ q: string; page: SearchPage } | null>(null)
  const page = meta?.q === q ? meta.page : null
  const terms = page?.interpreted ?? []
  const media = terms.filter((t) => t.type === 'media').map((t) => t.value)
  const noun = media.includes('video') && !media.includes('photo') ? 'video' : media.includes('photo') && !media.includes('video') ? 'photo' : 'item'
  const sub = page
    ? (page.count ? <>{countLabel(page.count, page.count_capped, noun)} · newest first</> : terms.length ? 'No matches' : 'Nothing understood')
    : <span className="sk" style={{ display: 'inline-block', width: '9rem', height: '0.75rem' }} />
  return (
    <div className="page ph-page">
      <SearchBox inline />
      <PageHead title={<span className="ph-sq-title">{q}</span>} sub={sub}>
        <Link to="/photos" className="btn sm"><Icon name="x" size={14} />Clear search</Link>
      </PageHead>
      <Interpretation q={q} page={page} />
      <PhotoStream
        queryKey={['photos', 'search']}
        path="photos/search"
        params={{ q }}
        zoom={zoom}
        onFirstPage={(p) => setMeta({ q, page: p as unknown as SearchPage })}
        empty={<NoResults q={q} page={page} />}
      />
    </div>
  )
}

/** "Place: Toronto or Waterloo · Object: Dog · Year: 2019", each removable; typos and ignored words below. */
function Interpretation({ q, page }: { q: string; page: SearchPage | null }) {
  const navigate = useNavigate()
  if (!page) return <div className="ph-sq" aria-hidden="true"><span className="sk" style={{ width: '14rem', height: '1.5rem', borderRadius: 999 }} /></div>
  const terms = page.interpreted
  // Same-type terms side by side with "or" between them (OR within a type, AND across types).
  const order: SearchTerm['type'][] = []
  for (const t of terms) if (!order.includes(t.type)) order.push(t.type)
  const typos = terms.filter((t) => t.typo)
  return (
    <>
      {terms.length > 0 && (
        <div className="ph-sq" role="list" aria-label="How your search was read">
          {order.map((type) => (
            <span key={type} className="ph-sq-group">
              {terms.filter((t) => t.type === type).map((t, i) => (
                <span key={t.value + i} className="ph-sq-or">
                  {i > 0 && <span className="ph-sq-join">or</span>}
                  <span role="listitem" className={'ph-term t-' + t.type} title={[t.detail, t.typo ? `Read "${t.typo}" as ${t.label}` : ''].filter(Boolean).join('\n') || undefined}>
                    <Icon name={t.type === 'media' && t.value === 'video' ? 'video' : ICON[t.type]} size={12} />
                    <span className="ph-term-kind">{kindOf(t)}</span>
                    <span className="ph-term-val">{t.label}</span>
                    {t.detail && <span className="ph-term-more">{t.detail.split(', ').length} models</span>}
                    <button type="button" onClick={() => navigate(href(dropSpan(q, t.span)))} aria-label={`Remove ${kindOf(t)}: ${t.label}`} title="Remove">
                      <Icon name="x" size={11} />
                    </button>
                  </span>
                </span>
              ))}
            </span>
          ))}
        </div>
      )}
      {(typos.length > 0 || page.unmatched.length > 0) && (
        <p className="ph-sq-note">
          {typos.map((t) => <span key={t.value}>Read “{t.typo}” as {t.label}</span>)}
          {page.unmatched.length > 0 && <span>Ignored: {page.unmatched.join(', ')}</span>}
        </p>
      )}
    </>
  )
}

function NoResults({ q, page }: { q: string; page: SearchPage | null }) {
  const s = useQuery(photoSummaryQuery<PhotoSummary>()).data
  const examples = [
    s?.cities[0]?.name,
    s?.per_year.length ? `videos ${s.per_year[s.per_year.length - 1].year}` : 'videos',
    s?.countries[0] && s.per_year.length ? `${s.countries[0].name} ${s.per_year[0].year}` : undefined,
    'dog',
  ].filter((x): x is string => !!x && x.toLowerCase() !== q.toLowerCase()).slice(0, 4)
  const understood = !!page?.interpreted.length
  return (
    <div className="ph-sq-empty">
      <Icon name="search" size={22} />
      <div>
        <strong>{understood ? (page!.interpreted.length > 1 ? 'No photos match all of these' : 'No photos match this') : `Couldn't understand “${q}”`}</strong>
        <p>
          {understood
            ? page!.interpreted.length > 1 ? 'Terms of different kinds must all match; remove one above to widen the search.' : 'Nothing in your libraries matches it yet. Objects need the AI index to have run.'
            : 'Search by place (city or country), thing (dog, car, food), camera (pixel 7, canon), date (2019, june 2023, last summer), type (videos, raw) or album name.'}
        </p>
        {examples.length > 0 && (
          <div className="ph-sq-try">
            <span>Try</span>
            {examples.map((x) => <Link key={x} className="chip" to={href(x)}>{x}</Link>)}
          </div>
        )}
      </div>
    </div>
  )
}
