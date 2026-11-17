// Never blank out: per-section error boundaries, a non-blocking "can't reach the server" banner,
// and a sessionStorage copy of the query cache so a reload during a server restart still paints.
import { Component, useSyncExternalStore, type ErrorInfo, type ReactNode } from 'react'
import { type QueryClient, useQueryClient } from '@tanstack/react-query'
import { ApiError } from '../lib/api'
import { isStaleChunkError, reloadForNewBuild } from '../lib/newBuild'
import { SESSION_CACHE, ownerId } from '../lib/owner'
import { Icon } from './Icon'
import { Button } from './ui/button'
import { cn } from '../lib/cn'

const INLINE_FAIL =
  'flex items-center gap-2 rounded-sm bg-surface-2 py-1.5 pr-2 pl-3 text-xs text-muted [&>svg]:shrink-0 [&>svg]:text-warning'

// ---------------------------------------------------------------- per-section boundary
export class Boundary extends Component<{ children: ReactNode; label?: string; className?: string }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    // A lazily loaded part from before a deploy: Retry can't fix that (React.lazy keeps the failure), a reload can.
    if (isStaleChunkError(error) && reloadForNewBuild()) return
    console.error('Section failed', this.props.label ?? '', error, info.componentStack)
  }
  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className={cn(INLINE_FAIL, this.props.className)} role="alert">
        <Icon name="alert" size={14} />
        <span>Couldn't load{this.props.label ? ` ${this.props.label}` : ''}</span>
        <Button variant="ghost" size="sm" className="ml-auto" onClick={() => this.setState({ error: null })}>
          Retry
        </Button>
      </div>
    )
  }
}

/** Small inline notice for a failed request whose section still renders (e.g. events over a calendar grid). */
export function InlineFail({ what, retry }: { what: string; retry?: () => void }) {
  return (
    <div className={INLINE_FAIL} role="status">
      <Icon name="alert" size={14} />
      <span>Couldn't load {what}</span>
      {retry && (
        <Button variant="ghost" size="sm" className="ml-auto" onClick={retry}>
          Retry
        </Button>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- network trouble banner
const isNetworkish = (e: unknown) => e instanceof ApiError && (e.status === 0 || e.status >= 500)

function snapshot(qc: QueryClient): string {
  let failing = 0
  let saved = false
  for (const q of qc.getQueryCache().getAll()) {
    const s = q.state
    const err = s.status === 'error' ? s.error : s.fetchFailureCount > 0 ? s.fetchFailureReason : null
    if (err && isNetworkish(err)) {
      failing++
      if (s.data !== undefined && restoredAt && s.dataUpdatedAt <= restoredAt) saved = true
    }
  }
  const offline = typeof navigator !== 'undefined' && navigator.onLine === false
  return `${failing}|${saved ? 1 : 0}|${offline ? 1 : 0}`
}

export function NetworkBanner() {
  const qc = useQueryClient()
  const snap = useSyncExternalStore(
    (cb) => {
      const un = qc.getQueryCache().subscribe(cb)
      window.addEventListener('online', cb)
      window.addEventListener('offline', cb)
      return () => (un(), window.removeEventListener('online', cb), window.removeEventListener('offline', cb))
    },
    () => snapshot(qc),
  )
  const [failing, saved, offline] = snap.split('|').map(Number)
  if (!offline && failing < 2) return null
  return (
    <div
      className="sticky top-12 z-24 flex flex-none items-center justify-center gap-2 border-b border-border bg-warning-soft px-3 py-1.25 text-xs text-fg [&>svg]:text-warning"
      role="status"
      aria-live="polite"
    >
      <Icon name="alert" size={14} />
      <span>
        {offline ? "You're offline." : "Can't reach the server, retrying…"}
        {saved ? ' Showing a saved copy.' : ''}
      </span>
      <Button variant="ghost" size="sm" onClick={() => qc.refetchQueries({ type: 'active' })}>
        Retry now
      </Button>
    </div>
  )
}

// ---------------------------------------------------------------- sessionStorage copy of the cache
const STORE = SESSION_CACHE
const PERSIST = new Set(['me', 'tasks', 'calendar', 'notifications', 'habits', 'contacts', 'places'])
const MAX_ENTRY = 150_000
const MAX_TOTAL = 2_000_000
let restoredAt = 0

function clearSavedCache() {
  try {
    sessionStorage.removeItem(STORE)
  } catch {
    /* ignore */
  }
}

/** Paint the last data immediately after a reload; it is stale, so it refetches as usual. */
export function restoreCache(qc: QueryClient) {
  try {
    const raw = sessionStorage.getItem(STORE)
    if (!raw) return
    const saved = JSON.parse(raw) as { at: number; u?: string; q: [unknown[], unknown, number][] }
    // Only the signed-in user's own copy (owner.ts wipes it on a new login or another user).
    if (!saved?.q || Date.now() - saved.at > 6 * 3600_000 || !saved.u || saved.u !== ownerId()) return clearSavedCache()
    for (const [key, data, at] of saved.q) qc.setQueryData(key, data, { updatedAt: at })
    restoredAt = saved.at
  } catch {
    clearSavedCache()
  }
}

export function persistCache(qc: QueryClient) {
  let timer: ReturnType<typeof setTimeout> | null = null
  // Serialized form per data object: entries that didn't change since the last save aren't re-serialized.
  const seen = new WeakMap<object, string>()
  let last = ''
  const save = () => {
    timer = null
    const out: string[] = []
    let total = 0
    for (const q of qc.getQueryCache().getAll()) {
      const key = q.queryKey as unknown[]
      const data = q.state.data
      if (q.state.status !== 'success' || !PERSIST.has(String(key[0])) || data === undefined) continue
      if ((data as { pages?: unknown })?.pages) continue // infinite lists: too big, cheap to refetch
      let json = typeof data === 'object' && data !== null ? seen.get(data) : undefined
      if (json === undefined) {
        json = JSON.stringify(data)
        if (typeof data === 'object' && data !== null) seen.set(data, json)
      }
      if (json.length > MAX_ENTRY || total + json.length > MAX_TOTAL) continue
      total += json.length
      out.push(`[${JSON.stringify(key)},${json},${q.state.dataUpdatedAt}]`)
    }
    const u = ownerId()
    if (!u) return // not known whose data this is yet: don't keep it
    const body = out.join(',')
    if (body === last) return // nothing new to write
    last = body
    try {
      sessionStorage.setItem(STORE, `{"at":${Date.now()},"u":${JSON.stringify(u)},"q":[${body}]}`)
    } catch {
      /* quota or blocked: just don't persist */
    }
  }
  qc.getQueryCache().subscribe((e) => {
    if (e.type === 'updated' && e.action.type === 'success' && !timer) timer = setTimeout(save, 2000)
  })
}
