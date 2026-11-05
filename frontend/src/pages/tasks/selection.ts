// Multi-select for the list and table layouts: Ctrl/Cmd-click toggles, Shift-click selects a range
// (in the order the rows are shown), Esc clears. Ids only; the page resolves them against its tasks.
import { useCallback, useMemo, useRef, useState } from 'react'

export interface Selection {
  ids: Set<string>
  has: (id: string) => boolean
  toggle: (id: string) => void
  /** Select from the last toggled row to `id` along `order`. */
  range: (order: string[], id: string) => void
  set: (ids: string[]) => void
  clear: () => void
  /** Handle a modifier click; true when it was a selection click (the caller must not open the task). */
  click: (e: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }, id: string, order: string[]) => boolean
}

export function useSelection(): Selection {
  const [ids, setIds] = useState<Set<string>>(() => new Set())
  const anchor = useRef<string | null>(null)
  const toggle = useCallback((id: string) => {
    anchor.current = id
    setIds((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  }, [])
  const range = useCallback((order: string[], id: string) => {
    const a = order.indexOf(anchor.current ?? id)
    const b = order.indexOf(id)
    if (a < 0 || b < 0) return toggle(id)
    setIds((s) => new Set([...s, ...order.slice(Math.min(a, b), Math.max(a, b) + 1)]))
    window.getSelection()?.removeAllRanges()
  }, [toggle])
  const clear = useCallback(() => setIds((s) => (s.size ? new Set() : s)), [])
  const set = useCallback((list: string[]) => setIds(new Set(list)), [])
  return useMemo(() => ({
    ids,
    has: (id: string) => ids.has(id),
    toggle,
    range,
    set,
    clear,
    click: (e, id, order) => {
      if (e.shiftKey) return range(order, id), true
      if (e.ctrlKey || e.metaKey) return toggle(id), true
      return false
    },
  }), [ids, toggle, range, set, clear])
}
