// The browser tab icon follows the current app: its launcher tile (the app's colour, rounded) with the
// navbar glyph in white, as an SVG data: URL (the SPA's CSP allows img-src data:). Solid colour reads in
// light and dark browser chrome alike. Each app's SVG is built once and cached; outside an app the
// Nilaya icon from index.html comes back.
import { Children, Fragment, isValidElement, useEffect, type ReactElement, type ReactNode } from 'react'
import { iconShapes } from '../components/Icon'

const esc = (v: unknown) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')
const attr = (k: string) => k.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())

/** Static markup of the icon set's plain SVG elements (path, rect, circle; fragments flattened). */
function markup(node: ReactNode): string {
  return Children.toArray(node).map((n) => {
    if (!isValidElement(n)) return ''
    const { children, ...props } = (n as ReactElement<Record<string, unknown>>).props
    if (n.type === Fragment) return markup(children as ReactNode)
    if (typeof n.type !== 'string') return ''
    const attrs = Object.entries(props).filter(([, v]) => v != null && v !== false).map(([k, v]) => ` ${attr(k)}="${esc(v)}"`).join('')
    return `<${n.type}${attrs}>${markup(children as ReactNode)}</${n.type}>`
  }).join('')
}

/** An icon's inner SVG markup (constant path data only), e.g. for Leaflet divIcon pins. */
export const iconMarkup = (name: string): string => markup(iconShapes(name))

/** 32-unit tile, ~28% corner radius like .app-logo; the 24-unit glyph scaled to 22 with a heavier stroke so
 *  it stays legible at 16 px. currentColor (the "apps" dots) resolves to white through `color`. */
export function faviconSvg(icon: string, hue: string): string {
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">'
    + `<rect width="32" height="32" rx="8.5" fill="${esc(hue)}"/>`
    + '<g transform="translate(5 5) scale(.9167)" color="#fff" fill="none" stroke="#fff" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round">'
    + markup(iconShapes(icon))
    + '</g></svg>'
}

const cache = new Map<string, string>()
export function faviconUrl(icon: string, hue: string): string {
  const key = icon + hue
  let url = cache.get(key)
  if (!url) cache.set(key, (url = 'data:image/svg+xml,' + encodeURIComponent(faviconSvg(icon, hue))))
  return url
}

let fallback: { href: string; type: string } | null = null

/** Point the tab icon at an app's tile, or (null) back at the default Nilaya icon. */
export function setFavicon(app: { icon: string; hue: string } | null) {
  const link = document.querySelector<HTMLLinkElement>('link[rel~="icon"]')
  if (!link) return
  fallback ??= { href: link.getAttribute('href') ?? '', type: link.getAttribute('type') ?? '' }
  const href = app ? faviconUrl(app.icon, app.hue) : fallback.href
  const type = app ? 'image/svg+xml' : fallback.type
  if (link.getAttribute('href') === href) return
  if (type) link.setAttribute('type', type)
  else link.removeAttribute('type')
  link.setAttribute('href', href)
}

let generation = 0

/** While mounted, the tab shows this app's icon. Unmounting restores the default a microtask later, so
 *  moving from one app to the next (unmount and mount in one commit) never flashes the default icon. */
export function useAppFavicon(app: { icon: string; hue: string }) {
  const { icon, hue } = app
  useEffect(() => {
    const mine = ++generation
    setFavicon({ icon, hue })
    return () => queueMicrotask(() => { if (generation === mine) setFavicon(null) })
  }, [icon, hue])
}
