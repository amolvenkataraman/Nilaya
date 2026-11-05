// Per-app chrome, G Suite style: a compact top bar (sidebar toggle, app logo + title, the app's own
// controls, then the small global items: search, bell, theme, app launcher, avatar) and an optional
// app-specific left sidebar that collapses on desktop and becomes a slide-over drawer on phones.
//
//   <AppShell app="calendar" topbar={<Toolbar/>} sidebar={<MiniMonth/>}>{content}</AppShell>
import { useEffect, useState, type ReactNode } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { Icon } from './Icon'
import { Avatar, Menu, MenuItem, useMediaQuery } from './ui'
import { NotificationBell } from './NotificationBell'
import { APPS, CLASSIC, type AppDef } from './nav'
import { logout, useGlobals, usePageTitle } from './Shell'
import { useMe } from '../lib/queries'
import { Boundary, NetworkBanner } from './resilience'
import { cycleTheme, useTheme } from '../lib/theme'

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

const PHONE = '(max-width: 760px)'

function readOpen(app: string): boolean {
  try {
    return localStorage.getItem(`app.sidebar.${app}`) !== '0'
  } catch {
    return true
  }
}

export function AppLogo({ app, size = 1.5 }: { app: AppDef; size?: number }) {
  return (
    <span className="app-logo" style={{ '--hue': app.hue, width: `${size}rem`, height: `${size}rem` } as React.CSSProperties} aria-hidden="true">
      <Icon name={app.icon} size={size * 10.5} />
    </span>
  )
}

export function AppShell({ app: appId, title, pageTitle, topbar, sidebar, sidebarWidth, fullHeight, children }: AppShellProps) {
  const app = APPS.find((a) => a.id === appId) ?? APPS[0]
  usePageTitle(pageTitle ?? app.label)
  const phone = useMediaQuery(PHONE)
  const [open, setOpen] = useState(() => readOpen(appId))
  const [drawer, setDrawer] = useState(false)
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
      try {
        localStorage.setItem(`app.sidebar.${appId}`, o ? '0' : '1')
      } catch { /* ignore */ }
      return !o
    })
  }
  const showSidebar = !!sidebar && (phone ? drawer : open)

  return (
    <div className={'app' + (fullHeight ? ' full' : '')} data-app={app.id}>
      <a className="skip-link" href="#content">Skip to content</a>
      <header className="topbar">
        {sidebar ? (
          <button
            className="btn ghost icon"
            onClick={toggle}
            aria-label={showSidebar ? 'Hide sidebar' : 'Show sidebar'}
            aria-expanded={showSidebar}
            aria-controls="app-sidebar"
            title={showSidebar ? 'Hide sidebar' : 'Show sidebar'}
          >
            <Icon name="menu" size={18} />
          </button>
        ) : null}
        <Link to={app.to} className="app-title" aria-label={`${app.label} home`}>
          <AppLogo app={app} />
          <span className="app-title-text truncate">{title ?? app.label}</span>
        </Link>
        <div className="topbar-app">{topbar}</div>
        <GlobalItems />
      </header>
      <NetworkBanner />
      <div className="app-body">
        {sidebar && (
          <>
            {phone && drawer && <div className="scrim sidebar-scrim" onClick={() => setDrawer(false)} />}
            <aside
              id="app-sidebar"
              className={'app-sidebar' + (phone ? ' drawer-mode' : '') + (showSidebar ? ' open' : '')}
              style={sidebarWidth ? ({ '--sb-w': sidebarWidth } as React.CSSProperties) : undefined}
              aria-label={`${app.label} navigation`}
              hidden={!showSidebar}
            >
              {phone && (
                <div className="sidebar-drawer-head">
                  <AppLogo app={app} />
                  <strong className="grow">{app.label}</strong>
                  <button className="btn ghost icon sm" onClick={() => setDrawer(false)} aria-label="Close sidebar"><Icon name="x" /></button>
                </div>
              )}
              <Boundary label="this panel">{sidebar}</Boundary>
            </aside>
          </>
        )}
        <main id="content" className="app-main" tabIndex={-1}>
          <Boundary label="this page" className="page-fail">{children}</Boundary>
        </main>
      </div>
    </div>
  )
}

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
    <div className="global-items">
      <button className="search-trigger" onClick={openPalette} aria-label="Search or jump to" title={`Search or jump to (${mac ? '⌘' : 'Ctrl'} K)`}>
        <Icon name="search" />
        <span className="search-text">Search</span>
        <span className="kbd search-kbd">{mac ? '⌘' : 'Ctrl'} K</span>
      </button>
      <NotificationBell />
      <button className="btn ghost icon theme-btn" onClick={cycleTheme} aria-label={themeLabel + ' (click to change)'} title={themeLabel}>
        <Icon name={themeIcon} size={18} />
      </button>
      <Menu
        align="end"
        label="Apps"
        width="min(19rem, calc(100vw - 16px))"
        trigger={(p) => (
          <button {...p} className="btn ghost icon" aria-label="Apps" title="Apps">
            <Icon name="apps" size={18} />
          </button>
        )}
      >
        {(close) => (
          <div className="launcher">
            {APPS.map((a) => (
              <Link key={a.id} to={a.to} role="menuitem" className="launcher-app" onClick={close}>
                <AppLogo app={a} size={2.5} />
                <span className="truncate">{a.label}</span>
              </Link>
            ))}
            <a href={CLASSIC.to} role="menuitem" className="launcher-classic">
              <Icon name="classic" />
              <span className="grow">Classic view</span>
              <Icon name="external" size={14} />
            </a>
          </div>
        )}
      </Menu>
      <Menu
        align="end"
        label="Account"
        trigger={(p) => (
          <button {...p} className="avatar-btn" aria-label="Account menu">
            <Avatar name={name || '?'} src={me?.profile_picture} size={1.75} />
          </button>
        )}
      >
        {(close) => (
          <>
            <div className="menu-label" style={{ paddingBottom: '0.5rem' }}>
              <div style={{ color: 'var(--app-fg)', fontWeight: 600, fontSize: 'var(--fs-sm)' }}>{name}</div>
              <div className="truncate">{me?.email || me?.username}</div>
            </div>
            <div className="menu-sep" />
            <MenuItem icon="settings" onClick={() => (close(), navigate('/settings'))}>Settings</MenuItem>
            <MenuItem icon={themeIcon} onClick={cycleTheme}>{themeLabel}</MenuItem>
            <MenuItem icon="classic" href="/">Classic view</MenuItem>
            <div className="menu-sep" />
            <MenuItem icon="logout" onClick={logout}>Log out</MenuItem>
          </>
        )}
      </Menu>
    </div>
  )
}

/** Standard sidebar nav item (use inside an AppShell sidebar). */
export function SideItem({ icon, label, active, count, onClick, colour, to }: {
  icon?: string; label: ReactNode; active?: boolean; count?: ReactNode; onClick?: () => void; colour?: string; to?: string
}) {
  const inner = (
    <>
      {colour ? <span className="dot" style={{ background: colour }} /> : icon ? <Icon name={icon} size={16} /> : null}
      <span className="grow truncate">{label}</span>
      {count != null && count !== 0 && <span className="side-count">{count}</span>}
    </>
  )
  if (to) return <Link to={to} className={'side-item' + (active ? ' active' : '')} aria-current={active ? 'page' : undefined} onClick={onClick}>{inner}</Link>
  return <button type="button" className={'side-item' + (active ? ' active' : '')} aria-current={active ? 'page' : undefined} onClick={onClick}>{inner}</button>
}

export function SideSection({ title, action, children }: { title?: ReactNode; action?: ReactNode; children: ReactNode }) {
  return (
    <div className="side-section">
      {title && (
        <div className="side-title">
          <span className="grow">{title}</span>
          {action}
        </div>
      )}
      {children}
    </div>
  )
}
