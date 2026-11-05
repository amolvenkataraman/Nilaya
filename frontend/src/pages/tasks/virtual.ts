// A small windowing hook for long task lists: only the rows near the viewport of the page's scroller
// (main#content) are rendered, plus overscan; rows are measured as they render (heights vary with meta
// lines and labels), unmeasured ones use an estimate, and spacers keep the scroll height right.
// Several windows can share one scroller (one per list section); revealRow() scrolls any of them to a row.
import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState, type RefObject } from 'react'

const OVERSCAN = 800 // px above and below the viewport
const registry = new Set<(key: string) => boolean>()

/** Scroll a windowed row into view even when it isn't rendered (keyboard navigation). */
export function revealRow(key: string): void {
  const el = document.querySelector(`[data-task="${CSS.escape(key)}"]`)
  if (el) return el.scrollIntoView({ block: 'nearest' })
  for (const reveal of registry) if (reveal(key)) return
}

export const pageScroller = (): HTMLElement | null => document.getElementById('content')

export interface Windowed {
  start: number
  end: number
  padTop: number
  padBottom: number
  /** Ref for each rendered row, by key: measures it. */
  measure: (key: string) => (el: HTMLElement | null) => void
}

export function useWindowed(keys: string[], container: RefObject<HTMLElement | null>, estimate = 44, gap = 0): Windowed {
  const heights = useRef(new Map<string, number>())
  const [version, bump] = useReducer((n: number) => n + 1, 0)
  const offsets = useMemo(() => {
    const out = new Float64Array(keys.length + 1)
    for (let i = 0; i < keys.length; i++) out[i + 1] = out[i] + (heights.current.get(keys[i]) ?? estimate) + gap
    return out
  }, [keys, estimate, gap, version]) // eslint-disable-line react-hooks/exhaustive-deps
  const [range, setRange] = useState<[number, number]>([0, Math.min(keys.length, 30)])

  const compute = useCallback(() => {
    const sc = pageScroller()
    const el = container.current
    if (!sc || !el) return
    const top = el.getBoundingClientRect().top - sc.getBoundingClientRect().top // container top in viewport coords
    const from = -top - OVERSCAN
    const to = -top + sc.clientHeight + OVERSCAN
    const n = keys.length
    let lo = 0, hi = n
    while (lo < hi) { const m = (lo + hi) >> 1; if (offsets[m + 1] <= from) lo = m + 1; else hi = m }
    const start = lo
    hi = n
    while (lo < hi) { const m = (lo + hi) >> 1; if (offsets[m] < to) lo = m + 1; else hi = m }
    const end = Math.max(start, lo)
    setRange((r) => (r[0] === start && r[1] === end ? r : [start, end]))
  }, [keys, offsets, container])

  useLayoutEffect(compute, [compute])
  useEffect(() => {
    const sc = pageScroller()
    if (!sc) return
    let raf = 0
    const on = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; compute() }) }
    sc.addEventListener('scroll', on, { passive: true })
    const ro = new ResizeObserver(on)
    ro.observe(sc)
    return () => { sc.removeEventListener('scroll', on); ro.disconnect(); cancelAnimationFrame(raf) }
  }, [compute])

  // Measure rendered rows; one re-layout per batch of changed heights.
  const ro = useRef<ResizeObserver | null>(null)
  const els = useRef(new Map<string, HTMLElement>())
  useEffect(() => {
    ro.current = new ResizeObserver((entries) => {
      let changed = false
      for (const e of entries) {
        const key = (e.target as HTMLElement).dataset.vkey
        if (!key) continue
        const h = Math.round((e.target as HTMLElement).offsetHeight)
        if (h && heights.current.get(key) !== h) { heights.current.set(key, h); changed = true }
      }
      if (changed) bump()
    })
    for (const el of els.current.values()) ro.current.observe(el)
    return () => ro.current?.disconnect()
  }, [])
  const refs = useRef(new Map<string, (el: HTMLElement | null) => void>())
  const measure = useCallback((key: string) => {
    let fn = refs.current.get(key)
    if (!fn) {
      fn = (el) => {
        const old = els.current.get(key)
        if (old && old !== el) ro.current?.unobserve(old)
        if (el) { el.dataset.vkey = key; els.current.set(key, el); ro.current?.observe(el) } else els.current.delete(key)
      }
      refs.current.set(key, fn)
    }
    return fn
  }, [])

  // revealRow() support: scroll so the row's estimated box is in view.
  const live = useRef({ keys, offsets })
  live.current = { keys, offsets }
  useEffect(() => {
    const reveal = (key: string) => {
      const i = live.current.keys.indexOf(key)
      const sc = pageScroller()
      const el = container.current
      if (i < 0 || !sc || !el) return false
      const base = el.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop
      const top = base + live.current.offsets[i]
      const bottom = base + live.current.offsets[i + 1]
      if (top < sc.scrollTop) sc.scrollTop = top - 8
      else if (bottom > sc.scrollTop + sc.clientHeight) sc.scrollTop = bottom - sc.clientHeight + 8
      return true
    }
    registry.add(reveal)
    return () => { registry.delete(reveal) }
  }, [container])

  const [start, end] = [Math.min(range[0], keys.length), Math.min(range[1], keys.length)]
  return { start, end, padTop: offsets[start], padBottom: offsets[keys.length] - offsets[end], measure }
}

/** Calls `load` when `ref` comes within ~1.5 screens of the scroller's viewport. */
export function useLoadMore(ref: RefObject<HTMLElement | null>, active: boolean, load: () => void, deps: unknown[] = []) {
  const fn = useRef(load)
  fn.current = load
  useEffect(() => {
    const el = ref.current
    if (!el || !active) return
    const io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && fn.current(), { root: pageScroller(), rootMargin: '150% 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [ref, active, ...deps]) // eslint-disable-line react-hooks/exhaustive-deps
}
