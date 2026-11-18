// Per-app chrome, G Suite style: a compact top bar (sidebar toggle, app logo + title, the app's own
// controls, then the small global items: search, bell, theme, app launcher, avatar) and an optional
// app-specific left sidebar that collapses on desktop and becomes a slide-over drawer on phones.
//
//   <AppShell app="calendar" topbar={<Toolbar/>} sidebar={<MiniMonth/>}>{content}</AppShell>
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { Icon } from './Icon'
import { Avatar, Dot, Menu, MenuItem, MenuLabel, MenuSeparator, useIsPhone } from './ui'
import { NotificationBell } from './NotificationBell'
import { APPS, STAFF_APPS, type AppDef } from './nav'
import { logout, useGlobals, usePageTitle } from './Shell'
import { useMe } from '../lib/queries'
import { Boundary, NetworkBanner } from './resilience'
import { cycleTheme, useTheme } from '../lib/theme'
import { useAppFavicon } from '../lib/favicon'
import { useLayer } from './layers'
import { cn } from '../lib/cn'
import { readPref, writePref } from '../lib/storage'
import { buttonClass } from './ui/button'

export interface AppShellProps {
  /** App id from components/nav.ts: picks the logo, title and the remembered sidebar state. */
  app: string
  /** Title next to the logo (defaults to the app's name). */
  title?: ReactNode
  /** Browser tab title (defaults to the app's name). */
  pageTitle?: string
  /** App-specific top-bar controls, placed after the title. */
  topbar?: ReactNode
  /** Optional app-specific left sidebar. */
  sidebar?: ReactNode
  sidebarWidth?: string
  /** Content fills the viewport and scrolls inside (calendar grids, boards) instead of the page scrolling. */
  fullHeight?: boolean
  children: ReactNode
}

export function AppLogo({ app, size = 1.5 }: { app: AppDef; size?: number }) {
  return (
    <span
      className={cn(
        'inline-grid flex-none place-items-center rounded-[28%] text-(--hue)',
        'bg-[color-mix(in_srgb,var(--hue)_14%,var(--app-surface))]',
        'dark:bg-[color-mix(in_srgb,var(--hue)_24%,var(--app-surface))] dark:text-[color-mix(in_srgb,var(--hue)_55%,white)]',
      )}
      style={{ '--hue': app.hue, width: `${size}rem`, height: `${size}rem` } as CSSProperties}
      aria-hidden="true"
    >
      <Icon name={app.icon} size={size * 10.5} />
    </span>
  )
}

export function AppShell({ app: appId, title, pageTitle, topbar, sidebar, sidebarWidth, fullHeight, children }: AppShellProps) {
  const app = APPS.find((a) => a.id === appId) ?? APPS[0]
  usePageTitle(pageTitle ?? app.label)
  useAppFavicon(app)
  const phone = useIsPhone()
  const [open, setOpen] = useState(() => readPref(`app.sidebar.${appId}`, true))
  const [drawer, setDrawer] = useState(false)
  useLayer('drawer', drawer)
  const location = useLocation()

  useEffect(() => setDrawer(false), [location.pathname, location.search])
  useEffect(() => {
    if (!drawer) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setDrawer(false)
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [drawer])

  const toggle = () => {
    if (phone) return setDrawer((d) => !d)
    setOpen((o) => {
      writePref(`app.sidebar.${appId}`, !o)
      return !o
    })
  }
  const showSidebar = !!sidebar && (phone ? drawer : open)

  // Class names without styles (topbar, topbar-app, app-title-text, app-sidebar) are hooks other code queries.
  return (
    <div className={cn('flex min-h-dvh flex-col', fullHeight && 'h-dvh')} data-app={app.id}>
      <a className="absolute top-2 -left-[999px] z-100 rounded-sm bg-surface px-3 py-2 shadow-pop focus:left-2" href="#content">
        Skip to content
      </a>
      <header
        className={cn(
          'topbar sticky top-0 z-25 flex h-12 min-w-0 flex-none items-center gap-1 border-b border-border bg-surface px-2',
          'max-md:h-[calc(3rem+env(safe-area-inset-top,0px))] max-md:gap-0 max-md:pt-[env(safe-area-inset-top,0px)] max-md:pr-1 max-md:pl-1.5',
        )}
      >
        {sidebar ? (
          <button
            type="button"
            className={buttonClass({ variant: 'ghost', icon: true })}
            onClick={toggle}
            aria-label={showSidebar ? 'Hide sidebar' : 'Show sidebar'}
            aria-expanded={showSidebar}
            aria-controls="app-sidebar"
            title={showSidebar ? 'Hide sidebar' : 'Show sidebar'}
          >
            <Icon name="menu" size={18} />
          </button>
        ) : null}
        <Link
          to={app.to}
          className="flex h-8 max-w-56 flex-none items-center gap-2 rounded-sm pr-2 pl-1 text-fg hover:bg-hover hover:no-underline max-md:max-w-36 max-md:px-1"
          aria-label={`${app.label} home`}
        >
          <AppLogo app={app} />
          <span className="app-title-text truncate text-md font-semibold tracking-[-0.01em] max-md:text-base">{title ?? app.label}</span>
        </Link>
        <div className="topbar-app flex min-w-0 flex-1 items-center gap-1.5 pl-2 max-md:pl-1">{topbar}</div>
        <GlobalItems />
      </header>
      <NetworkBanner />
      <div className="flex min-h-0 min-w-0 flex-1">
        {sidebar && (
          <>
            {phone && drawer && (
              // biome-ignore lint/a11y/noStaticElementInteractions: the backdrop; Escape and the close button also close it
              <div className="fixed inset-0 z-65 animate-[fade-in_0.15s_ease] bg-scrim" onClick={() => setDrawer(false)} />
            )}
            <aside
              id="app-sidebar"
              className={cn(
                'app-sidebar w-(--sb-w) flex-none self-start overflow-x-hidden overflow-y-auto border-r border-border bg-bg p-2',
                phone
                  ? 'fixed inset-y-0 left-0 z-66 h-dvh w-[min(18rem,86vw)] animate-[drawer-left_0.2s_var(--ease)] pt-[calc(0.5rem+env(safe-area-inset-top,0px))] shadow-[12px_0_32px_rgba(16,24,40,0.18)]'
                  : fullHeight
                    ? 'relative h-full'
                    : 'sticky top-12 h-[calc(100dvh-3rem)]',
              )}
              style={{ '--sb-w': sidebarWidth ?? '16rem' } as CSSProperties}
              aria-label={`${app.label} navigation`}
              hidden={!showSidebar}
            >
              {phone && (
                <div className="-mx-2 -mt-2 mb-2 flex h-11 items-center gap-2 border-b border-border pr-1 pl-1.5">
                  <AppLogo app={app} />
                  <strong className="min-w-0 flex-1">{app.label}</strong>
                  <button
                    type="button"
                    className={buttonClass({ variant: 'ghost', size: 'sm', icon: true })}
                    onClick={() => setDrawer(false)}
                    aria-label="Close sidebar"
                  >
                    <Icon name="x" />
                  </button>
                </div>
              )}
              <Boundary label="this panel">{sidebar}</Boundary>
            </aside>
          </>
        )}
        <main id="content" className={cn('min-w-0 flex-1 outline-none', fullHeight && 'h-full overflow-auto')} tabIndex={-1}>
          <Boundary label="this page" className="mx-auto my-6 max-w-120">
            {children}
          </Boundary>
        </main>
      </div>
    </div>
  )
}

const LAUNCHER_APP =
  'grid min-w-0 justify-items-center gap-1 rounded-md px-1 py-1.5 text-center text-xs font-medium text-fg hover:bg-hover hover:no-underline focus-visible:bg-hover'

function GlobalItems() {
  const { openPalette } = useGlobals()
  const me = useMe().data
  const { pref } = useTheme()
  const navigate = useNavigate()
  const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
  const name = me ? [me.first_name, me.last_name].filter(Boolean).join(' ') || me.username : ''
  const themeIcon = pref === 'system' ? 'monitor' : pref === 'dark' ? 'moon' : 'sun'
  const themeLabel = { system: 'Theme: system', light: 'Theme: light', dark: 'Theme: dark' }[pref]
  return (
    <div className="flex flex-none items-center gap-0.5">
      <button
        type="button"
        className={cn(
          'mr-1 flex h-8 w-52 items-center gap-2 rounded-sm border border-border bg-bg pr-1.5 pl-2.5 text-left text-sm text-muted',
          'hover:border-[color-mix(in_srgb,var(--app-muted)_45%,var(--app-border))] hover:text-fg',
          'max-[1100px]:m-0 max-[1100px]:w-auto max-[1100px]:border-transparent max-[1100px]:bg-transparent max-[1100px]:px-2',
          // Phones: the page's own top-bar controls need the room (and pages with a search have their own).
          'max-md:hidden',
        )}
        onClick={openPalette}
        aria-label="Search or jump to"
        title={`Search or jump to (${mac ? '⌘' : 'Ctrl'} K)`}
      >
        <Icon name="search" />
        <span className="flex-1 max-[1100px]:hidden">Search</span>
        <span className="kbd max-[1100px]:hidden!">{mac ? '⌘' : 'Ctrl'} K</span>
      </button>
      <NotificationBell />
      <button
        type="button"
        className={buttonClass({ variant: 'ghost', icon: true, className: 'max-md:hidden' })}
        onClick={cycleTheme}
        aria-label={`${themeLabel} (click to change)`}
        title={themeLabel}
      >
        <Icon name={themeIcon} size={18} />
      </button>
      <Menu
        align="end"
        label="Apps"
        width="min(20rem, calc(100vw - 16px))"
        trigger={(p) => (
          <button {...p} type="button" className={buttonClass({ variant: 'ghost', icon: true })} aria-label="Apps" title="Apps">
            <Icon name="apps" size={18} />
          </button>
        )}
      >
        {(close) => (
          <div className="grid max-h-[calc(100vh-5rem)] gap-1 overflow-y-auto px-1.5 pt-1 pb-1.5">
            {['', 'Planning', 'People & places', 'Media', 'System'].map((g) => {
              const apps = [...APPS, ...(me?.is_staff ? STAFF_APPS : [])].filter((a) => (a.group ?? '') === g)
              return (
                <div
                  key={g || 'home'}
                  className="not-first:border-t not-first:border-border not-first:pt-1"
                  role="group"
                  aria-label={g || 'Home'}
                >
                  {g && <div className="px-2 pt-1 text-2xs font-semibold tracking-[0.02em] text-muted">{g}</div>}
                  <div className="grid grid-cols-3 gap-0.5">
                    {apps.map((a) =>
                      a.external ? (
                        <a key={a.id} href={a.to} role="menuitem" className={LAUNCHER_APP} onClick={close}>
                          <AppLogo app={a} size={2} />
                          <span className="truncate">{a.label}</span>
                        </a>
                      ) : (
                        <Link key={a.id} to={a.to} role="menuitem" className={LAUNCHER_APP} onClick={close}>
                          <AppLogo app={a} size={2} />
                          <span className="truncate">{a.label}</span>
                        </Link>
                      ),
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </Menu>
      <Menu
        align="end"
        label="Account"
        trigger={(p) => (
          <button
            {...p}
            type="button"
            className="ml-1 rounded-full border-0 bg-transparent p-0.5 [&:hover_.avatar]:shadow-[0_0_0_2px_var(--app-border)]"
            aria-label="Account menu"
          >
            <Avatar name={name || '?'} src={me?.profile_picture} size={1.75} />
          </button>
        )}
      >
        {(close) => (
          <>
            <MenuLabel className="pb-2">
              <div className="text-sm font-semibold text-fg">{name}</div>
              <div className="truncate">{me?.email || me?.username}</div>
            </MenuLabel>
            <MenuSeparator />
            {me && (
              <MenuItem icon="user" onClick={() => (close(), navigate(`/users/${encodeURIComponent(me.username)}`))}>
                Your profile
              </MenuItem>
            )}
            <MenuItem icon="settings" onClick={() => (close(), navigate('/settings'))}>
              Settings
            </MenuItem>
            <MenuItem icon="code" onClick={() => (close(), navigate('/settings#set-guides'))}>
              Developers &amp; API
            </MenuItem>
            {me?.is_staff && (
              <MenuItem icon="chart" onClick={() => (close(), navigate('/settings/usage'))}>
                Usage
              </MenuItem>
            )}
            {me?.is_staff && (
              <MenuItem icon="wrench" href="/admin/" end={<Icon name="external" size={12} />}>
                Admin
              </MenuItem>
            )}
            <MenuItem icon={themeIcon} onClick={cycleTheme}>
              {themeLabel}
            </MenuItem>
            <MenuSeparator />
            <MenuItem icon="logout" onClick={logout}>
              Log out
            </MenuItem>
          </>
        )}
      </Menu>
    </div>
  )
}

/** Sidebar row styles, for pages that build their own rows (a link, a calendar toggle). `side-item` and `side-count`
 *  stay on the elements as hooks: pages target them to make room for a row action or hide the count on hover. */
/** active: the current page · muted: a secondary row in grey (an action under a list rather than an item of it). */
export function sideItemClass(state: 'active' | 'muted' | false = false, className?: string): string {
  return cn(
    'side-item flex h-8 w-full min-w-0 items-center gap-2.5 rounded-sm border-0 px-2 text-left text-sm no-underline hover:no-underline [&>svg]:flex-none',
    state === 'active'
      ? 'bg-accent-soft font-medium text-accent [&>svg]:text-accent'
      : cn('bg-transparent hover:bg-hover [&>svg]:text-muted', state === 'muted' ? 'text-muted' : 'text-fg'),
    className,
  )
}
// Space only between consecutive sections (not after a mini calendar or a search above the first one).
export const SIDE_SECTION = 'side-section grid grid-cols-[minmax(0,1fr)] gap-px [.side-section+&]:mt-4'
export const SIDE_TITLE = 'flex h-7 items-center gap-1 pr-1 pl-2 text-xs font-semibold text-muted'
export const SIDE_EMPTY = 'px-2 py-1 text-xs text-muted'

/** Standard sidebar nav item (use inside an AppShell sidebar). */
export function SideItem({
  icon,
  label,
  active,
  count,
  onClick,
  colour,
  to,
}: {
  icon?: string
  label: ReactNode
  active?: boolean
  count?: ReactNode
  onClick?: () => void
  colour?: string
  to?: string
}) {
  const inner = (
    <>
      {colour ? <Dot colour={colour} /> : icon ? <Icon name={icon} size={16} /> : null}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count != null && count !== 0 && (
        <span className={cn('side-count text-xs tabular-nums', active ? 'text-accent' : 'text-muted')}>{count}</span>
      )}
    </>
  )
  if (to)
    return (
      <Link to={to} className={sideItemClass(active && 'active')} aria-current={active ? 'page' : undefined} onClick={onClick}>
        {inner}
      </Link>
    )
  return (
    <button type="button" className={sideItemClass(active && 'active')} aria-current={active ? 'page' : undefined} onClick={onClick}>
      {inner}
    </button>
  )
}

export function SideSection({ title, action, children }: { title?: ReactNode; action?: ReactNode; children: ReactNode }) {
  return (
    <div className={SIDE_SECTION}>
      {title && (
        <div className={SIDE_TITLE}>
          <span className="min-w-0 flex-1">{title}</span>
          {action}
        </div>
      )}
      {children}
    </div>
  )
}
