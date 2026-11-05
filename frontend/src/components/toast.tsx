import { useSyncExternalStore } from 'react'

interface ToastItem { id: number; text: string; error?: boolean; action?: { label: string; run: () => void } }
let items: ToastItem[] = []
let seq = 0
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

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
}

export function Toaster() {
  const list = useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => items,
  )
  return (
    <div className="toasts" role="status" aria-live="polite">
      {list.map((t) => (
        <div key={t.id} className={'toast' + (t.error ? ' error' : '')}>
          <span>{t.text}</span>
          {t.action && (
            <button
              onClick={() => {
                t.action!.run()
                dismiss(t.id)
              }}
            >
              {t.action.label}
            </button>
          )}
          <button aria-label="Dismiss" onClick={() => dismiss(t.id)}>
            ✕
          </button>
        </div>
      ))}
    </div>
  )
}
