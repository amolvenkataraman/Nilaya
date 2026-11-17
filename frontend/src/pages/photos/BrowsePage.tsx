// Photos › Browse (/photos/browse): every city, country, camera and detected object with its photo count,
// filterable; a row opens the timeline filtered to it. The lists are the same cached queries the filters
// drawer uses (browseQuery).
import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { Icon } from '../../components/Icon'
import { QueryView, SkeletonRows } from '../../components/ui'
import { cn } from '../../lib/cn'
import { PageHead, pageClass } from './PageHead'
import { browseQuery } from './queries'
import { n } from './statsData'
import { useParamSetter } from './useParamSetter'

const TABS = [
  { id: 'cities', label: 'Cities', icon: 'pin', param: 'city' },
  { id: 'countries', label: 'Countries', icon: 'globe', param: 'country' },
  { id: 'cameras', label: 'Cameras', icon: 'camera', param: 'camera' },
  { id: 'objects', label: 'Objects', icon: 'tag', param: 'objects' },
] as const

export function BrowsePage() {
  const [params, setParam] = useParamSetter()
  const tab = TABS.find((t) => t.id === params.get('tab')) ?? TABS[0]
  const [filter, setFilter] = useState('')
  const q = useQuery(browseQuery(tab.id))
  const needle = filter.trim().toLowerCase()
  const items = useMemo(() => (q.data ?? []).filter((i) => !needle || i.display.toLowerCase().includes(needle)), [q.data, needle])
  const max = useMemo(() => Math.max(1, ...(q.data ?? []).map((i) => i.count)), [q.data])
  return (
    <div className={pageClass(true)}>
      <PageHead title="Browse" sub="Find photos by place, camera or what's in them." className="mb-4" />
      <div className="mb-4 flex gap-1 overflow-x-auto border-b border-border" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={t.id === tab.id}
            onClick={() => {
              setFilter('')
              setParam('tab', t.id)
            }}
            className={cn(
              '-mb-px inline-flex h-9 items-center gap-1.5 border-0 border-b-2 bg-transparent px-2.5 text-sm font-medium whitespace-nowrap hover:text-fg',
              t.id === tab.id ? 'border-accent text-fg' : 'border-transparent text-muted',
            )}
          >
            <Icon name={t.icon} size={14} />
            {t.label}
          </button>
        ))}
      </div>
      <label className="mb-3 flex h-9 max-w-[28rem] items-center gap-2 rounded-sm border border-border bg-surface px-3 text-muted focus-within:border-accent focus-within:text-fg">
        <Icon name="search" size={14} />
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={`Filter ${tab.label.toLowerCase()}`}
          aria-label={`Filter ${tab.label.toLowerCase()}`}
          className="min-w-0 flex-1 border-0 bg-transparent text-sm outline-none"
        />
        {q.data && <span className="text-xs text-muted tabular-nums">{items.length}</span>}
      </label>
      <QueryView
        query={q}
        skeleton={<SkeletonRows rows={8} />}
        isEmpty={() => !items.length}
        empty={
          <div className="p-4 text-sm text-muted">
            {needle ? 'No matches.' : tab.id === 'objects' ? 'No objects detected yet.' : 'Nothing here yet.'}
          </div>
        }
      >
        {() => (
          <ul className="grid gap-px rounded-md border border-border bg-surface p-1">
            {items.map((i) => {
              const to = `/photos?${new URLSearchParams(tab.id === 'cities' && i.country ? { city: i.value, country: i.country } : { [tab.param]: i.value })}`
              return (
                <li key={i.value + (i.country ?? '')}>
                  <Link
                    to={to}
                    className="flex h-[2.375rem] items-center gap-3 rounded-sm px-3 text-sm text-fg hover:bg-hover hover:no-underline [&>svg]:shrink-0 [&>svg]:text-muted"
                  >
                    <Icon name={tab.icon} size={15} />
                    <span className="min-w-0 flex-1 truncate">{i.display}</span>
                    <span className="h-1.5 w-32 flex-none overflow-hidden rounded-[3px] bg-surface-2 max-md:hidden" aria-hidden="true">
                      <span className="block h-full rounded-[3px] bg-accent" style={{ width: `${(i.count / max) * 100}%` }} />
                    </span>
                    <span className="min-w-14 text-right text-sm text-muted tabular-nums">{n(i.count)}</span>
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </QueryView>
    </div>
  )
}
