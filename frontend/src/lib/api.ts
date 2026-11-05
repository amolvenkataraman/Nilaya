// Tiny typed client for the V2 JSON API (/api/v2/). Session-cookie auth; unsafe methods send
// the CSRF token from the `csrftoken` cookie. A 401 sends the browser to the login page.

export const API_BASE = '/api/v2'

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

type Query = Record<string, string | number | boolean | null | undefined | readonly (string | number)[]>

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  query?: Query
  body?: unknown
  signal?: AbortSignal
}

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS'])

export function readCookie(name: string, cookie: string = typeof document === 'undefined' ? '' : document.cookie): string {
  for (const part of cookie.split(';')) {
    const i = part.indexOf('=')
    if (i < 0) continue
    if (part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim())
  }
  return ''
}

/** Build "/api/v2/<path>?a=1" skipping empty values. `path` must not start with a scheme. */
export function apiUrl(path: string, query?: Query): string {
  if (/^[a-z][a-z0-9+.-]*:|^\/\//i.test(path)) throw new Error('apiUrl expects a relative API path')
  const url = API_BASE + (path.startsWith('/') ? path : '/' + path)
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v === undefined || v === null || v === '') continue
    if (Array.isArray(v)) v.forEach((x) => params.append(k, String(x))) // ?k=a&k=b
    else params.set(k, String(v))
  }
  const qs = params.toString()
  return qs ? `${url}?${qs}` : url
}

export function loginUrl(loc: { pathname: string; search: string } = window.location): string {
  return '/accounts/login/?next=' + encodeURIComponent(loc.pathname + loc.search)
}

/** Ninja errors look like {"detail": "..."} or {"detail": [{"msg": ...}]} (validation). */
export function errorMessage(status: number, data: unknown): string {
  const d = (data as { detail?: unknown } | null)?.detail
  if (typeof d === 'string' && d) return d
  if (Array.isArray(d) && d.length) {
    return d
      .map((e: { msg?: string; loc?: unknown[] }) => {
        const field = Array.isArray(e.loc) ? String(e.loc[e.loc.length - 1] ?? '') : ''
        return field && field !== 'body' ? `${field}: ${e.msg ?? 'invalid'}` : e.msg ?? 'Invalid input'
      })
      .join('; ')
  }
  if (status === 403) return "You don't have permission to do that."
  if (status === 404) return 'Not found.'
  if (status >= 500) return 'The server had a problem. Try again in a moment.'
  return `Request failed (${status}).`
}

let redirecting = false

export async function api<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const method = opts.method ?? 'GET'
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (!SAFE.has(method)) headers['X-CSRFToken'] = readCookie('csrftoken')
  let body: string | undefined
  if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify(opts.body)
  }
  let res: Response
  try {
    res = await fetch(apiUrl(path, opts.query), {
      method,
      headers,
      body,
      credentials: 'same-origin',
      signal: opts.signal,
    })
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e
    throw new ApiError(0, "Couldn't reach the server. Check your connection.")
  }
  if (res.status === 401) {
    try {
      sessionStorage.removeItem('app.qc.v1') // never keep a signed-out user's data around
    } catch { /* ignore */ }
    if (!redirecting) {
      redirecting = true
      window.location.assign(loginUrl())
    }
    throw new ApiError(401, 'Signed out')
  }
  if (res.status === 204) return undefined as T
  const text = await res.text()
  let data: unknown = null
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = null
    }
  }
  if (!res.ok) throw new ApiError(res.status, errorMessage(res.status, data))
  return data as T
}

export const get = <T>(path: string, query?: Query, signal?: AbortSignal) => api<T>(path, { query, signal })
export const post = <T>(path: string, body?: unknown, query?: Query) => api<T>(path, { method: 'POST', body, query })
export const patch = <T>(path: string, body: unknown) => api<T>(path, { method: 'PATCH', body })
export const del = (path: string) => api<void>(path, { method: 'DELETE' })

/** Only same-site paths ("/x", not "//x") and http(s) URLs may become links. Everything else is text. */
export function safeHref(url: string | null | undefined): string | null {
  if (!url) return null
  const u = url.trim()
  if (/^\/(?![/\\])/.test(u)) return u
  if (/^https?:\/\/[^\s]+$/i.test(u)) return u
  return null
}

/** Map an old-UI path to the matching new-UI route when one exists (e.g. /tasks/?task=x). */
export function appRoute(url: string): string | null {
  const href = safeHref(url)
  if (!href || !href.startsWith('/')) return null
  const [path, search = ''] = href.split('?')
  const map: Record<string, string> = { '/': '/', '/tasks/': '/tasks', '/calendar/': '/calendar', '/photos/': '/photos', '/map/': '/places', '/notifications/': '/notifications', '/photos/geoguessr/': '/photos/geoguessr', '/photos/geoguessr_ent/': '/photos/locate' }
  if (path.startsWith('/app/')) return path.slice(4) + (search ? '?' + search : '')
  if (path in map) return map[path] + (search ? '?' + search : '')
  return null
}
