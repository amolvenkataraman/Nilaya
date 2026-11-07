// Whose data is persisted in this browser. On a shared browser the next person must never see the
// previous person's data: persisted caches belong to one user, and a different user, a new login
// (Django rotates the CSRF cookie on every sign-in) or a sign-out (401) wipes
// them before anything renders from them.

const OWNER = 'app.owner' // localStorage: {"u": user id | undefined, "s": fingerprint of the CSRF cookie}
/** sessionStorage copy of the query cache (components/resilience.tsx). */
export const SESSION_CACHE = 'app.qc.v1'
/** localStorage caches of server data use this prefix (all wiped on a user change). */
export const CACHE_PREFIX = 'app.cache.'
const LEGACY = ['app.calendar.birthdays.v1'] // unowned caches from before this

type Owner = { u?: string; s?: string }
let owner: Owner = {}

function csrfFingerprint(): string {
  const m = typeof document === 'undefined' ? null : /(?:^|;\s*)csrftoken=([^;]*)/.exec(document.cookie)
  let h = 0x811c9dc5 // FNV-1a: enough to notice a change without storing the token
  for (const c of m?.[1] ?? '') h = Math.imul(h ^ c.charCodeAt(0), 0x01000193)
  return (h >>> 0).toString(36)
}

function save() {
  try {
    localStorage.setItem(OWNER, JSON.stringify(owner))
  } catch { /* ignore */ }
}

/** Remove every persisted copy of server data (this tab's query cache and the localStorage caches). */
export function wipePersisted() {
  try {
    sessionStorage.removeItem(SESSION_CACHE)
  } catch { /* ignore */ }
  try {
    const drop: string[] = [...LEGACY]
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k?.startsWith(CACHE_PREFIX)) drop.push(k)
    }
    drop.forEach((k) => localStorage.removeItem(k))
  } catch { /* ignore */ }
}

/** At boot, before the saved cache is restored: data saved under another login is wiped. */
export function checkOwnerAtBoot() {
  try {
    owner = JSON.parse(localStorage.getItem(OWNER) || '{}') as Owner
  } catch {
    owner = {}
  }
  const s = csrfFingerprint()
  if (owner.s !== s) {
    // A new login since (or no record of who saved it): the user may differ, so start clean.
    wipePersisted()
    owner = { s }
    save()
  }
}

/** /me answered: data persisted for someone else goes. True when it wiped (drop in-memory data too). */
export function claimOwner(userId: string): boolean {
  const other = owner.u !== undefined && owner.u !== userId
  if (other) wipePersisted()
  if (other || owner.u !== userId || owner.s !== csrfFingerprint()) {
    owner = { u: userId, s: csrfFingerprint() }
    save()
  }
  return other
}

/** Signed out (a 401 or logging out): wipe, and forget the owner. */
export function signedOut() {
  wipePersisted()
  owner = {}
  try {
    localStorage.removeItem(OWNER)
  } catch { /* ignore */ }
}

/** The user the persisted data belongs to, once known. */
export const ownerId = () => owner.u

/** localStorage key for one user's own saved items (e.g. their presets). An unscoped value saved
 *  before this moves to the first user who reads it. Null while the user isn't known. */
export function userKey(base: string, userId: string | undefined): string | null {
  if (!userId) return null
  const key = `${base}.${userId}`
  try {
    const legacy = localStorage.getItem(base)
    if (legacy !== null) {
      if (localStorage.getItem(key) === null) localStorage.setItem(key, legacy)
      localStorage.removeItem(base)
    }
  } catch { /* ignore */ }
  return key
}
