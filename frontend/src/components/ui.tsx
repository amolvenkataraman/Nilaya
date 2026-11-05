// Shared UI primitives: popover menu, dialog, drawer, skeletons, avatar, switch, hotkeys.
import {
  useCallback, useEffect, useLayoutEffect, useRef, useState,
  type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
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

// ---------------------------------------------------------------- focus helpers
const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'

function trapTab(e: ReactKeyboardEvent, root: HTMLElement | null) {
  if (e.key !== 'Tab' || !root) return
  const els = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null)
  if (!els.length) return
  const first = els[0]
  const last = els[els.length - 1]
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault()
    last.focus()
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault()
    first.focus()
  }
}

function useRestoreFocus(open: boolean) {
  useEffect(() => {
    if (!open) return
    const prev = document.activeElement as HTMLElement | null
    return () => prev?.focus?.({ preventScroll: true })
  }, [open])
}

// ---------------------------------------------------------------- popover menu
interface MenuProps {
  trigger: (p: { ref: (el: HTMLElement | null) => void; onClick: () => void; 'aria-expanded': boolean; 'aria-haspopup': 'menu' }) => ReactNode
  children: (close: () => void) => ReactNode
  align?: 'start' | 'end'
  width?: string
  label?: string
}

export function Menu({ trigger, children, align = 'start', width, label }: MenuProps) {
  const [open, setOpen] = useState(false)
  const anchor = useRef<HTMLElement | null>(null)
  const pop = useRef<HTMLDivElement | null>(null)
  const [style, setStyle] = useState<CSSProperties>({ visibility: 'hidden' })
  const close = useCallback(() => setOpen(false), [])

  useLayoutEffect(() => {
    if (!open || !anchor.current || !pop.current) return
    const r = anchor.current.getBoundingClientRect()
    const p = pop.current.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    let left = align === 'end' ? r.right - p.width : r.left
    left = Math.max(8, Math.min(left, vw - p.width - 8))
    let top = r.bottom + 4
    if (top + p.height > vh - 8 && r.top - p.height - 4 > 8) top = r.top - p.height - 4
    setStyle({ left, top, width })
    const first = pop.current.querySelector<HTMLElement>('[role="menuitem"],input,button')
    first?.focus({ preventScroll: true })
  }, [open, align, width])

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node
      if (pop.current?.contains(t) || anchor.current?.contains(t)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        setOpen(false)
        anchor.current?.focus()
      }
    }
    const onResize = () => setOpen(false)
    document.addEventListener('pointerdown', onDown, true)
    document.addEventListener('keydown', onKey, true)
    window.addEventListener('resize', onResize)
    return () => {
      document.removeEventListener('pointerdown', onDown, true)
      document.removeEventListener('keydown', onKey, true)
      window.removeEventListener('resize', onResize)
    }
  }, [open])

  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    const items = Array.from(pop.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])
    if (!items.length) return
    e.preventDefault()
    const i = items.indexOf(document.activeElement as HTMLElement)
    const next = e.key === 'ArrowDown' ? (i + 1) % items.length : (i - 1 + items.length) % items.length
    items[next].focus()
  }

  return (
    <>
      {trigger({
        ref: (el) => (anchor.current = el),
        onClick: () => {
          setStyle({ visibility: 'hidden' })
          setOpen((o) => !o)
        },
        'aria-expanded': open,
        'aria-haspopup': 'menu',
      })}
      {open &&
        createPortal(
          <div ref={pop} className="menu" role="menu" aria-label={label} style={{ ...style, width }} onKeyDown={onKeyDown}>
            {children(close)}
          </div>,
          document.body,
        )}
    </>
  )
}

export function MenuItem({ icon, children, onClick, danger, end, href, active }: {
  icon?: string; children: ReactNode; onClick?: () => void; danger?: boolean; end?: ReactNode; href?: string; active?: boolean
}) {
  const cls = 'menu-item' + (danger ? ' danger' : '') + (active ? ' active' : '')
  const inner = (
    <>
      {icon && <Icon name={icon} />}
      <span className="truncate">{children}</span>
      {end != null && <span className="end">{end}</span>}
    </>
  )
  if (href) return <a role="menuitem" className={cls} href={href} onClick={onClick}>{inner}</a>
  return <button type="button" role="menuitem" className={cls} onClick={onClick}>{inner}</button>
}

// ---------------------------------------------------------------- dialog
export function Dialog({ open, onClose, title, children, footer, width, labelledBy }: {
  open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; width?: string; labelledBy?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const id = labelledBy ?? 'dlg-title'
  useRestoreFocus(open)
  useEffect(() => {
    if (!open) return
    // Keep focus a child already took (React autoFocus); otherwise the first field in the body.
    if (!ref.current?.contains(document.activeElement)) {
      const body = ref.current?.querySelector('.dialog-body')
      const el = body?.querySelector<HTMLElement>('input:not([type=checkbox]):not([type=radio]),textarea,select') ?? body?.querySelector<HTMLElement>('button') ?? ref.current?.querySelector<HTMLElement>('button')
      el?.focus()
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && (e.stopPropagation(), onClose())
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])
  if (!open) return null
  return createPortal(
    <>
      <div className="scrim" onClick={onClose} />
      <div ref={ref} className="dialog" role="dialog" aria-modal="true" aria-labelledby={id} style={width ? { width: `min(${width}, calc(100vw - 2rem))` } : undefined} onKeyDown={(e) => trapTab(e, ref.current)}>
        <div className="dialog-head">
          <h2 id={id} className="grow">{title}</h2>
          <button type="button" className="btn ghost icon sm" onClick={onClose} aria-label="Close">
            <Icon name="x" />
          </button>
        </div>
        <div className="dialog-body">{children}</div>
        {footer && <div className="dialog-foot">{footer}</div>}
      </div>
    </>,
    document.body,
  )
}

/** Simple confirm dialog driven by a promise-less callback. */
export function Confirm({ open, title, body, confirmLabel = 'Delete', onConfirm, onClose }: {
  open: boolean; title: string; body?: ReactNode; confirmLabel?: string; onConfirm: () => void; onClose: () => void
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      width="26rem"
      footer={
        <>
          <span className="spacer" />
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" style={{ background: 'var(--app-danger)', borderColor: 'var(--app-danger)', color: '#fff' }} onClick={() => { onConfirm(); onClose() }}>
            {confirmLabel}
          </button>
        </>
      }
    >
      {body && <p className="muted small">{body}</p>}
    </Dialog>
  )
}

// ---------------------------------------------------------------- drawer
export function Drawer({ open, onClose, children, label }: { open: boolean; onClose: () => void; children: ReactNode; label: string }) {
  const ref = useRef<HTMLDivElement>(null)
  useRestoreFocus(open)
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.querySelector('.menu,.dialog')) onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])
  if (!open) return null
  return createPortal(
    <>
      <div className="scrim drawer-scrim" onClick={onClose} />
      <aside ref={ref} className="drawer" role="dialog" aria-modal="true" aria-label={label} tabIndex={-1} onKeyDown={(e) => trapTab(e, ref.current)}>
        {children}
      </aside>
    </>,
    document.body,
  )
}

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
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || '?'
  const style = { width: `${size}rem`, height: `${size}rem`, fontSize: `${size * 0.4}rem` }
  // Only same-site image paths: the profile picture is served by the app itself.
  const safe = src && /^\/(?![/\\])/.test(src) && !broken ? src : null
  return safe ? (
    <img className="avatar" src={safe} alt="" style={style} width={Math.round(size * 16)} height={Math.round(size * 16)} loading="lazy" decoding="async" onError={() => setBroken(true)} />
  ) : (
    <span className="avatar" style={style} aria-hidden="true">{initials}</span>
  )
}

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; disabled?: boolean }) {
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
      {retry && <button className="btn sm" onClick={retry}>Retry</button>}
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
