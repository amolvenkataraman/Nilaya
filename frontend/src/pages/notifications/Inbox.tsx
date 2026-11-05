import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query'
import { Icon } from '../../components/Icon'
import { Confirm, ErrorBox, SkeletonRows, useDebounced, useHotkey } from '../../components/ui'
import { NotificationRow, useOpenNotification } from '../../components/NotificationBell'
import { toast } from '../../components/toast'
import { del, get, post } from '../../lib/api'
import { useMarkRead, useReadAll } from '../../lib/queries'
import { dayDiff, fmtDate, groupByDay } from '../../lib/dates'
import type { Inbox } from '../../lib/types'

const PAGE = 30
type Pages = InfiniteData<Inbox, string | undefined>
// Not under ['notifications','inbox'] on purpose: those caches hold a flat Inbox, this one holds pages.
const pageKey = (unreadOnly: boolean, q: string, source: string) => ['notifications', 'page', unreadOnly, q, source] as const

function dayLabel(d: Date | null, now = new Date()): string {
  if (!d) return 'Undated'
  const diff = dayDiff(d, now)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Yesterday'
  if (diff < 7) return fmtDate(d, { weekday: 'long' })
  return fmtDate(d, d.getFullYear() === now.getFullYear() ? { weekday: 'short', month: 'long', day: 'numeric' } : { month: 'long', day: 'numeric', year: 'numeric' })
}

function patchPages(qc: ReturnType<typeof useQueryClient>, fn: (d: Pages) => Pages) {
  qc.setQueriesData<Pages>({ queryKey: ['notifications', 'page'] }, (old) => (old ? fn(old) : old))
}

export function InboxTab({ unreadOnly }: { unreadOnly: boolean }) {
  const qc = useQueryClient()
  const open = useOpenNotification()
  const readAll = useReadAll()
  // Search and source filter on the server (they combine with unread_only and the before cursor).
  const [source, setSource] = useState('')
  const [search, setSearch] = useState('')
  const needle = useDebounced(search.trim(), 250)
  const sourcesQ = useQuery({ queryKey: ['notifications', 'sources'], queryFn: () => get<string[]>('notifications/sources'), staleTime: 60_000 })
  const q = useInfiniteQuery({
    queryKey: pageKey(unreadOnly, needle, source),
    queryFn: ({ pageParam, signal }) =>
      get<Inbox>('notifications/', { unread_only: unreadOnly || undefined, q: needle || undefined, source: source || undefined, limit: PAGE, before: pageParam }, signal),
    placeholderData: (prev) => prev,
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => (last.items.length < PAGE ? undefined : last.items[last.items.length - 1].created_on),
  })

  // NotificationRow / the bell mark items read through the shared mutation; mirror it here instantly.
  useEffect(
    () =>
      qc.getMutationCache().subscribe((ev) => {
        if (ev.type !== 'added') return
        const v = ev.mutation.state.variables as { id?: unknown; read?: unknown } | undefined
        if (!v || typeof v.id !== 'string' || Object.keys(v).some((k) => k !== 'id' && k !== 'read')) return
        const read = v.read === undefined ? true : !!v.read
        patchPages(qc, (d) => ({ ...d, pages: d.pages.map((p) => ({ ...p, items: p.items.map((n) => (n.id === v.id ? { ...n, read } : n)) })) }))
      }),
    [qc],
  )

  const remove = useMutation({
    mutationFn: (id: string) => del(`notifications/${id}`),
    onMutate: (id) => {
      const snaps = qc.getQueriesData<Pages>({ queryKey: ['notifications', 'page'] })
      patchPages(qc, (d) => ({ ...d, pages: d.pages.map((p) => ({ ...p, items: p.items.filter((n) => n.id !== id) })) }))
      return { snaps }
    },
    onError: (e, _id, ctx) => {
      ctx?.snaps.forEach(([k, d]) => qc.setQueryData(k, d))
      toast.error((e as Error).message)
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  })

  const all = useMemo(() => q.data?.pages.flatMap((p) => p.items) ?? [], [q.data])
  const unread = q.data?.pages[0]?.unread ?? 0
  const [, setParams] = useSearchParams()
  const sources = sourcesQ.data ?? []
  const items = all
  const groups = useMemo(() => groupByDay(items, (n) => n.created_on), [items])
  const [confirmClear, setConfirmClear] = useState(false)
  const mark = useMarkRead()

  // Keyboard: j/k move, Enter opens, e toggles read, # deletes.
  const [sel, setSel] = useState<string | null>(null)
  const selected = items.find((n) => n.id === sel) ?? null
  const move = (dir: 1 | -1) => {
    if (!items.length) return
    const i = items.findIndex((n) => n.id === sel)
    const next = items[Math.max(0, Math.min(items.length - 1, i < 0 ? 0 : i + dir))]
    setSel(next.id)
    document.querySelector(`[data-notif="${next.id}"]`)?.scrollIntoView({ block: 'nearest' })
  }
  useHotkey((e) => (e.key === 'j' || e.key === 'k') && !e.metaKey && !e.ctrlKey, (e) => (e.preventDefault(), move(e.key === 'j' ? 1 : -1)))
  useHotkey((e) => e.key === 'Enter' && !!selected, () => selected && open(selected))
  useHotkey((e) => e.key === 'e' && !!selected, () => selected && mark.mutate({ id: selected.id, read: !selected.read }))
  useHotkey((e) => e.key === '#' && !!selected, () => {
    if (!selected) return
    const i = items.indexOf(selected)
    setSel(items[i + 1]?.id ?? items[i - 1]?.id ?? null)
    remove.mutate(selected.id)
  })

  // Infinite scroll, with the button as a fallback.
  const sentinel = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = sentinel.current
    if (!el || !q.hasNextPage) return
    const io = new IntersectionObserver((es) => es.some((x) => x.isIntersecting) && !q.isFetchingNextPage && q.fetchNextPage(), { rootMargin: '600px 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [q.hasNextPage, q.isFetchingNextPage, q])

  const clearRead = async () => {
    patchPages(qc, (d) => ({ ...d, pages: d.pages.map((p) => ({ ...p, items: p.items.filter((n) => !n.read) })) }))
    try {
      const r = await post<{ deleted: number }>('notifications/clear-read')
      toast.show(r.deleted ? `Cleared ${r.deleted} read notification${r.deleted === 1 ? '' : 's'}` : 'Nothing to clear')
    } catch (e) {
      toast.error((e as Error).message)
    }
    qc.invalidateQueries({ queryKey: ['notifications'] })
  }

  return (
    <div className="set-section">
      <div className="set-section-head">
        <div className="grow">
          <h1>Inbox</h1>
          <p>{unread ? `${unread} unread` : 'Everything is read'}</p>
        </div>
        <button className="btn sm" disabled={!all.length && !needle && !source} onClick={() => setConfirmClear(true)}><Icon name="trash" size={14} />Clear read</button>
        <button
          className="btn sm"
          disabled={!unread || readAll.isPending}
          onClick={() => {
            patchPages(qc, (d) => ({ ...d, pages: d.pages.map((p) => ({ unread: 0, items: p.items.map((n) => ({ ...n, read: true })) })) }))
            readAll.mutate()
          }}
        >
          <Icon name="check" size={14} />
          Mark all read
        </button>
      </div>

      <div className="inbox-tools">
        <div className="seg" role="group" aria-label="Show">
          <button aria-pressed={!unreadOnly} onClick={() => setParams({})}>All</button>
          <button aria-pressed={unreadOnly} onClick={() => setParams({ unread: '1' })}>Unread{unread ? ` ${unread}` : ''}</button>
        </div>
        <select className="select inbox-source" value={source} onChange={(e) => setSource(e.target.value)} aria-label="Source">
          <option value="">All sources</option>
          {sources.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <label className="inbox-search">
          <Icon name="search" size={14} />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search notifications" aria-label="Search notifications" />
        </label>
      </div>

      <div className="set-card inbox-card">
        {q.isPending ? (
          <SkeletonRows rows={6} avatar />
        ) : q.isError && !q.data ? (
          <ErrorBox error={q.error} retry={() => q.refetch()} />
        ) : !items.length ? (
          <div className="empty inbox-empty">{needle || source ? 'No notifications match.' : unreadOnly ? "You're all caught up." : 'No notifications yet.'}</div>
        ) : (
          groups.map((g) => (
            <div key={g.key} className="inbox-group">
              <h3 className="inbox-day">{dayLabel(g.date)}</h3>
              {g.items.map((n) => (
                <div key={n.id} className="inbox-row" onMouseDown={() => setSel(n.id)}>
                  <NotificationRow n={n} onOpen={open} onDelete={(x) => remove.mutate(x.id)} selected={n.id === sel} />
                </div>
              ))}
            </div>
          ))
        )}
        <div ref={sentinel} />
        {q.hasNextPage && (
          <div className="inbox-more">
            <button className="btn sm" onClick={() => q.fetchNextPage()} disabled={q.isFetchingNextPage}>
              {q.isFetchingNextPage ? 'Loading…' : 'Load more'}
            </button>
          </div>
        )}
      </div>
      <p className="help inbox-keys"><span className="kbd">J</span>/<span className="kbd">K</span> move · <span className="kbd">Enter</span> open · <span className="kbd">E</span> read/unread · <span className="kbd">#</span> delete</p>
      <Confirm open={confirmClear} title="Clear read notifications?" body="Deletes every read notification in your inbox, not just the ones shown."  confirmLabel="Clear" onConfirm={clearRead} onClose={() => setConfirmClear(false)} />
    </div>
  )
}
