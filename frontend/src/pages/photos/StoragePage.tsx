// Photos › Storage (/photos/storage): disk space of optimized files and the originals and RAW files kept
// next to them, as the classic Storage page shows it: tiles, a table by library / year / month (header,
// first column and totals stay in view), bars by camera and type, and the largest items. The four series
// colours are the classic page's validated set, one per theme.
import { type ReactNode, useMemo } from 'react'
import { Link } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { Icon } from '../../components/Icon'
import { HBars, StackBar } from '../../components/charts'
import { InlineFail } from '../../components/resilience'
import { QueryView, SkeletonRows } from '../../components/ui'
import { safeHref } from '../../lib/api'
import { cn } from '../../lib/cn'
import { fmtDate } from '../../lib/dates'
import { fmtBytes } from '../../lib/format'
import { PageHead, pageClass } from './PageHead'
import { CardHead, StatCard, StatTile, cardGridClass, helpClass, statCardClass, tilesClass } from './StatCards'
import { type Breakdown, type Group, type Storage, allMonths, n, pct, storageOf, storageQuery, sumRows } from './statsData'
import { useParamSetter } from './useParamSetter'
import { fmtHms } from './util'

const fb = (kb: number) => fmtBytes(kb, true) // the classic page's precision
type SeriesKey = 'photo' | 'raw' | 'video' | 'orig'
const COLOUR: Record<SeriesKey, string> = {
  photo: 'bg-[#2a78d6] dark:bg-[#3987e5]',
  raw: 'bg-[#1baf7a] dark:bg-[#199e70]',
  video: 'bg-[#6250d6] dark:bg-[#9085e9]',
  orig: 'bg-[#eb6834] dark:bg-[#d95926]',
}
const SERIES: { key: SeriesKey; label: string }[] = [
  { key: 'photo', label: 'Photos' },
  { key: 'raw', label: 'Photos RAW' },
  { key: 'video', label: 'Videos' },
  { key: 'orig', label: 'Video originals' },
]
const Swatch = ({ k }: { k: SeriesKey }) => (
  <i className={cn('inline-block size-2.5 flex-none rounded-[2px]', COLOUR[k])} aria-hidden="true" />
)

function UsageBar({ r }: { r: Breakdown }) {
  const vals = { photo: r.photo_kb, raw: r.raw_kb, video: r.video_kb, orig: r.original_kb }
  const label = SERIES.map((x) => `${x.label} ${fb(vals[x.key])} (${pct(vals[x.key], r.total_kb)})`).join(' · ')
  return (
    <StackBar label={label} parts={SERIES.map((x) => ({ key: x.key, value: vals[x.key], className: COLOUR[x.key], label: x.label }))} />
  )
}

// Table cells. Every cell has its own background so the sticky header, first column and totals cover what
// scrolls under them; a hovered row tints all its cells. Borders differ per row kind, so each kind builds
// its own class list (no two utilities set the same property).
const pad = 'bg-surface px-3 py-1.75 whitespace-nowrap max-md:px-2 max-md:py-1.5'
const cell = cn(pad, 'border-b border-border')
const foot = cn(pad, 'sticky bottom-0 border-t-2 border-border font-semibold')
const num = 'text-right tabular-nums'
const head = 'sticky font-medium text-muted'
const firstCol = 'sticky left-0 max-w-64 shadow-[inset_-1px_0_0_var(--app-border)] max-md:max-w-34'

function Cells({ r, inFoot, muted }: { r: Breakdown; inFoot?: boolean; muted?: boolean }) {
  const base = inFoot ? foot : cell
  const td = (v: number, s: string) => <td className={cn(base, num, (muted || !v) && 'text-muted')}>{s}</td>
  return (
    <>
      {td(r.photo_count, n(r.photo_count))}
      {td(r.photo_kb, fb(r.photo_kb))}
      {td(r.raw_kb, fb(r.raw_kb))}
      {td(r.video_count, n(r.video_count))}
      {td(r.video_s, fmtHms(r.video_s))}
      {td(r.video_kb, fb(r.video_kb))}
      {td(r.original_kb, fb(r.original_kb))}
      <td className={cn(base, num, !inFoot && 'font-semibold', muted && 'text-muted')}>{fb(r.total_kb)}</td>
      <td className={cn(base, 'w-48 min-w-32')}>
        <UsageBar r={r} />
      </td>
    </>
  )
}

type Row = { key: string; name: string; muted?: boolean; r: Breakdown }

function StorageTable({
  first,
  rows,
  total,
  empty,
  tall,
}: {
  first: string
  rows: Row[]
  total?: { name: string; r: Breakdown }
  empty: string
  tall?: boolean
}) {
  const group = (k: 'photo' | 'video') =>
    cn(
      pad,
      head,
      'top-0 z-2 box-border h-[2.125rem] border-b-2 text-center',
      k === 'photo' ? 'border-b-[#2a78d6] dark:border-b-[#3987e5]' : 'border-b-[#6250d6] dark:border-b-[#9085e9]',
    )
  const top = cn(cell, head, 'top-0 z-2')
  const sub = cn(cell, head, num, 'top-[2.125rem] z-2')
  return (
    <section
      className={cn(
        'overflow-x-auto overscroll-x-contain focus-visible:-outline-offset-2',
        tall && 'max-h-[min(75vh,52rem)] overflow-y-auto',
      )}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: the table scrolls sideways; keyboard users need to reach it
      tabIndex={0}
      aria-label={`Storage by ${first.toLowerCase()}`}
    >
      <table className="w-full border-separate border-spacing-0 text-xs">
        <thead>
          <tr>
            <th rowSpan={2} scope="col" className={cn(cell, head, firstCol, 'top-0 z-3 text-left align-bottom')}>
              {first}
            </th>
            <th colSpan={3} scope="colgroup" className={group('photo')}>
              <span className="inline-flex items-center gap-1.5 font-semibold text-fg">
                <Swatch k="photo" />
                Photos
              </span>
            </th>
            <th colSpan={4} scope="colgroup" className={group('video')}>
              <span className="inline-flex items-center gap-1.5 font-semibold text-fg">
                <Swatch k="video" />
                Videos
              </span>
            </th>
            <th rowSpan={2} scope="col" className={cn(top, num)}>
              Total space
            </th>
            <th rowSpan={2} scope="col" className={cn(top, 'text-left')}>
              Usage breakdown
            </th>
          </tr>
          <tr>
            {['Count', 'Optimized', 'RAW', 'Count', 'Duration', 'Optimized', 'Original'].map((h, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: fixed headings, two "Count" and two "Optimized"
              <th key={i} scope="col" className={sub}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length ? (
            rows.map((x) => (
              <tr key={x.key} className="hover:*:bg-[color-mix(in_srgb,var(--app-fg)_4%,var(--app-surface))]">
                <th scope="row" className={cn(cell, firstCol, 'z-1 text-left font-semibold', x.muted ? 'text-muted' : 'text-fg')}>
                  <span className="block truncate" title={x.name}>
                    {x.name}
                  </span>
                </th>
                <Cells r={x.r} muted={x.muted} />
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={10} className={cn(cell, 'p-6! text-center text-muted')}>
                {empty}
              </td>
            </tr>
          )}
        </tbody>
        {total && rows.length > 1 && (
          <tfoot>
            <tr>
              <th scope="row" className={cn(foot, firstCol, 'z-3 text-left text-fg')}>
                {total.name}
              </th>
              <Cells r={total.r} inFoot />
            </tr>
          </tfoot>
        )}
      </table>
    </section>
  )
}

/** "Not recorded" label for a camera/type group with no value, saying which media it covers. */
function groupLabel(g: Group, what: string) {
  if (g.name) return g.name
  if (g.videos === 0) return `Photos, ${what} not recorded`
  if (g.videos === g.count) return `Videos, ${what} not recorded`
  return `${what[0].toUpperCase() + what.slice(1)} not recorded`
}

function GroupBars({ rows, what }: { rows: Group[]; what: string }) {
  if (!rows.length) return <p className={helpClass}>Nothing here yet.</p>
  return (
    <HBars
      items={rows.map((r, i) => {
        const label = groupLabel(r, what)
        const split = `${n(r.count - r.videos)} photos, ${n(r.videos)} videos`
        return {
          key: i,
          label,
          value: r.total_kb,
          title: `${label}: ${fmtBytes(r.total_kb)} (${fmtBytes(r.optimized_kb)} optimized) in ${n(r.count)} items · ${split}`,
        }
      })}
      format={fmtBytes}
    />
  )
}

const TABLES = [
  ['library', 'By library'],
  ['year', 'By year'],
  ['month', 'By month'],
] as const
type Table = (typeof TABLES)[number][0]
const monthName = (d: Date) => fmtDate(d, { month: 'short', year: 'numeric' })
const Nw = ({ children }: { children: ReactNode }) => <span className="whitespace-nowrap">{children}</span>

export function StoragePage() {
  const q = useQuery(storageQuery)
  const s = useMemo(() => (q.data ? storageOf(q.data) : null), [q.data])
  return (
    <div className={pageClass(true)}>
      <PageHead
        title="Storage"
        sub={
          s
            ? `Disk space used by optimized files and the originals kept alongside them · ${fb(s.all.total_kb)} for ${n(s.all.count)} items`
            : undefined
        }
        className="mb-4"
      />
      <QueryView query={q} skeleton={<SkeletonRows rows={8} />}>
        {() => s && <StorageBody s={s} failed={q.isError} retry={() => q.refetch()} />}
      </QueryView>
    </div>
  )
}

function StorageBody({ s, failed, retry }: { s: Storage; failed: boolean; retry: () => void }) {
  const [params, setParam] = useParamSetter()
  const tab: Table = (TABLES.find(([k]) => k === params.get('by')) ?? TABLES[0])[0]
  const months = useMemo(() => allMonths(s.by_month, monthName), [s])
  const undated = s.undated ? [{ key: 'undated', name: 'No date', muted: true, r: s.undated }] : []
  const tables = {
    library: { first: 'Library', rows: s.by_library.map((r) => ({ key: String(r.id), name: r.name, r })), empty: 'No libraries.' },
    year: {
      first: 'Year',
      rows: [...s.by_year.map((r) => ({ key: String(r.year), name: String(r.year), r })), ...undated],
      empty: 'No dated items.',
    },
    month: { first: 'Month', rows: [...months, ...undated], empty: 'No dated items.' },
  }[tab]
  return (
    <>
      {failed && <InlineFail what="the latest storage numbers (showing saved ones)" retry={retry} />}
      <div className={tilesClass}>
        <StatTile
          swatch={COLOUR.photo}
          label="Photos storage"
          value={fb(s.photo.total_kb)}
          sub={
            <>
              <Nw>
                <strong>{fb(s.photo.optimized_kb)}</strong> optimized
              </Nw>{' '}
              ·{' '}
              <Nw>
                <strong>{fb(s.photo.overhead_kb)}</strong> RAW
              </Nw>{' '}
              · <Nw>{n(s.photo.count)} files</Nw>
            </>
          }
        />
        <StatTile
          swatch={COLOUR.video}
          label="Videos storage"
          value={fb(s.video.total_kb)}
          sub={
            <>
              <Nw>
                <strong>{fb(s.video.optimized_kb)}</strong> optimized
              </Nw>{' '}
              ·{' '}
              <Nw>
                <strong>{fb(s.video.overhead_kb)}</strong> original
              </Nw>{' '}
              · <Nw>{n(s.video.count)} files</Nw> · <Nw>{fmtHms(s.video.length_s)}</Nw>
            </>
          }
        />
        <StatTile
          swatch="bg-accent"
          label="Combined library"
          value={fb(s.all.total_kb)}
          sub={
            <>
              <Nw>
                <strong>{fb(s.all.optimized_kb)}</strong> optimized
              </Nw>{' '}
              ·{' '}
              <Nw>
                <strong>{fb(s.all.overhead_kb)}</strong> overhead
              </Nw>{' '}
              · <Nw>{n(s.all.count)} files</Nw>
            </>
          }
        />
      </div>
      <section className={cn(statCardClass, 'mb-3')}>
        <CardHead>
          <div
            role="tablist"
            aria-label="Group storage"
            className="mr-auto inline-flex flex-none gap-0.5 rounded-sm border border-border bg-surface-2 p-0.5"
          >
            {TABLES.map(([k, l]) => (
              <button
                key={k}
                type="button"
                id={`st-tab-${k}`}
                role="tab"
                aria-selected={k === tab}
                aria-controls="st-panel"
                onClick={() => setParam('by', k)}
                className={cn(
                  'inline-flex h-6.5 items-center gap-1.25 rounded-xs border-0 bg-transparent px-2.5 text-xs font-medium text-muted hover:text-fg',
                  k === tab && 'bg-surface text-fg shadow-[0_1px_2px_rgba(16,24,40,0.08),0_0_0_1px_var(--app-border)]',
                )}
              >
                {l}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-x-3.5 gap-y-1 text-xs text-muted" aria-hidden="true">
            {SERIES.map((x) => (
              <span key={x.key} className="inline-flex items-center gap-1.5 whitespace-nowrap">
                <Swatch k={x.key} />
                {x.label}
              </span>
            ))}
          </div>
        </CardHead>
        <div id="st-panel" role="tabpanel" aria-labelledby={`st-tab-${tab}`}>
          <StorageTable
            first={tables.first}
            rows={tables.rows}
            empty={tables.empty}
            tall={tab === 'month'}
            total={{
              name: `All (${n(tables.rows.length)} ${{ library: 'libraries', year: 'rows', month: 'rows' }[tab]})`,
              r: sumRows(tables.rows.map((x) => x.r)),
            }}
          />
        </div>
      </section>
      <div className={cardGridClass}>
        <StatCard title="By camera">
          <GroupBars rows={s.by_camera} what="camera" />
        </StatCard>
        <StatCard title="By type">
          <GroupBars rows={s.by_type} what="type" />
        </StatCard>
        <StatCard title="Largest items" wide>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(7rem,1fr))] gap-1.5">
            {s.largest.map((p) => (
              <LargestItem key={p.id} p={p} />
            ))}
          </div>
        </StatCard>
      </div>
    </>
  )
}

function LargestItem({ p }: { p: Storage['largest'][number] }) {
  const src = safeHref(p.thumb_url)
  return (
    <Link
      to={`/photos?photo=${p.id}`}
      className="relative aspect-square overflow-hidden rounded-sm bg-surface-2"
      title={p.date_taken ? fmtDate(new Date(p.date_taken), { month: 'short', day: 'numeric', year: 'numeric' }) : ''}
    >
      {src && <img src={src} alt="" loading="lazy" decoding="async" className="size-full object-cover" />}
      <span className="absolute bottom-1 left-1 inline-flex items-center gap-0.75 rounded-full bg-black/60 px-1.5 py-px text-2xs text-white tabular-nums">
        {p.video && <Icon name="play" size={10} />}
        {fmtBytes(p.size_kb)}
      </span>
    </Link>
  )
}
