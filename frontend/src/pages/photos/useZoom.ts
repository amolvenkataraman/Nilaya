// Zoom and pan for the photo viewer (Google Photos style): wheel/pinch around the cursor (1×–8×), drag or
// two-finger pan clamped to the image, double click/tap toggles 2.5×, keys step and pan.
//
// Gestures don't go through React: each pointer or wheel event updates a ref and one requestAnimationFrame
// writes the transform straight onto the image layers ([data-zoom-layer]) and the % badge; React state is set
// once when the gesture ends (or for animated steps), so a drag costs no re-renders. Both paths compute the
// transform with `layerTransform`, so the rendered and the painted transform always agree.
//
// tx/ty/s are relative to the fit box; the image is laid out at its natural size and drawn with
// translate(fit + t) scale(fit × s) from origin 0 0, so zooming rasterises the full-resolution pixels.
import { type RefObject, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

/** Fit box of a W×H image inside the stage (minus the chrome padding), in stage pixels. */
export type Fit = { ox: number; oy: number; w: number; h: number; f: number; W: number; H: number }
export type ZoomView = { s: number; tx: number; ty: number }
export type ZoomState = ZoomView & { animate: boolean }

const MIN = 1
const MAX = 8
const IDLE: ZoomView = { s: 1, tx: 0, ty: 0 }
const reduced = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/** The blurred placeholder is drawn at fit size; the original at natural size scaled by the fit factor. */
export function layerTransform(layer: string | undefined, fit: Fit, v: ZoomView): string {
  const scale = layer === 'thumb' ? v.s : fit.f * v.s
  return `translate(${fit.ox + v.tx}px, ${fit.oy + v.ty}px) scale(${scale})`
}

const onChrome = (e: Event) => !!(e.target as HTMLElement).closest('[data-viewer-chrome]')

export function useZoom(stage: RefObject<HTMLDivElement | null>, enabled: boolean, photoId: string, fit: Fit | null) {
  const [state, setState] = useState<ZoomState>({ ...IDLE, animate: false })
  const [badge, setBadge] = useState(false)
  const badgeEl = useRef<HTMLSpanElement>(null)
  /** The view right now, ahead of `state` during a gesture. */
  const live = useRef<ZoomView>(IDLE)
  const fitRef = useRef(fit)
  fitRef.current = fit
  const pinched = useRef(false)

  const api = useMemo(() => {
    let frame = 0
    let badgeOn = false
    let badgeTimer: ReturnType<typeof setTimeout> | null = null
    const showBadge = () => {
      if (!badgeOn) {
        badgeOn = true
        setBadge(true)
      }
      if (badgeTimer) clearTimeout(badgeTimer)
      badgeTimer = setTimeout(() => {
        badgeOn = false
        setBadge(false)
      }, 900)
    }
    const paintBadge = () => {
      if (badgeEl.current) badgeEl.current.textContent = `${Math.round(live.current.s * 100)}%`
    }
    const paint = () => {
      frame = 0
      const st = stage.current
      const g = fitRef.current
      if (!st || !g) return
      for (const el of st.querySelectorAll<HTMLElement>('[data-zoom-layer]'))
        el.style.transform = layerTransform(el.dataset.zoomLayer, g, live.current)
      st.toggleAttribute('data-zoomed', live.current.s > 1)
      paintBadge()
    }
    /** The unzoomed (fit) box, relative to the stage. */
    const frameBox = () => {
      const st = stage.current
      const g = fitRef.current
      if (!st || !g) return null
      return { sr: st.getBoundingClientRect(), ox: g.ox, oy: g.oy, w: g.w, h: g.h }
    }
    const constrain = (s: number, tx: number, ty: number): ZoomView => {
      s = Math.min(MAX, Math.max(MIN, s))
      if (s === 1) return { s, tx: 0, ty: 0 }
      const b = frameBox()
      if (!b) return { s, tx, ty }
      const W = b.w * s
      const H = b.h * s
      const Cw = b.sr.width
      const Ch = b.sr.height
      return {
        s,
        tx: W <= Cw ? (b.w - W) / 2 : Math.min(-b.ox, Math.max(Cw - W - b.ox, tx)),
        ty: H <= Ch ? (b.h - H) / 2 : Math.min(-b.oy, Math.max(Ch - H - b.oy, ty)),
      }
    }
    /** During a gesture: no React work, one paint per frame. */
    const move = (v: ZoomView) => {
      live.current = v
      if (!frame) frame = requestAnimationFrame(paint)
      showBadge()
    }
    /** Settle on a view in React state (animated for steps, double-taps and keys). */
    const commit = (v: ZoomView, animate = false) => {
      if (frame) cancelAnimationFrame(frame)
      frame = 0
      live.current = v
      setState({ ...v, animate: animate && !reduced() })
      showBadge()
    }
    /** Keep the screen point (px, py) still while scaling to s. */
    const zoomAt = (s: number, px: number, py: number, animate: boolean, during: boolean) => {
      const b = frameBox()
      if (!b) return
      const z = live.current
      const lx = px - b.sr.left - b.ox
      const ly = py - b.sr.top - b.oy
      const u = (lx - z.tx) / z.s
      const v = (ly - z.ty) / z.s
      const ns = Math.min(MAX, Math.max(MIN, s))
      const next = constrain(ns, lx - u * ns, ly - v * ns)
      if (during) move(next)
      else commit(next, animate)
    }
    return {
      move,
      commit,
      constrain,
      zoomAt,
      paintBadge,
      settle: () => commit(live.current),
      stopAnimation: () => setState((x) => (x.animate ? { ...x, animate: false } : x)),
      dispose: () => {
        if (frame) cancelAnimationFrame(frame)
        if (badgeTimer) clearTimeout(badgeTimer)
      },
    }
  }, [stage])
  useEffect(() => api.dispose, [api])

  // React rendered a new state: mirror it into the attribute and badge that gestures also paint.
  useLayoutEffect(() => {
    stage.current?.toggleAttribute('data-zoomed', state.s > 1)
    api.paintBadge()
  })

  // Reset when the photo changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: photoId is the trigger
  useEffect(() => {
    live.current = IDLE
    setState({ ...IDLE, animate: false })
  }, [photoId])
  // The stage resized (window, details panel): keep the zoomed view inside the new bounds.
  // biome-ignore lint/correctness/useExhaustiveDependencies: fit is the trigger
  useEffect(() => {
    const z = live.current
    if (z.s > 1) api.commit(api.constrain(z.s, z.tx, z.ty))
  }, [fit, api])

  useEffect(() => {
    const st = stage.current
    if (!st || !enabled) return
    let wheelEnd: ReturnType<typeof setTimeout> | null = null
    const onWheel = (e: WheelEvent) => {
      if (onChrome(e)) return
      e.preventDefault() // a plain wheel never switches photos
      api.stopAnimation()
      const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0025))
      api.zoomAt(live.current.s * factor, e.clientX, e.clientY, false, true)
      if (wheelEnd) clearTimeout(wheelEnd)
      wheelEnd = setTimeout(api.settle, 150)
    }
    const onDbl = (e: MouseEvent) => {
      if (onChrome(e)) return
      api.zoomAt(live.current.s > 1 ? 1 : 2.5, e.clientX, e.clientY, true, false)
    }
    // Pointers: one = drag pan (when zoomed), two = pinch + pan. Double-tap toggles.
    const pts = new Map<number, { x: number; y: number }>()
    let last: { d: number; cx: number; cy: number } | null = null
    let drag: { x: number; y: number } | null = null
    let gesture = false
    let lastTap = 0
    const down = (e: PointerEvent) => {
      if (onChrome(e)) return
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (pts.size === 1) {
        pinched.current = false
        if (e.pointerType !== 'mouse') {
          const now = Date.now()
          if (now - lastTap < 300) api.zoomAt(live.current.s > 1 ? 1 : 2.5, e.clientX, e.clientY, true, false)
          lastTap = now
        }
        if (live.current.s > 1) {
          drag = { x: e.clientX, y: e.clientY }
          st.setPointerCapture?.(e.pointerId)
          st.toggleAttribute('data-dragging', true)
          api.stopAnimation()
        }
      }
      if (pts.size === 2) {
        pinched.current = true
        drag = null
        api.stopAnimation()
        const [a, b] = [...pts.values()]
        last = { d: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 }
      }
    }
    const moveP = (e: PointerEvent) => {
      if (!pts.has(e.pointerId)) return
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY })
      const z = live.current
      if (pts.size === 2 && last) {
        const [a, b] = [...pts.values()]
        const d = Math.hypot(a.x - b.x, a.y - b.y)
        const cx = (a.x + b.x) / 2
        const cy = (a.y + b.y) / 2
        const ns = Math.min(MAX, Math.max(MIN, z.s * (d / last.d)))
        // Zoom around the pinch centre, then follow the centre's movement (two-finger pan).
        const st2 = stage.current
        const g = fitRef.current
        if (st2 && g) {
          const sr = st2.getBoundingClientRect()
          const lx = last.cx - sr.left - g.ox
          const ly = last.cy - sr.top - g.oy
          const u = (lx - z.tx) / z.s
          const v = (ly - z.ty) / z.s
          api.move(api.constrain(ns, lx - u * ns + (cx - last.cx), ly - v * ns + (cy - last.cy)))
          gesture = true
        }
        last = { d, cx, cy }
      } else if (drag && z.s > 1) {
        api.move(api.constrain(z.s, z.tx + (e.clientX - drag.x), z.ty + (e.clientY - drag.y)))
        drag = { x: e.clientX, y: e.clientY }
        gesture = true
      }
    }
    const up = (e: PointerEvent) => {
      pts.delete(e.pointerId)
      if (pts.size < 2) last = null
      if (pts.size === 0) {
        drag = null
        st.toggleAttribute('data-dragging', false)
        if (gesture) api.settle()
        gesture = false
      }
    }
    st.addEventListener('wheel', onWheel, { passive: false })
    st.addEventListener('dblclick', onDbl)
    st.addEventListener('pointerdown', down)
    window.addEventListener('pointermove', moveP)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    return () => {
      if (wheelEnd) clearTimeout(wheelEnd)
      st.removeEventListener('wheel', onWheel)
      st.removeEventListener('dblclick', onDbl)
      st.removeEventListener('pointerdown', down)
      window.removeEventListener('pointermove', moveP)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
  }, [enabled, api, stage])

  return useMemo(
    () => ({
      state,
      badge,
      badgeEl,
      get: () => live.current,
      wasPinching: () => pinched.current,
      reset: () => api.commit(IDLE, true),
      step: (f: number) => {
        const r = stage.current?.getBoundingClientRect()
        if (r) api.zoomAt(live.current.s * f, r.left + r.width / 2, r.top + r.height / 2, true, false)
      },
      panBy: (dx: number, dy: number) => {
        const z = live.current
        api.commit(api.constrain(z.s, z.tx + dx, z.ty + dy), true)
      },
    }),
    [state, badge, api, stage],
  )
}
