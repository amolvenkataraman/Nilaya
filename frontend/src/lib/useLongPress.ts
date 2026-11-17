// Long-press on touch and pen (500 ms, cancelled by moving more than 10 px), and optionally right-click with a
// mouse. Returns pointer handlers to spread, and `consumed()` for the click that follows a fired long-press (it
// must not also do the click's job, such as opening a photo).
import { useEffect, useRef, type MouseEvent, type PointerEvent } from 'react'
import { useLatest } from './useLatest'

export function useLongPress(onLongPress: () => void, { ms = 500, rightClick = false }: { ms?: number; rightClick?: boolean } = {}) {
  const press = useRef<{ t: ReturnType<typeof setTimeout>; x: number; y: number; fired: boolean } | null>(null)
  const fire = useLatest(onLongPress)
  const cancel = () => {
    const p = press.current
    if (p && !p.fired) {
      clearTimeout(p.t)
      press.current = null
    }
  }
  useEffect(() => () => clearTimeout(press.current?.t), [])
  return {
    handlers: {
      onPointerDown: (e: PointerEvent) => {
        if (e.pointerType === 'mouse') return
        const st = {
          x: e.clientX,
          y: e.clientY,
          fired: false,
          t: setTimeout(() => {
            st.fired = true
            fire.current()
          }, ms),
        }
        press.current = st
      },
      onPointerMove: (e: PointerEvent) => {
        const p = press.current
        if (p && !p.fired && Math.hypot(e.clientX - p.x, e.clientY - p.y) > 10) cancel()
      },
      onPointerUp: cancel,
      onPointerCancel: cancel,
      onPointerLeave: cancel,
      onContextMenu: (e: MouseEvent) => {
        // Android follows a long-press with contextmenu: it already fired, so only stop the browser menu.
        if (press.current?.fired) return e.preventDefault()
        if (rightClick) {
          e.preventDefault()
          fire.current()
        }
      },
    },
    /** True (once) when the current click ends a long-press. */
    consumed: () => {
      if (!press.current?.fired) return false
      press.current = null
      return true
    },
  }
}
