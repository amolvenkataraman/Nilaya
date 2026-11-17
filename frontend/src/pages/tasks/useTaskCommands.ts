// What the Tasks keyboard commands (Shortcuts.tsx) do on the page: move the cursor, open, select, complete,
// favourite, reschedule, re-prioritise and delete the targeted tasks (the selection, else the open task,
// else the cursor row), switch views and layouts, focus mode, search and quick add.
import type { Dispatch, SetStateAction } from 'react'
import { layerOpen } from '../../components/layers'
import { toast } from '../../components/toast'
import type { useSetDone } from '../../lib/queries'
import type { SmartView } from '../../lib/qs'
import { PRIORITIES, type Task } from '../../lib/types'
import type { BulkOps, BulkTarget } from './bulk'
import type { useDeleteWithUndo } from './deleteUndo'
import type { Selection } from './selection'
import { type CommandHandlers, useTaskKeys } from './Shortcuts'
import { isTempId } from './task'
import type { LayoutName, TasksUrl } from './useTasksUrl'
import { revealRow } from './virtual'

export function useTaskCommands({
  url,
  sel,
  selected,
  setSelected,
  navOrder,
  findTask,
  setEditing,
  ops,
  bulkTarget,
  matchingOn,
  deleteLater,
  setDone,
  focus,
  setFocus,
  openHelp,
  confirmDeleteMatching,
}: {
  url: TasksUrl
  sel: Selection
  /** The keyboard cursor row. */
  selected: string | null
  setSelected: (id: string | null) => void
  /** Row ids in screen order, for the current layout. */
  navOrder: () => string[]
  findTask: (id: string | null) => Task | undefined
  setEditing: (id: string | null) => void
  ops: BulkOps
  bulkTarget: (ids: string[]) => BulkTarget
  /** "Select all N matching" is on: actions go by the list's filter. */
  matchingOn: boolean
  deleteLater: ReturnType<typeof useDeleteWithUndo>
  setDone: ReturnType<typeof useSetDone>
  focus: boolean
  setFocus: Dispatch<SetStateAction<boolean>>
  openHelp: () => void
  confirmDeleteMatching: () => void
}) {
  const { state, layout, update } = url
  const isList = layout === 'list'
  const rowsLayout = isList || layout === 'table'
  const isBoard = layout === 'board'
  const targets = (): Task[] => {
    const ids = sel.ids.size ? [...sel.ids] : state.task ? [state.task] : selected ? [selected] : []
    return ids.map(findTask).filter((t): t is Task => !!t && !isTempId(t.id))
  }
  /** Runs `fn` on the targeted tasks; false (key not handled) when there are none. */
  const onTargets = (fn: (list: Task[]) => void) => {
    const list = targets()
    if (!list.length) return false
    fn(list)
    return true
  }
  const focusTitle = () => setTimeout(() => document.querySelector<HTMLTextAreaElement>('.detail-title')?.focus(), 250)
  const handlers: CommandHandlers = {
    go: (_k, view) => {
      url.goView(view as SmartView)
      return true
    },
    layout: (_k, L) => {
      if (L === 'board' && !state.project) return false
      url.setLayout(L as LayoutName)
      return true
    },
    help: () => {
      openHelp()
      return true
    },
    search: () => {
      document.querySelector<HTMLInputElement>('.tasks-search input')?.focus()
      return true
    },
    quickAdd: () => {
      const el = document.querySelector<HTMLInputElement>('.tasks-quick .quick-add-input')
      if (!el || state.task) return false
      el.focus()
      return true
    },
    move: (k) => {
      const nav = navOrder()
      if (!nav.length || layout === 'calendar') return false
      const i = nav.indexOf(selected ?? '')
      const down = k === 'j' || k === 'ArrowDown'
      const next = nav[i < 0 ? (down ? 0 : nav.length - 1) : Math.max(0, Math.min(nav.length - 1, i + (down ? 1 : -1)))]
      setSelected(next)
      revealRow(next)
      if (state.task) update({ task: next }, true)
      return true
    },
    open: () => {
      if (!selected || state.task) return false
      update({ task: selected })
      return true
    },
    select: () => {
      if (!selected) return false
      sel.toggle(selected)
      return true
    },
    edit: () => {
      const t = findTask(state.task ?? selected)
      if (!t) return false
      if (isList && !state.task) setEditing(t.id)
      else {
        if (!state.task) update({ task: t.id })
        focusTitle()
      }
      return true
    },
    complete: () =>
      onTargets((list) => {
        if (list.length === 1 && !matchingOn) setDone.mutate({ task: list[0], done: !list[0].done })
        else ops.setDone(bulkTarget(list.map((t) => t.id)), !list.every((t) => t.done))
        sel.clear()
      }),
    favourite: () =>
      onTargets((list) => {
        const fav = !list.every((t) => t.favorite)
        ops.update(
          bulkTarget(list.map((t) => t.id)),
          { favorite: fav },
          list.length > 1 ? (fav ? 'Added to favourites' : 'Removed from favourites') : undefined,
        )
      }),
    dueToday: () =>
      onTargets((list) => {
        const eod = new Date()
        eod.setHours(23, 59, 0, 0)
        ops.update(bulkTarget(list.map((t) => t.id)), { due: eod.toISOString() }, 'Due today')
      }),
    priority: (k) =>
      onTargets((list) => {
        const p = PRIORITIES[Number(k) - 1]
        ops.setPriority(bulkTarget(list.map((t) => t.id)), p.value)
        toast.show(`Priority: ${p.label}`)
      }),
    delete: () =>
      onTargets((list) => {
        if (matchingOn) return confirmDeleteMatching()
        deleteLater(list)
        sel.clear()
        if (state.task && list.some((t) => t.id === state.task)) update({ task: null })
      }),
    focus: () => {
      if (!isList) return false
      setFocus((f) => !f)
      return true
    },
    sidebar: () => {
      document.querySelector<HTMLButtonElement>('.topbar [aria-controls="app-sidebar"]')?.click()
      return true
    },
    escape: () => {
      if (state.task || layerOpen(['dialog', 'menu', 'drawer'])) return false
      if (sel.ids.size) {
        sel.clear()
        return true
      }
      if (focus) {
        setFocus(false)
        return true
      }
      return false
    },
    selectAll: () => {
      if (!(rowsLayout || isBoard) || state.task) return false
      sel.set(navOrder())
      return true
    },
  }
  useTaskKeys(handlers)
}
