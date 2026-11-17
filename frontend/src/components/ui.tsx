// Shared UI primitives: hotkeys, skeletons, avatar, switch, error box; overlays re-exported from ./ui/.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { cn } from '../lib/cn'

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

// The app-wide "g then a letter" jump (Shell) shares letters with page shortcuts (g n, g t…), so page shortcuts
// ignore the key that follows a "g". This only notes when a "g" was pressed (capture phase, before any handler).
let gAt = 0
if (typeof window !== 'undefined') {
  window.addEventListener(
    'keydown',
    (e) => {
      if (e.key === 'g' && !e.metaKey && !e.ctrlKey && !e.altKey && !isTyping(e)) gAt = Date.now()
    },
    true,
  )
}
/** True for the key right after a "g" (within Shell's 900 ms window). */
export const afterG = (e: KeyboardEvent) => e.key !== 'g' && Date.now() - gAt < 900

// Overlays live in ./ui/ on Base UI; re-exported here so pages keep one import.
export { Button, buttonClass } from './ui/button'
export { Confirm, Dialog, Drawer, DrawerBody, DrawerHead } from './ui/dialog'
export { Card, CardBody, CardCount, CardHead, CardLink, cardClass, TitledCard } from './ui/card'
export { Chip, type ChipSize, type ChipTone, chipClass, Dot, Kbd } from './ui/chip'
export { ColourPicker, SearchBox, Segmented, type SegmentOption } from './ui/controls'
export { EmptyState, ErrorBox, SkeletonRows } from './ui/feedback'
export { Field, FieldRow, fieldClass, Input, Select, Textarea } from './ui/form'
export { Menu, MenuItem, MenuLabel, MenuSeparator, Popover, type TriggerProps } from './ui/menu'
export { PageHead, pageClass } from './ui/page'
export { QueryView } from './ui/query-view'

// ---------------------------------------------------------------- misc

// `avatar` stays as a hook (the account button rings it on hover).
const AVATAR = 'avatar flex-none rounded-full object-cover'

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
      className={AVATAR}
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
    <span
      className={cn(AVATAR, 'inline-grid place-items-center bg-accent-soft font-semibold text-accent')}
      style={style}
      aria-hidden="true"
    >
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
    <label className="relative inline-flex cursor-pointer items-center gap-2 text-sm has-disabled:cursor-default has-disabled:opacity-60">
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="peer absolute size-px opacity-0"
      />
      <span
        aria-hidden="true"
        className={cn(
          'relative h-4.5 w-7.5 flex-none rounded-full bg-[color-mix(in_srgb,var(--app-muted)_40%,var(--app-border))] transition-colors peer-checked:bg-accent',
          'peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent',
          "after:absolute after:top-0.5 after:left-0.5 after:size-3.5 after:rounded-full after:bg-white after:shadow-[0_1px_2px_rgba(0,0,0,0.25)] after:transition-transform after:duration-150 after:content-['']",
          'peer-checked:after:translate-x-3',
        )}
      />
      {label && <span>{label}</span>}
    </label>
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

/** The phone layout's breakpoint (Tailwind's `md` starts just above it). */
export const PHONE_QUERY = '(max-width: 760px)'
export const useIsPhone = () => useMediaQuery(PHONE_QUERY)
