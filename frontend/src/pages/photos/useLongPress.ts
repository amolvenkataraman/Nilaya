// Long-press on touch and pen (500 ms, cancelled by moving more than 10 px): selects a tile on phones. Returns
// pointer handlers to spread, and `consumed()` for the click that follows a fired long-press (it must not open
// the photo). Mouse pointers are ignored: they select with a click or Shift/Ctrl-click.
import { useRef } from 'react'
import type { MouseEvent, PointerEvent } from 'react'
import { useLatest } from './useLatest'

export function useLongPress(onLongPress: () => void, ms = 500) {
  const press = useRef<{ t: ReturnType<typeof setTimeout>; x: number; y: number; fired: boolean } | null>(null)
  const fire = useLatest(onLongPress)
  const cancel = () => {
    const p = press.current
    if (p && !p.fired) {
      clearTimeout(p.t)
      press.current = null
    }
  }
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
      onContextMenu: (e: MouseEvent) => {
        if (press.current?.fired) e.preventDefault()
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
