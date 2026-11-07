// Per-device theme, identical to public/theme.js (served next to the bundles and run
// before first paint): localStorage "theme" = "light" | "dark", absent = "system".
import { useSyncExternalStore } from 'react'

export type ThemePref = 'system' | 'light' | 'dark'
const KEY = 'theme'
const media = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null
const listeners = new Set<() => void>()

export function storedTheme(): ThemePref {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'light' || v === 'dark' ? v : 'system'
  } catch {
    return 'system'
  }
}

function apply(pref: ThemePref) {
  const dark = pref === 'dark' || (pref === 'system' && !!media?.matches)
  const root = document.documentElement
  root.setAttribute('data-bs-theme', dark ? 'dark' : 'light')
  root.setAttribute('data-theme-pref', pref)
  listeners.forEach((l) => l())
}

export function setTheme(pref: ThemePref) {
  try {
    if (pref === 'system') localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, pref)
  } catch {
    /* storage blocked: still apply for this page */
  }
  apply(pref)
}

export function cycleTheme() {
  setTheme(({ system: 'light', light: 'dark', dark: 'system' } as const)[storedTheme()])
}

export function initTheme() {
  apply(storedTheme())
  media?.addEventListener?.('change', () => storedTheme() === 'system' && apply('system'))
  // Another tab changed the theme
  window.addEventListener('storage', (e) => e.key === KEY && apply(storedTheme()))
}

const subscribe = (l: () => void) => (listeners.add(l), () => listeners.delete(l))
export function useTheme(): { pref: ThemePref; dark: boolean } {
  const pref = useSyncExternalStore(subscribe, storedTheme)
  const dark = useSyncExternalStore(subscribe, () => document.documentElement.getAttribute('data-bs-theme') === 'dark')
  return { pref, dark }
}
