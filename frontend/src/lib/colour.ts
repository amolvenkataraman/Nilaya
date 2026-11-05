// Contrast-aware colours for user-chosen #rrggbb values (calendar colours can be anything).

export function parseHex(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  const h = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1]
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}

const toHex = (rgb: number[]) => '#' + rgb.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')

function luminance([r, g, b]: [number, number, number]): number {
  const f = (v: number) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}

/** WCAG contrast ratio between two colours (1..21). */
export function contrast(a: string, b: string): number {
  const x = parseHex(a)
  const y = parseHex(b)
  if (!x || !y) return 1
  const [l1, l2] = [luminance(x), luminance(y)].sort((p, q) => q - p)
  return (l1 + 0.05) / (l2 + 0.05)
}

/**
 * The colour to draw marks, borders and dots with on `surface`: the user's colour when it already
 * stands out (>= `min`, 3:1 by default, the non-text UI threshold), otherwise mixed toward black
 * (light surfaces) or white (dark surfaces) just enough to. Invalid input falls back to slate.
 */
export function readable(hex: string, surface: string, min = 3): string {
  const rgb = parseHex(hex)
  if (!rgb) return '#64748b'
  if (contrast(toHex(rgb), surface) >= min) return toHex(rgb)
  const s = parseHex(surface) ?? [255, 255, 255]
  const target = luminance(s) > 0.4 ? 0 : 255
  for (let t = 0.1; t <= 1.0001; t += 0.1) {
    const mixed = rgb.map((v) => v + (target - v) * t)
    if (contrast(toHex(mixed), surface) >= min) return toHex(mixed)
  }
  return target ? '#ffffff' : '#000000'
}

/** Text colour (near-black or white) for a filled background of `hex`. */
export function inkOn(hex: string): string {
  return contrast(hex, '#ffffff') >= contrast(hex, '#111827') ? '#ffffff' : '#111827'
}

export const SURFACE = { light: '#ffffff', dark: '#171e26' } // --app-surface in theme.css
