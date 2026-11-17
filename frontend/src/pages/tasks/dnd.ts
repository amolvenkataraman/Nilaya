// HTML5 drag and drop as the Tasks layouts use it (list rows, board cards and columns, sidebar projects,
// calendar chips): one MIME type per kind of thing dragged, and the handful of steps every drop target
// repeats. Kept to plain functions so each layout keeps its own drag state.
import type { DragEvent } from 'react'

const TYPES = { task: 'text/x-task', bucket: 'text/x-bucket', project: 'text/x-project' } as const
export type DragKind = keyof typeof TYPES

/** Start dragging `id`. `after` runs once the browser has taken the drag image: changing what's under the
 *  pointer in the same tick (dimming the source, showing drop lines) makes Chrome cancel the drag. */
export function beginDrag(e: DragEvent, kind: DragKind, id: string, after?: () => void): void {
  e.dataTransfer.setData(TYPES[kind], id)
  e.dataTransfer.effectAllowed = 'move'
  if (after) setTimeout(after, 0)
}

/** The id of the dragged thing of `kind` (only readable on drop). */
export const draggedId = (e: DragEvent, kind: DragKind): string => e.dataTransfer.getData(TYPES[kind])

/** Accept a drop here (call from dragover). */
export function allowDrop(e: DragEvent): void {
  e.preventDefault()
  e.dataTransfer.dropEffect = 'move'
}

/** A dragleave that really left the target, not one moving onto a child of it. */
export const leftTarget = (e: DragEvent<HTMLElement>): boolean => !e.currentTarget.contains(e.relatedTarget as Node | null)

/** Where a drop at `y` lands among `els` (in order): before the first whose middle is below the pointer. */
export function dropIndex(els: HTMLElement[], y: number): number {
  const i = els.findIndex((el) => {
    const r = el.getBoundingClientRect()
    return y < r.top + r.height / 2
  })
  return i < 0 ? els.length : i
}
