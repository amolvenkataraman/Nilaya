// Drag and drop for list rows: drag one row or the selection; drop between rows of a manually ordered
// project list to reorder (a drop line shows where), onto a section to reschedule / re-prioritise / move,
// or onto a project in the sidebar to move there.
import { useState, type DragEvent } from 'react'
import type { Project, Task } from '../../lib/types'
import { usePlaceTasks } from './api'
import type { BulkOps } from './bulk'
import { allowDrop, beginDrag, dropIndex, leftTarget } from './dnd'
import { type Section, sectionDay, sectionPriority } from './grouping'
import { positionsBetween } from './order'
import type { Selection } from './selection'
import { canEditIn } from './task'

export interface ListDrag {
  ids: string[]
  /** The section key ("side:<id>" for a sidebar project) under the pointer. */
  over: string | null
  /** Drop index among the section's root rows, when reordering. */
  index?: number
}

type DropHandlers = {
  onDragOver?: (e: DragEvent<HTMLElement>) => void
  onDragLeave?: (e: DragEvent<HTMLElement>) => void
  onDrop?: (e: DragEvent<HTMLElement>) => void
}

export function useListDrop({
  reorderProject,
  canReorder,
  groups,
  order,
  sel,
  taskById,
  byId,
  ops,
  doneView,
  today,
}: {
  /** The project whose manual order a reorder changes ('' when none). */
  reorderProject: string
  canReorder: boolean
  groups: Section[]
  /** Row ids in screen order (a dragged selection keeps it). */
  order: string[]
  sel: Selection
  taskById: Map<string, Task>
  byId: Map<string, Project>
  ops: BulkOps
  doneView: boolean
  today: Date
}) {
  const [drag, setDrag] = useState<ListDrag | null>(null)
  const place = usePlaceTasks(reorderProject)
  const groupOf = new Map(groups.flatMap((g) => g.items.map((t) => [t.id, g.key] as const)))

  /** What dropping on a section does: due-date sections reschedule, priority sections re-prioritise, project sections move. */
  const dropAction = (key: string): ((ids: string[]) => void) | null => {
    if (doneView) return null
    const day = sectionDay(key, today)
    if (day !== undefined)
      return (ids) =>
        ops.setDue(
          ids,
          ids.map((id) => taskById.get(id)).filter((t): t is Task => !!t),
          day,
        )
    const prio = sectionPriority(key)
    if (prio !== undefined) return (ids) => ops.setPriority(ids, prio)
    const p = key.startsWith('pr') ? byId.get(key.slice(2)) : undefined
    if (p && canEditIn(p) && !p.archived) return (ids) => ops.move(ids, p)
    return null
  }

  /** Drop index among the section's root rows (not being dragged); only rows near the view are rendered. */
  const indexAt = (el: HTMLElement, y: number, list: Task[]) => {
    const dragged = drag?.ids ?? []
    const roots = list.map((t) => t.id).filter((id) => !dragged.includes(id))
    // `.pick[data-root]` marks root rows (ListRow); nested rows don't take part in reordering.
    const rows = Array.from(el.querySelectorAll<HTMLElement>('.pick[data-root]')).filter((r) => !dragged.includes(r.dataset.id ?? ''))
    const i = dropIndex(rows, y)
    if (i < rows.length) return Math.max(0, roots.indexOf(rows[i].dataset.id ?? ''))
    const last = rows.at(-1)
    return last ? roots.indexOf(last.dataset.id ?? '') + 1 : roots.length
  }

  const isChild = (id: string) => {
    const t = taskById.get(id)
    return !!t?.parent_id && taskById.has(t.parent_id)
  }

  return {
    drag,
    startDrag: (e: DragEvent, t: Task) => {
      const ids = sel.ids.has(t.id) ? order.filter((id) => sel.ids.has(id)) : [t.id]
      beginDrag(e, 'task', t.id, () => setDrag({ ids, over: null }))
    },
    endDrag: () => setDrag(null),

    /** Handlers for a section, or none when a drop there does nothing. */
    sectionDrop: (key: string, list: Task[]): DropHandlers => {
      if (!drag) return {}
      const reorderHere = canReorder && key === 'all' && !drag.ids.some(isChild)
      const act = reorderHere ? null : dropAction(key)
      if (!reorderHere && (!act || drag.ids.every((id) => groupOf.get(id) === key))) return {}
      return {
        onDragOver: (e) => {
          allowDrop(e)
          const index = reorderHere ? indexAt(e.currentTarget, e.clientY, list) : undefined
          if (drag.over !== key || drag.index !== index) setDrag({ ...drag, over: key, index })
        },
        onDragLeave: (e) => {
          if (leftTarget(e) && drag.over === key) setDrag({ ...drag, over: null })
        },
        onDrop: (e) => {
          e.preventDefault()
          if (reorderHere) {
            const rest = list.filter((t) => !drag.ids.includes(t.id))
            const at = indexAt(e.currentTarget, e.clientY, list)
            const ids = [...rest.slice(0, at).map((t) => t.id), ...drag.ids, ...rest.slice(at).map((t) => t.id)]
            const prev = rest[at - 1]
            const next = rest[at]
            if (ids.join() !== list.map((t) => t.id).join() && (prev || next)) {
              place.mutate({
                ids: drag.ids,
                after: prev?.id,
                before: prev ? undefined : next?.id,
                positions: positionsBetween(drag.ids.length, prev?.position, next?.position),
              })
            }
          } else act?.(drag.ids)
          setDrag(null)
        },
      }
    },

    /** Handlers for a project in the sidebar (move the dragged tasks there). */
    projectDrop: (p: Project | undefined): DropHandlers => {
      if (!drag || !p || !canEditIn(p) || p.archived) return {}
      const key = `side:${p.id}`
      return {
        onDragOver: (e) => {
          allowDrop(e)
          if (drag.over !== key) setDrag({ ...drag, over: key })
        },
        onDragLeave: (e) => {
          if (leftTarget(e) && drag.over === key) setDrag({ ...drag, over: null })
        },
        onDrop: (e) => {
          e.preventDefault()
          ops.move(drag.ids, p)
          setDrag(null)
        },
      }
    },
  }
}
