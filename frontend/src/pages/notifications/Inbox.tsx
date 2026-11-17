// Notifications › Inbox: every notification, grouped by day, loaded 30 at a time as you scroll. Search, source
// and the unread filter run on the server. Keyboard: J/K move, Enter opens, E toggles read, # deletes.
import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { Icon } from '../../components/Icon'
import { layerOpen } from '../../components/layers'
import { NotificationRow, useOpenNotification } from '../../components/NotificationBell'
import {
  Button,
  cardClass,
  Confirm,
  EmptyState,
  Kbd,
  QueryView,
  SearchBox,
  Segmented,
  Select,
  SkeletonRows,
  useDebounced,
  useHotkey,
} from '../../components/ui'
import { cn } from '../../lib/cn'
import { dayDiff, fmtDate, groupByDay } from '../../lib/dates'
import { SettingsSection } from '../settings/SettingsSection'
import { inboxPagesQuery, sourcesQuery, useClearRead, useDeleteNotification, useInboxReads } from './api'

function dayLabel(d: Date | null, now = new Date()): string {
  if (!d) return 'Undated'
  const diff = dayDiff(d, now)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Yesterday'
  if (diff < 7) return fmtDate(d, { weekday: 'long' })
  return fmtDate(
    d,
    d.getFullYear() === now.getFullYear()
      ? { weekday: 'short', month: 'long', day: 'numeric' }
      : { month: 'long', day: 'numeric', year: 'numeric' },
  )
}

const noModifier = (e: KeyboardEvent) => !e.metaKey && !e.ctrlKey && !e.altKey && !layerOpen()

export function InboxTab({ unreadOnly }: { unreadOnly: boolean }) {
  const open = useOpenNotification()
  const reads = useInboxReads()
  const remove = useDeleteNotification()
  const clear = useClearRead()
  const [, setParams] = useSearchParams()
  const [source, setSource] = useState('')
  const [search, setSearch] = useState('')
  const needle = useDebounced(search.trim(), 250)
  const sources = useQuery(sourcesQuery()).data ?? []
  const q = useInfiniteQuery(inboxPagesQuery(unreadOnly, needle, source))
  const items = useMemo(() => q.data?.pages.flatMap((p) => p.items) ?? [], [q.data])
  const groups = useMemo(() => groupByDay(items, (n) => n.created_on), [items])
  const unread = q.data?.pages[0]?.unread ?? 0
  const [confirmClear, setConfirmClear] = useState(false)

  const [sel, setSel] = useState<string | null>(null)
  const selected = items.find((n) => n.id === sel) ?? null
  const move = (dir: 1 | -1) => {
    if (!items.length) return
    const i = items.findIndex((n) => n.id === sel)
    const next = items[Math.max(0, Math.min(items.length - 1, i < 0 ? 0 : i + dir))]
    setSel(next.id)
    document.querySelector(`[data-notif="${next.id}"]`)?.scrollIntoView({ block: 'nearest' })
  }
  useHotkey(
    (e) => (e.key === 'j' || e.key === 'k') && noModifier(e),
    (e) => {
      e.preventDefault()
      move(e.key === 'j' ? 1 : -1)
    },
  )
  useHotkey(
    (e) => e.key === 'Enter' && !!selected && !layerOpen(),
    () => selected && open(selected),
  )
  useHotkey(
    (e) => e.key === 'e' && !!selected && noModifier(e),
    () => selected && reads.mark(selected, !selected.read),
  )
  useHotkey(
    (e) => e.key === '#' && !!selected && !layerOpen(),
    () => {
      if (!selected) return
      const i = items.indexOf(selected)
      setSel(items[i + 1]?.id ?? items[i - 1]?.id ?? null)
      remove.mutate(selected.id)
    },
  )

  // Infinite scroll, with the button as a fallback.
  const sentinel = useRef<HTMLDivElement>(null)
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = q
  useEffect(() => {
    const el = sentinel.current
    if (!el || !hasNextPage) return
    const io = new IntersectionObserver(
      (es) => {
        if (es.some((x) => x.isIntersecting) && !isFetchingNextPage) fetchNextPage()
      },
      { rootMargin: '600px 0px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])

  return (
    <SettingsSection
      page
      title="Inbox"
      description={unread ? `${unread} unread` : 'Everything is read'}
      actions={
        <>
          <Button size="sm" disabled={!items.length && !needle && !source} onClick={() => setConfirmClear(true)}>
            <Icon name="trash" size={14} />
            Clear read
          </Button>
          <Button size="sm" disabled={!unread || reads.readingAll} onClick={reads.readAll}>
            <Icon name="check" size={14} />
            Mark all read
          </Button>
        </>
      }
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Segmented
          label="Show"
          value={unreadOnly ? 'unread' : 'all'}
          onChange={(v) => setParams(v === 'unread' ? { unread: '1' } : {})}
          options={[
            { value: 'all', label: 'All' },
            { value: 'unread', label: `Unread${unread ? ` ${unread}` : ''}` },
          ]}
        />
        <Select className="w-auto! min-w-36" value={source} onChange={(e) => setSource(e.target.value)} aria-label="Source">
          <option value="">All sources</option>
          {sources.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
        <SearchBox
          className={'min-w-48 flex-1 max-md:basis-full'}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search notifications"
          aria-label="Search notifications"
        />
      </div>

      <div className={cardClass}>
        <QueryView
          query={q}
          skeleton={<SkeletonRows rows={6} avatar />}
          isEmpty={() => !items.length}
          empty={
            <EmptyState className="py-10">
              {needle || source ? 'No notifications match.' : unreadOnly ? "You're all caught up." : 'No notifications yet.'}
            </EmptyState>
          }
        >
          {() =>
            groups.map((g, i) => (
              <div key={g.key} className={cn(i > 0 && 'border-t border-border')}>
                <h3
                  className={cn(
                    'sticky top-12 z-1 bg-[color-mix(in_srgb,var(--app-surface)_94%,transparent)] px-4 pt-2 pb-1.5 text-xs font-semibold text-muted backdrop-blur-[6px]',
                    i === 0 && 'rounded-t-md',
                  )}
                >
                  {dayLabel(g.date)}
                </h3>
                {g.items.map((n) => (
                  // The row is its own button; this only picks the row the keys act on. Inbox rows sit a little
                  // further in than the bell's (`!` until NotificationRow takes a padding option).
                  // biome-ignore lint/a11y/noStaticElementInteractions: selection for the keyboard shortcuts
                  <div key={n.id} className="mx-1 last:mb-1.5 [&_.notif]:pl-3!" onMouseDown={() => setSel(n.id)}>
                    <NotificationRow n={n} onOpen={open} onDelete={(x) => remove.mutate(x.id)} selected={n.id === sel} />
                  </div>
                ))}
              </div>
            ))
          }
        </QueryView>
        <div ref={sentinel} />
        {q.hasNextPage && (
          <div className="flex justify-center border-t border-border p-3">
            <Button size="sm" onClick={() => q.fetchNextPage()} disabled={q.isFetchingNextPage}>
              {q.isFetchingNextPage ? 'Loading…' : 'Load more'}
            </Button>
          </div>
        )}
      </div>
      <p className="mt-2 text-xs text-muted max-md:hidden">
        <Kbd>J</Kbd>/<Kbd>K</Kbd> move · <Kbd>Enter</Kbd> open · <Kbd>E</Kbd> read/unread · <Kbd>#</Kbd> delete
      </p>
      <Confirm
        open={confirmClear}
        title="Clear read notifications?"
        body="Deletes every read notification in your inbox, not just the ones shown."
        confirmLabel="Clear"
        onConfirm={() => clear.mutate()}
        onClose={() => setConfirmClear(false)}
      />
    </SettingsSection>
  )
}
