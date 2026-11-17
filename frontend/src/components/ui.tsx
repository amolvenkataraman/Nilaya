// Shared UI primitives: hotkeys, skeletons, avatar, switch, error box; overlays re-exported from ./ui/.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Icon } from './Icon'

// ---------------------------------------------------------------- hotkeys
export function isTyping(e: KeyboardEvent): boolean {
  const el = e.target as HTMLElement | null
  if (!el) return false
  return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)
}

/** Global keydown handler; ignored while typing in a field unless `allowInInputs`. */
export function useHotkey(match: (e: KeyboardEvent) => boolean, fn: (e: KeyboardEvent) => void, allowInInputs = false) {
  const ref = useRef(fn)
  ref.current = fn
  const matchRef = useRef(match)
  matchRef.current = match
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (!allowInInputs && isTyping(e)) return
      if (matchRef.current(e)) ref.current(e)
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [allowInInputs])
}

// Overlays live in ./ui/ on Base UI; re-exported here so pages keep one import.
export { Button, buttonClass } from './ui/button'
export { Confirm, Dialog, Drawer, DrawerBody, DrawerHead } from './ui/dialog'
export { Menu, MenuItem, MenuLabel, MenuSeparator, Popover, type TriggerProps } from './ui/menu'

// ---------------------------------------------------------------- misc
export function SkeletonRows({ rows = 4, avatar = false }: { rows?: number; avatar?: boolean }) {
  return (
    <div className="sk-rows" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="row" style={{ padding: '0.5rem 1rem' }}>
          {avatar && <span className="sk" style={{ width: '1rem', height: '1rem', borderRadius: '50%' }} />}
          <span className="sk sk-line" style={{ width: `${55 + ((i * 17) % 35)}%` }} />
        </div>
      ))}
    </div>
  )
}

export function Avatar({ name, src, size = 1.75 }: { name: string; src?: string | null; size?: number }) {
  const [broken, setBroken] = useState(false)
  const initials =
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join('') || '?'
  const style = { width: `${size}rem`, height: `${size}rem`, fontSize: `${size * 0.4}rem` }
  // Only same-site image paths: the profile picture is served by the app itself.
  const safe = src && /^\/(?![/\\])/.test(src) && !broken ? src : null
  return safe ? (
    <img
      className="avatar"
      src={safe}
      alt=""
      style={style}
      width={Math.round(size * 16)}
      height={Math.round(size * 16)}
      loading="lazy"
      decoding="async"
      onError={() => setBroken(true)}
    />
  ) : (
    <span className="avatar" style={style} aria-hidden="true">
      {initials}
    </span>
  )
}

export function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label?: ReactNode
  disabled?: boolean
}) {
  return (
    <label className="switch">
      <input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="track" />
      {label && <span>{label}</span>}
    </label>
  )
}

export function ErrorBox({ error, retry }: { error: unknown; retry?: () => void }) {
  return (
    <div className="error-box" role="alert">
      <Icon name="alert" />
      <span className="grow">{(error as Error)?.message || 'Something went wrong.'}</span>
      {retry && (
        <button className="btn sm" onClick={retry}>
          Retry
        </button>
      )}
    </div>
  )
}

/** Debounced value for search inputs. */
export function useDebounced<T>(value: T, ms = 200): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

/** Current time, re-rendering every `ms` (for now-lines and "in 5 min"). */
export function useNow(ms = 30_000): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), ms)
    return () => clearInterval(t)
  }, [ms])
  return now
}

export function useMediaQuery(q: string): boolean {
  const [m, setM] = useState(() => window.matchMedia(q).matches)
  useEffect(() => {
    const mq = window.matchMedia(q)
    const h = () => setM(mq.matches)
    mq.addEventListener('change', h)
    h()
    return () => mq.removeEventListener('change', h)
  }, [q])
  return m
}
