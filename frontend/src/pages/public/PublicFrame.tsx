// Chrome for the standalone pages anyone with a link may open (sign-in, public calendars,
// countdowns, shared albums): a slim top bar and a centred column. No /me request, so a
// signed-out visitor never hits an endpoint that needs a session.
import { type ReactNode, useEffect } from 'react'
import { Link, useLocation } from 'react-router'
import { Icon } from '../../components/Icon'
import { buttonClass, cardClass } from '../../components/ui'
import { loginUrl } from '../../lib/api'
import { cn } from '../../lib/cn'
import { signedIn } from '../../lib/session'
// The shared album's styles (sa-*) until SharedAlbum.tsx moves to Tailwind; nothing else is left in it.

export function usePublicTitle(title: string) {
  useEffect(() => {
    document.title = title ? `${title} · Nilaya` : 'Nilaya'
  }, [title])
}

/** Where "Sign in" should come back to. Kept under this name for SharedAlbum.tsx; it is lib/api's loginUrl. */
export const loginHere = loginUrl

/** Nilaya's mark: the home icon on an accent tile (the app logo's look, in the accent colour). */
export function BrandMark({ icon = 'home', size, iconSize }: { icon?: string; size: 'sm' | 'lg'; iconSize: number }) {
  return (
    <span
      className={cn(
        'inline-grid shrink-0 place-items-center rounded-[28%] bg-[color-mix(in_srgb,var(--app-accent)_14%,var(--app-surface))] text-accent',
        'dark:bg-[color-mix(in_srgb,var(--app-accent)_24%,var(--app-surface))] dark:text-[color-mix(in_srgb,var(--app-accent)_55%,white)]',
        size === 'sm' ? 'size-6.5' : 'size-11',
      )}
      aria-hidden="true"
    >
      <Icon name={icon} size={iconSize} />
    </span>
  )
}

export function PublicFrame({ children, wide, bare }: { children: ReactNode; wide?: boolean; bare?: boolean }) {
  const loc = useLocation()
  const inside = signedIn()
  const onAuthPage = /^\/(login|register)\/?$/.test(loc.pathname)
  return (
    <div className="flex min-h-dvh flex-col bg-bg">
      <header className="sticky top-0 z-20 flex h-12 items-center gap-2 border-b border-border bg-surface px-4 pt-[env(safe-area-inset-top,0)]">
        <a
          href="/"
          className="inline-flex items-center gap-2 font-semibold tracking-[-0.01em] text-fg hover:no-underline"
          aria-label="Nilaya home"
        >
          <BrandMark size="sm" iconSize={15} />
          <span className="text-md">Nilaya</span>
        </a>
        <span className="flex-1" />
        {!onAuthPage &&
          (inside ? (
            <a className={buttonClass({ size: 'sm', className: 'hover:no-underline' })} href="/">
              Open app
              <Icon name="arrowRight" size={13} className="ml-0.5" />
            </a>
          ) : (
            <Link className={buttonClass({ variant: 'primary', size: 'sm', className: 'hover:no-underline' })} to={loginUrl(loc)}>
              Sign in
            </Link>
          ))}
      </header>
      <main
        className={cn(
          'mx-auto grid w-full content-start gap-4',
          bare ? 'max-w-none p-0' : cn('px-4 pt-8 pb-12 max-sm:px-3 max-sm:pt-4 max-sm:pb-8', wide ? 'max-w-[78rem]' : 'max-w-[46rem]'),
        )}
      >
        {children}
      </main>
    </div>
  )
}

/** A friendly full-card message (not found, turned off, ...). */
export function PublicNotice({ icon = 'info', title, children }: { icon?: string; title: string; children?: ReactNode }) {
  return (
    <section className={cn(cardClass, 'mx-auto mt-12 grid max-w-[28rem] justify-items-center gap-3 px-6 py-8 text-center')} role="status">
      <span className="inline-grid size-12 place-items-center rounded-full bg-accent-soft text-accent">
        <Icon name={icon} size={22} />
      </span>
      <h1 className="text-lg font-semibold">{title}</h1>
      {children}
    </section>
  )
}
