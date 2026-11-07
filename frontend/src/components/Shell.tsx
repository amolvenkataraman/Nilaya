// Root of the app: global providers (command palette, quick add, hotkeys). Each app route renders
// its own chrome with <AppShell> (components/AppShell.tsx), G Suite style.
import { Suspense, createContext, useContext, useEffect, useMemo, useState } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router'
import { useHotkey } from './ui'
import { CommandPalette } from './CommandPalette'
import { QuickAddDialog } from './QuickAdd'
import { post } from '../lib/api'
import { NAV } from './nav'
import { signedOut } from '../lib/owner'
import { toast } from './toast'

/** Sign out, then go to the sign-in page. If it fails (offline, server down, CSRF) stay here and say so:
 *  showing the sign-in page while the session is still signed in would mislead on a shared computer. */
export async function logout() {
  try {
    await post('auth/logout')
  } catch {
    return void toast.error("Couldn't log out. Check your connection and try again; you're still signed in.")
  }
  signedOut()
  window.location.assign('/login')
}

export function usePageTitle(title: string) {
  useEffect(() => {
    document.title = title ? `${title} · AVNet Superapp` : 'AVNet Superapp'
  }, [title])
}

interface Globals { openPalette: () => void; openQuickAdd: () => void }
const GlobalsContext = createContext<Globals>({ openPalette: () => {}, openQuickAdd: () => {} })
export const useGlobals = () => useContext(GlobalsContext)

export function Shell() {
  const [palette, setPalette] = useState(false)
  const [quickAdd, setQuickAdd] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()

  // Ctrl/Cmd-K anywhere; "/" when not typing; "g" then a letter jumps (Linear-style); "q" quick-adds a task.
  useHotkey((e) => (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k', (e) => (e.preventDefault(), setPalette((p) => !p)), true)
  useHotkey((e) => e.key === '/' && !e.metaKey && !e.ctrlKey, (e) => (e.preventDefault(), setPalette(true)))
  useHotkey((e) => e.key === 'q' && !e.metaKey && !e.ctrlKey && !e.altKey, (e) => (e.preventDefault(), setQuickAdd(true)))
  const [gPending, setG] = useState(false)
  useHotkey(
    (e) => !e.metaKey && !e.ctrlKey && !e.altKey && (e.key === 'g' || gPending),
    (e) => {
      if (e.key === 'g' && !gPending) {
        setG(true)
        setTimeout(() => setG(false), 900)
        return
      }
      setG(false)
      const hit = NAV.find((n) => n.key === e.key)
      if (hit) {
        e.preventDefault()
        navigate(hit.to)
      }
    },
  )

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [location.pathname])

  const globals = useMemo<Globals>(() => ({ openPalette: () => setPalette(true), openQuickAdd: () => setQuickAdd(true) }), [])
  return (
    <GlobalsContext.Provider value={globals}>
      <Suspense fallback={<div className="app-loading" aria-busy="true" />}>
        <Outlet />
      </Suspense>
      {/* Mounted only while open, so their queries (projects, task search) cost nothing on other pages. */}
      {palette && <CommandPalette open onClose={() => setPalette(false)} onQuickAdd={() => (setPalette(false), setQuickAdd(true))} />}
      {quickAdd && <QuickAddDialog open onClose={() => setQuickAdd(false)} />}
    </GlobalsContext.Provider>
  )
}
