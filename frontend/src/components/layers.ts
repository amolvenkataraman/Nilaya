// Which overlays are open, in stacking order: dialogs, menus, drawers, the photo viewer, the command palette,
// popovers. Page shortcuts ask `layerOpen()` instead of querying the DOM for overlay classes, and overlays that
// handle their own keys (the viewer, the event peek) act only while `isTop()`.
//
// Escape itself is handled by each overlay: Base UI's dialogs and menus close only the topmost one, and the
// custom overlays check `isTop()` first.
import { useEffect, useRef } from 'react'

export type LayerKind = 'dialog' | 'menu' | 'drawer' | 'viewer' | 'palette' | 'popover'

/** The kinds that take over the keyboard: page shortcuts stay quiet while one is open. */
const MODAL: readonly LayerKind[] = ['dialog', 'menu', 'viewer', 'palette']

const stack: symbol[] = []
const kinds = new Map<symbol, LayerKind>()

/** Registers an overlay while `active`; returns `isTop()`. */
export function useLayer(kind: LayerKind, active: boolean): () => boolean {
  const id = useRef<symbol | null>(null)
  useEffect(() => {
    if (!active) return
    const me = Symbol(kind)
    id.current = me
    stack.push(me)
    kinds.set(me, kind)
    return () => {
      stack.splice(stack.indexOf(me), 1)
      kinds.delete(me)
      id.current = null
    }
  }, [kind, active])
  return () => id.current !== null && stack.at(-1) === id.current
}

/** Whether an overlay of these kinds is open (default: the ones that take over the keyboard). */
export function layerOpen(only: readonly LayerKind[] = MODAL): boolean {
  return stack.some((s) => only.includes(kinds.get(s) as LayerKind))
}
