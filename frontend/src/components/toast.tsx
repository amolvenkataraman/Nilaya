import { useSyncExternalStore } from 'react'
import { copyText } from '../lib/clipboard'
import { cn } from '../lib/cn'

interface ToastItem {
  id: number
  text: string
  error?: boolean
  action?: { label: string; run: () => void }
}
let items: ToastItem[] = []
let seq = 0
const listeners = new Set<() => void>()
const emit = () => {
  for (const l of listeners) l()
}

function dismiss(id: number) {
  items = items.filter((t) => t.id !== id)
  emit()
}

function push(t: Omit<ToastItem, 'id'>, ms: number) {
  const id = ++seq
  items = [...items.slice(-2), { ...t, id }]
  emit()
  setTimeout(() => dismiss(id), ms)
}

export const toast = {
  show: (text: string, opts: { action?: ToastItem['action'] } = {}) => push({ text, action: opts.action }, opts.action ? 6000 : 3500),
  error: (text: string) => push({ text, error: true }, 6000),
  /** Copy text and say so; where the clipboard is blocked, show the text so it can be copied by hand. */
  copy: (text: string, done = 'Copied') => copyText(text).then((ok) => (ok ? toast.show(done) : push({ text }, 10_000))),
  /** A caught error as a toast (its message, else `fallback`). Failed mutations don't need this: see main.tsx. */
  fail: (e: unknown, fallback = 'Something went wrong.') => push({ text: (e as Error)?.message || fallback, error: true }, 6000),
}

export function Toaster() {
  const list = useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => items,
  )
  return (
    // `toasts` is a hook: the Tasks bulk bar lifts the stack above itself.
    <div className="toasts pointer-events-none fixed bottom-5 left-1/2 z-90 grid -translate-x-1/2 justify-items-center gap-2 max-md:bottom-[calc(1rem+env(safe-area-inset-bottom,0px))]">
      {list.map((t) => (
        // Errors interrupt the screen reader (alert); everything else waits its turn (status).
        <div
          key={t.id}
          className={cn(
            'pointer-events-auto flex min-h-10 max-w-[calc(100vw-2rem)] animate-[toast-in_0.18s_var(--ease)] items-center gap-3 rounded-md py-2 pr-2 pl-3.5 text-sm shadow-[0_8px_24px_rgba(0,0,0,0.2)]',
            '[&_button]:rounded-xs [&_button]:border-0 [&_button]:bg-transparent [&_button]:px-2 [&_button]:py-1 [&_button]:font-semibold [&_button]:text-inherit [&_button]:opacity-90',
            'hover:[&_button]:opacity-100 [&_button:hover]:bg-white/14',
            t.error ? 'bg-danger text-danger-fg' : 'bg-fg text-bg',
          )}
          role={t.error ? 'alert' : 'status'}
        >
          <span>{t.text}</span>
          {t.action && (
            <button
              type="button"
              onClick={() => {
                t.action!.run()
                dismiss(t.id)
              }}
            >
              {t.action.label}
            </button>
          )}
          <button type="button" aria-label="Dismiss" onClick={() => dismiss(t.id)}>
            ✕
          </button>
        </div>
      ))}
    </div>
  )
}
