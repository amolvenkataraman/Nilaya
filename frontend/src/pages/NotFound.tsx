import { Link, useRouteError } from 'react-router'
import { AppShell } from '../components/AppShell'

export function NotFound() {
  return (
    <AppShell app="home" title="AVNet Superapp" pageTitle="Not found">
      <div className="page">
        <div className="card card-body" style={{ maxWidth: '28rem', margin: '10vh auto', textAlign: 'center', display: 'grid', gap: '0.5rem' }}>
          <h1>Page not found</h1>
          <p className="muted small">That page doesn't exist. It may have moved, or the link may be wrong.</p>
          <p><Link to="/">Go home</Link></p>
        </div>
      </div>
    </AppShell>
  )
}

export function RouteError() {
  const err = useRouteError() as Error | undefined
  // A new deploy replaced the lazily loaded chunks: reload once to pick up the new build.
  if (err && /dynamically imported module|Importing a module script failed|Failed to fetch/i.test(err.message ?? '')) {
    let first = false
    try {
      first = !sessionStorage.getItem('app.reloaded')
      sessionStorage.setItem('app.reloaded', '1')
    } catch { /* storage blocked: show the error instead of looping */ }
    if (first) {
      window.location.reload()
      return null
    }
  }
  return (
    <div className="page">
      <div className="card card-body" style={{ maxWidth: '30rem', margin: '10vh auto', display: 'grid', gap: '0.5rem' }}>
        <h1>Something went wrong</h1>
        <p className="muted small">{err?.message || 'An unexpected error happened.'}</p>
        <p className="row"><button className="btn" onClick={() => window.location.reload()}>Reload</button><a className="btn ghost" href="/">Go home</a></p>
      </div>
    </div>
  )
}
