// Tiny external stores (useSyncExternalStore) for state that thousands of tiles read: a tile subscribes to the
// one value it shows (`useSelect(s => s.picked.has(id))`), so selecting a photo re-renders that tile only.
// `createSelection` is the select-mode model on top (Shift ranges, select-all-of-a-day). Built here for Photos;
// meant to move to lib/store.ts for other apps' selections.
import { useSyncExternalStore } from 'react'

export interface Store<T> {
  get: () => T
  set: (next: T) => void
  use: () => T
  /** Re-render only when `pick(value)` changes (it must return a primitive or a stable reference). */
  useSelect: <U>(pick: (v: T) => U) => U
}

export function createStore<T>(initial: T): Store<T> {
  let v = initial
  const subs = new Set<() => void>()
  const subscribe = (cb: () => void) => {
    subs.add(cb)
    return () => void subs.delete(cb)
  }
  return {
    get: () => v,
    set: (next) => {
      v = next
      for (const s of subs) s()
    },
    use: () => useSyncExternalStore(subscribe, () => v),
    useSelect: (pick) => useSyncExternalStore(subscribe, () => pick(v)),
  }
}

export interface SelectionState<V> {
  /** Select mode: clicks select instead of opening. */
  mode: boolean
  picked: Map<string, V>
  /** The last clicked item, where a Shift range starts. */
  anchor: string | null
}

export function createSelection<V>(idOf: (v: V) => string) {
  const store = createStore<SelectionState<V>>({ mode: false, picked: new Map(), anchor: null })
  const patch = (p: Partial<SelectionState<V>>) => store.set({ ...store.get(), ...p })
  return {
    ...store,
    setMode(mode: boolean) {
      patch(mode ? { mode } : { mode: false, picked: new Map(), anchor: null })
    },
    clear() {
      patch({ picked: new Map(), anchor: null })
    },
    /** Toggle one item; with `range`, select everything between the anchor and this one along `order`. */
    toggle(item: V, order: readonly V[], range = false) {
      const s = store.get()
      const id = idOf(item)
      const picked = new Map(s.picked)
      if (range && s.anchor) {
        const a = order.findIndex((x) => idOf(x) === s.anchor)
        const b = order.findIndex((x) => idOf(x) === id)
        if (a >= 0 && b >= 0) {
          for (const x of order.slice(Math.min(a, b), Math.max(a, b) + 1)) picked.set(idOf(x), x)
          return patch({ mode: true, picked, anchor: id })
        }
      }
      if (picked.has(id)) picked.delete(id)
      else picked.set(id, item)
      patch({ mode: true, picked, anchor: id })
    },
    setMany(items: readonly V[], on: boolean) {
      const picked = new Map(store.get().picked)
      for (const x of items) {
        if (on) picked.set(idOf(x), x)
        else picked.delete(idOf(x))
      }
      patch({ mode: true, picked })
    },
  }
}
