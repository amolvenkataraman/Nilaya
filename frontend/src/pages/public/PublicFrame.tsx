// Chrome for the standalone pages anyone with a link may open (sign-in, public calendars,
// countdowns, shared albums): a slim top bar and a centred column. No /me request, so a
// signed-out visitor never hits an endpoint that needs a session.
import { useEffect, type ReactNode } from 'react'
import { Link, useLocation } from 'react-router'
import { Icon } from '../../components/Icon'
import { signedIn } from '../../lib/session'
import './public.css'

export function usePublicTitle(title: string) {
  useEffect(() => {
    document.title = title ? `${title} · Nilaya` : 'Nilaya'
  }, [title])
}

/** Where "Sign in" should come back to: this page. */
export function loginHere(loc: { pathname: string; search: string }): string {
  return '/login?next=' + encodeURIComponent(loc.pathname + loc.search)
}

export function PublicFrame({ children, wide, bare }: { children: ReactNode; wide?: boolean; bare?: boolean }) {
  const loc = useLocation()
  const inside = signedIn()
  const onAuthPage = /^\/(login|register)\/?$/.test(loc.pathname)
  return (
    <div className="pub">
      <header className="pub-bar">
        <a href="/" className="pub-brand" aria-label="Nilaya home">
          <span className="app-logo pub-logo" aria-hidden="true"><Icon name="home" size={15} /></span>
          <span className="pub-brand-text">Nilaya</span>
        </a>
        <span className="grow" />
        {!onAuthPage && (inside
          ? <a className="btn sm" href="/">Open app<Icon name="arrowRight" size={13} /></a>
          : <Link className="btn sm primary" to={loginHere(loc)}>Sign in</Link>)}
      </header>
      <main className={'pub-main' + (wide ? ' wide' : '') + (bare ? ' bare' : '')}>{children}</main>
    </div>
  )
}

/** A friendly full-card message (not found, turned off, ...). */
export function PublicNotice({ icon = 'info', title, children }: { icon?: string; title: string; children?: ReactNode }) {
  return (
    <section className="card pub-notice" role="status">
      <span className="pub-notice-icon"><Icon name={icon} size={22} /></span>
      <h1>{title}</h1>
      {children}
    </section>
  )
}
