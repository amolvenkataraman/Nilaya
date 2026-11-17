// After a deploy, an open tab can ask for a code chunk that no longer exists (hashed names change). Reload once
// to pick up the new build. A timestamp instead of a flag: a second deploy later in the same tab reloads too,
// while a chunk that's broken right after reloading shows the error instead of looping.
const KEY = 'app.reloaded'
const LOOP_MS = 30_000

/** Reload for a new build unless this tab just did; true when a reload has started. */
export function reloadForNewBuild(): boolean {
  try {
    const last = Number(sessionStorage.getItem(KEY) || 0)
    if (Date.now() - last < LOOP_MS) return false
    sessionStorage.setItem(KEY, String(Date.now()))
  } catch {
    return false // storage blocked: show the error rather than risk a loop
  }
  window.location.reload()
  return true
}

export const isStaleChunkError = (e: unknown) =>
  /dynamically imported module|Importing a module script failed|Failed to fetch|error loading dynamically/i.test(
    (e as Error)?.message ?? '',
  )

/** Vite fires this when a lazy import (a route or a lazily loaded part of a page) fails to load. */
export function reloadOnStaleChunks() {
  window.addEventListener('vite:preloadError', (event) => {
    if (reloadForNewBuild()) event.preventDefault()
  })
}
