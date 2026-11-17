// Smart search: the top-bar box and the results page (/photos?q=…). The server reads the query
// (places, things, cameras, dates, types, albums); we show how it was read as removable terms.
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { photoSummaryQuery } from '../../lib/photoQueries'
import type { PhotoSummary } from '../../lib/types'
import { Icon } from '../../components/Icon'
import { layerOpen } from '../../components/layers'
import { buttonClass, isTyping, pageClass, PageHead } from '../../components/ui'
import { cn } from '../../lib/cn'
import { PhotoStream, type Zoom } from './PhotoStream'
import { countLabel, dropSpan, type SearchPage, type SearchTerm } from './searchTerms'

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
      if (layerOpen(['dialog', 'viewer', 'drawer', 'palette'])) return
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
    // biome-ignore lint/a11y/useSemanticElements: a form, for Enter to submit; role=search makes it a landmark
    <form
      className={cn(
        'group items-center gap-2 rounded-full border px-3 text-muted transition-[background,border-color,box-shadow] duration-120',
        'focus-within:border-border focus-within:bg-surface focus-within:shadow-[0_1px_3px_rgba(16,24,40,.08)]',
        // The top-bar box gives way to the inline one on phones.
        inline
          ? 'mb-3.5 hidden h-10 w-full border-border bg-surface max-md:flex'
          : 'flex h-9 w-[min(26rem,100%)] border-transparent bg-surface-2 max-md:hidden',
      )}
      role="search"
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
    >
      <Icon name="search" />
      <input
        ref={input}
        className={cn('min-w-0 flex-1 border-0 bg-transparent text-fg outline-none', inline ? 'text-md' : 'text-sm')}
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
        <button
          type="button"
          className="-mr-1.5 inline-grid size-5.5 flex-none cursor-pointer place-items-center rounded-full border-0 bg-transparent text-muted hover:bg-hover hover:text-fg"
          onClick={clear}
          aria-label="Clear search"
        >
          <Icon name="x" size={14} />
        </button>
      ) : (
        // biome-ignore lint/a11y/noAriaHiddenOnFocusable: a visual hint only; the shortcut is announced by the field
        <kbd
          className="inline-grid h-4.5 min-w-4.5 place-items-center rounded-xs border border-border bg-surface px-1 font-sans text-2xs leading-none font-medium text-muted group-focus-within:invisible max-md:hidden"
          aria-hidden="true"
        >
          /
        </kbd>
      )}
    </form>
  )
}

const ICON: Record<SearchTerm['type'], string> = {
  place: 'pin',
  object: 'tag',
  camera: 'camera',
  date: 'calendar',
  media: 'photo',
  album: 'album',
  library: 'layers',
  text: 'search',
}
/** Each kind of term has its own tint (--tc), lighter in dark mode. */
const TERM_COLOUR: Record<SearchTerm['type'], string> = {
  place: '[--tc:#0f9d58] dark:[--tc:#34c47c]',
  object: '[--tc:#e8710a] dark:[--tc:#ff9a3d]',
  camera: '[--tc:#7c4dff] dark:[--tc:#a78bfa]',
  date: '[--tc:var(--app-accent)]',
  media: '[--tc:#d93025] dark:[--tc:#f87171]',
  album: '[--tc:#00897b] dark:[--tc:#2dd4bf]',
  library: '[--tc:#00897b] dark:[--tc:#2dd4bf]',
  text: '[--tc:var(--app-muted)]',
}
const termClass =
  'inline-flex h-7 max-w-full min-w-0 items-center gap-1.25 rounded-full border border-[color-mix(in_srgb,var(--tc)_22%,transparent)] ' +
  'bg-[color-mix(in_srgb,var(--tc)_10%,var(--app-surface))] pr-1 pl-2.25 text-xs whitespace-nowrap text-fg [&>svg]:shrink-0 [&>svg]:text-(--tc)'
const termsClass = '-mt-1 mb-2 flex flex-wrap items-center gap-x-2 gap-y-1.5'
const kindOf = (t: SearchTerm) => (t.type === 'date' && /^\d{4}$/.test(t.value) ? 'Year' : t.kind)

/** The results: the normal day-grouped stream (selection, viewer) under how the query was read. */
export function SearchResults({ zoom }: { zoom: Zoom }) {
  const [params] = useSearchParams()
  const q = (params.get('q') ?? '').trim().slice(0, MAX)
  const [meta, setMeta] = useState<{ q: string; page: SearchPage } | null>(null)
  const page = meta?.q === q ? meta.page : null
  const terms = page?.interpreted ?? []
  const media = terms.filter((t) => t.type === 'media').map((t) => t.value)
  const noun =
    media.includes('video') && !media.includes('photo') ? 'video' : media.includes('photo') && !media.includes('video') ? 'photo' : 'item'
  const sub = page ? (
    page.count ? (
      <>{countLabel(page.count, page.count_capped, noun)} · newest first</>
    ) : terms.length ? (
      'No matches'
    ) : (
      'Nothing understood'
    )
  ) : (
    <span className="inline-block h-3 w-36 animate-[sk_1.3s_ease-in-out_infinite] rounded-xs bg-surface-2" />
  )
  return (
    <div className={pageClass(true)}>
      <SearchBox inline />
      <PageHead title={<span className="before:text-muted before:content-['“'] after:text-muted after:content-['”']">{q}</span>} sub={sub}>
        <Link to="/photos" className={buttonClass({ size: 'sm' })}>
          <Icon name="x" size={14} />
          Clear search
        </Link>
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
  if (!page)
    return (
      <div className={termsClass} aria-hidden="true">
        <span className="block h-6 w-56 animate-[sk_1.3s_ease-in-out_infinite] rounded-full bg-surface-2" />
      </div>
    )
  const terms = page.interpreted
  // Same-type terms side by side with "or" between them (OR within a type, AND across types).
  const order: SearchTerm['type'][] = []
  for (const t of terms) if (!order.includes(t.type)) order.push(t.type)
  const typos = terms.filter((t) => t.typo)
  return (
    <>
      {terms.length > 0 && (
        // biome-ignore lint/a11y/useSemanticElements: terms wrap inline with their groups; a list element would break the flow
        <div className={termsClass} role="list" aria-label="How your search was read">
          {order.map((type) => (
            <span
              key={type}
              className="inline-flex max-w-full min-w-0 flex-wrap items-center gap-1.5 not-first:before:mr-0.5 not-first:before:h-4 not-first:before:w-px not-first:before:bg-border not-first:before:content-['']"
            >
              {terms
                .filter((t) => t.type === type)
                .map((t, i) => (
                  <span key={t.value + t.span.join()} className="inline-flex max-w-full min-w-0 items-center gap-1.5">
                    {i > 0 && <span className="text-xs text-muted">or</span>}
                    {/* biome-ignore lint/a11y/useSemanticElements: see the list above */}
                    <span
                      role="listitem"
                      className={cn(termClass, TERM_COLOUR[t.type])}
                      title={[t.detail, t.typo ? `Read "${t.typo}" as ${t.label}` : ''].filter(Boolean).join('\n') || undefined}
                    >
                      <Icon name={t.type === 'media' && t.value === 'video' ? 'video' : ICON[t.type]} size={12} />
                      <span className="font-medium text-muted after:content-[':']">{kindOf(t)}</span>
                      <span className="overflow-hidden font-semibold text-ellipsis">{t.label}</span>
                      {t.detail && <span className="text-muted">{t.detail.split(', ').length} models</span>}
                      <button
                        type="button"
                        className="inline-grid size-5 flex-none cursor-pointer place-items-center rounded-full border-0 bg-transparent text-muted hover:bg-[color-mix(in_srgb,var(--tc)_18%,transparent)] hover:text-fg"
                        onClick={() => navigate(href(dropSpan(q, t.span)))}
                        aria-label={`Remove ${kindOf(t)}: ${t.label}`}
                        title="Remove"
                      >
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
        <p className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
          {typos.map((t) => (
            <span key={t.value}>
              Read “{t.typo}” as {t.label}
            </span>
          ))}
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
  ]
    .filter((x): x is string => !!x && x.toLowerCase() !== q.toLowerCase())
    .slice(0, 4)
  const understood = !!page?.interpreted.length
  return (
    // data-empty-card: the stream's empty wrapper drops its padding for this card.
    <div
      data-empty-card
      className="mt-3 flex max-w-[36rem] items-start gap-3.5 rounded-md border border-border bg-surface px-4.5 py-4 text-left text-fg"
    >
      <Icon name="search" size={22} className="mt-0.5 flex-none text-muted" />
      <div>
        <strong className="text-sm">
          {understood
            ? page!.interpreted.length > 1
              ? 'No photos match all of these'
              : 'No photos match this'
            : `Couldn't understand “${q}”`}
        </strong>
        <p className="mt-1 text-sm leading-[1.45] text-muted">
          {understood
            ? page!.interpreted.length > 1
              ? 'Terms of different kinds must all match; remove one above to widen the search.'
              : 'Nothing in your libraries matches it yet. Objects need the AI index to have run.'
            : 'Search by place (city or country), thing (dog, car, food), camera (pixel 7, canon), date (2019, june 2023, last summer), type (videos, raw) or album name.'}
        </p>
        {examples.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs text-muted">
            <span>Try</span>
            {examples.map((x) => (
              <Link
                key={x}
                className="inline-flex h-6 items-center gap-1 rounded-full border border-border bg-surface-2 px-2.5 text-xs font-medium whitespace-nowrap text-fg hover:border-accent hover:text-accent hover:no-underline"
                to={href(x)}
              >
                {x}
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
