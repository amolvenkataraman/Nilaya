// Reordering Today's habits: drag a row by its grip within its own list (saved once on release), or move it
// one step within its section (menu, Alt+↑/↓). Keyboard focus follows a row that re-renders elsewhere.
// Rows carry data-hid; each list carries data-habit-list.
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { useReorder, type TodayRow } from './api'

/** Classes on <body> while dragging, so the cursor stays a grabbing hand and text isn't selected. */
const SORTING = ['cursor-grabbing!', '**:cursor-grabbing!', 'select-none']

export function useRowReorder(loaded: TodayRow[], isDue: (r: TodayRow) => boolean) {
  const reorder = useReorder()
  const [dragOrder, setDragOrder] = useState<string[] | null>(null)
  const refocus = useRef<string | null>(null)
  const rows = useMemo(() => {
    if (!dragOrder) return loaded
    const byId = new Map(loaded.map((r) => [r.habit.id, r]))
    return dragOrder.map((id) => byId.get(id)).filter((r): r is TodayRow => !!r)
  }, [loaded, dragOrder])

  /** Keep keyboard focus on a row that re-renders elsewhere (reordered, or moved between sections by a skip). */
  const keepFocus = (id: string) => {
    refocus.current = id
    window.setTimeout(() => {
      if (refocus.current === id) refocus.current = null
    }, 3000)
  }
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs after the rows re-render, which is what `rows` marks
  useEffect(() => {
    const id = refocus.current
    if (!id) return
    const el = document.querySelector<HTMLElement>(`[data-hid="${id}"]`)
    if (el && (!document.activeElement || document.activeElement === document.body)) el.focus()
  }, [rows])

  /** Swap with the neighbour in the same section (due / not due). */
  const move = (id: string, dir: -1 | 1) => {
    const ids = rows.map((r) => r.habit.id)
    const row = rows.find((r) => r.habit.id === id)
    if (!row) return
    const section = rows.filter((r) => isDue(r) === isDue(row)).map((r) => r.habit.id)
    const nb = section[section.indexOf(id) + dir]
    if (!nb) return
    const i = ids.indexOf(id)
    const j = ids.indexOf(nb)
    ;[ids[i], ids[j]] = [ids[j], ids[i]]
    keepFocus(id)
    reorder.mutate(ids)
  }

  /** Pointer-down handler for a row's grip. */
  const drag = (id: string) => (e: ReactPointerEvent<HTMLElement>) => {
    if (e.button !== 0) return
    e.preventDefault()
    const list = e.currentTarget.closest('[data-habit-list]')
    if (!list) return
    let full = rows.map((r) => r.habit.id)
    const startOrder = full.join()
    setDragOrder(full)
    const onMove = (ev: PointerEvent) => {
      const els = Array.from(list.querySelectorAll<HTMLElement>('[data-hid]'))
      const sec = els.map((el) => el.dataset.hid as string)
      const rest = els.filter((el) => el.dataset.hid !== id)
      let at = rest.findIndex((el) => {
        const r = el.getBoundingClientRect()
        return ev.clientY < r.top + r.height / 2
      })
      if (at < 0) at = rest.length
      const next = rest.map((el) => el.dataset.hid as string)
      next.splice(at, 0, id)
      if (next.join() === sec.join()) return
      const slots = new Set(sec)
      let k = 0
      full = full.map((x) => (slots.has(x) ? next[k++] : x))
      setDragOrder(full)
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      document.body.classList.remove(...SORTING)
      if (full.join() === startOrder) setDragOrder(null)
      else reorder.mutate(full, { onSettled: () => setDragOrder(null) })
    }
    document.body.classList.add(...SORTING)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }

  return { rows, move, drag, keepFocus }
}
