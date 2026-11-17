// The 404 page inside the app, and the route error screen (which reloads once when a deploy replaced the
// lazily loaded code, since only a reload can fix that).
import { Link, useRouteError } from 'react-router'
import { AppShell } from '../components/AppShell'
import { Button, buttonClass, cardClass, pageClass } from '../components/ui'
import { cn } from '../lib/cn'
import { isStaleChunkError, reloadForNewBuild } from '../lib/newBuild'

const box = cn(cardClass, 'mx-auto my-[10vh] grid gap-2 px-4 py-3')
const page = cn(pageClass(true), 'max-w-[96rem]')

export function NotFound() {
  return (
    <AppShell app="home" title="Nilaya" pageTitle="Not found">
      <div className={page}>
        <div className={cn(box, 'max-w-[28rem] text-center')}>
          <h1 className="text-lg font-semibold">Page not found</h1>
          <p className="text-sm text-muted">That page doesn't exist. It may have moved, or the link may be wrong.</p>
          <p>
            <Link to="/">Go home</Link>
          </p>
        </div>
      </div>
    </AppShell>
  )
}

export function RouteError() {
  const err = useRouteError() as Error | undefined
  // A new deploy replaced the lazily loaded chunks: reload once to pick up the new build.
  if (isStaleChunkError(err) && reloadForNewBuild()) return null
  return (
    <div className={page}>
      <div className={cn(box, 'max-w-[30rem]')}>
        <h1 className="text-lg font-semibold">Something went wrong</h1>
        <p className="text-sm text-muted">{err?.message || 'An unexpected error happened.'}</p>
        <p className="flex items-center gap-2">
          <Button onClick={() => window.location.reload()}>Reload</Button>
          <a className={buttonClass({ variant: 'ghost', className: 'hover:no-underline' })} href="/">
            Go home
          </a>
        </p>
      </div>
    </div>
  )
}
