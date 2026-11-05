// Never blank out: per-section error boundaries, a non-blocking "can't reach the server" banner,
// and a sessionStorage copy of the query cache so a reload during a server restart still paints.
import { Component, useSyncExternalStore, type ErrorInfo, type ReactNode } from 'react'
import { type QueryClient, useQueryClient } from '@tanstack/react-query'
import { ApiError } from '../lib/api'
import { Icon } from './Icon'

// ---------------------------------------------------------------- per-section boundary
export class Boundary extends Component<{ children: ReactNode; label?: string; className?: string }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Section failed', this.props.label ?? '', error, info.componentStack)
  }
  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className={'inline-fail ' + (this.props.className ?? '')} role="alert">
        <Icon name="alert" size={14} />
        <span>Couldn't load{this.props.label ? ` ${this.props.label}` : ''}</span>
        <button className="btn ghost sm" onClick={() => this.setState({ error: null })}>Retry</button>
      </div>
    )
  }
}

/** Small inline notice for a failed request whose section still renders (e.g. events over a calendar grid). */
export function InlineFail({ what, retry }: { what: string; retry?: () => void }) {
  return (
    <div className="inline-fail" role="status">
      <Icon name="alert" size={14} />
      <span>Couldn't load {what}</span>
      {retry && <button className="btn ghost sm" onClick={retry}>Retry</button>}
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
    <div className="net-banner" role="status" aria-live="polite">
      <Icon name="alert" size={14} />
      <span>
        {offline ? "You're offline." : "Can't reach the server, retrying…"}
        {saved ? ' Showing a saved copy.' : ''}
      </span>
      <button className="btn ghost sm" onClick={() => qc.refetchQueries({ type: 'active' })}>Retry now</button>
    </div>
  )
}

// ---------------------------------------------------------------- sessionStorage copy of the cache
const STORE = 'app.qc.v1'
const PERSIST = new Set(['me', 'tasks', 'calendar', 'notifications', 'habits', 'contacts', 'places'])
const MAX_ENTRY = 150_000
const MAX_TOTAL = 2_000_000
let restoredAt = 0

export function clearSavedCache() {
  try {
    sessionStorage.removeItem(STORE)
  } catch { /* ignore */ }
}

/** Paint the last data immediately after a reload; it is stale, so it refetches as usual. */
export function restoreCache(qc: QueryClient) {
  try {
    const raw = sessionStorage.getItem(STORE)
    if (!raw) return
    const saved = JSON.parse(raw) as { at: number; q: [unknown[], unknown, number][] }
    if (!saved?.q || Date.now() - saved.at > 6 * 3600_000) return clearSavedCache()
    for (const [key, data, at] of saved.q) qc.setQueryData(key, data, { updatedAt: at })
    restoredAt = saved.at
  } catch {
    clearSavedCache()
  }
}

export function persistCache(qc: QueryClient) {
  let timer: ReturnType<typeof setTimeout> | null = null
  const save = () => {
    timer = null
    const out: [unknown[], unknown, number][] = []
    let total = 0
    for (const q of qc.getQueryCache().getAll()) {
      const key = q.queryKey as unknown[]
      if (q.state.status !== 'success' || !PERSIST.has(String(key[0])) || q.state.data === undefined) continue
      if ((q.state.data as { pages?: unknown })?.pages) continue // infinite lists: too big, cheap to refetch
      const json = JSON.stringify(q.state.data)
      if (json.length > MAX_ENTRY || total + json.length > MAX_TOTAL) continue
      total += json.length
      out.push([key, q.state.data, q.state.dataUpdatedAt])
    }
    try {
      sessionStorage.setItem(STORE, JSON.stringify({ at: Date.now(), q: out }))
    } catch { /* quota or blocked: just don't persist */ }
  }
  qc.getQueryCache().subscribe((e) => {
    if (e.type === 'updated' && e.action.type === 'success' && !timer) timer = setTimeout(save, 2000)
  })
}
