// Delete with undo: deleted tasks leave the lists at once; the DELETE goes out when the 6 s undo toast
// expires (or when the page is left, with keepalive). Hidden ids are filtered from every list, so a refetch
// inside the window can't bring them back.
import { useCallback, useSyncExternalStore } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from '../../components/toast'
import { api } from '../../lib/api'
import { plural } from '../../lib/format'
import { bumpParent, keys, refreshTaskCounts } from '../../lib/queries'
import { listItems, settleTaskLists, type TaskList } from '../../lib/taskLists'
import type { Task } from '../../lib/types'
import { taskKeys } from './api'
import { BULK_IDS } from './bulk'

let hidden = new Set<string>()
const hiddenListeners = new Set<() => void>()
const setHidden = (next: Set<string>) => {
  hidden = next
  for (const l of hiddenListeners) l()
}
const pending = new Map<symbol, string[]>()

/** Ids deleted but still inside their undo window. */
export const useHiddenTasks = () =>
  useSyncExternalStore(
    (l) => {
      hiddenListeners.add(l)
      return () => hiddenListeners.delete(l)
    },
    () => hidden,
  )

/** Delete through the bulk endpoint, 500 ids a request; keepalive lets it finish while the page unloads. */
async function bulkDelete(ids: string[], keepalive = false): Promise<number> {
  let failed = 0
  for (let i = 0; i < ids.length; i += BULK_IDS) {
    const chunk = ids.slice(i, i + BULK_IDS)
    try {
      await api('tasks/bulk', { method: 'POST', body: { action: 'delete', ids: chunk }, keepalive })
    } catch {
      failed += chunk.length
    }
  }
  return failed
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => {
    for (const ids of pending.values()) bulkDelete(ids, true).catch(() => {})
    pending.clear()
  })
}

type Deletable = Pick<Task, 'id' | 'title'> & Partial<Pick<Task, 'parent_id' | 'done'>>

export function useDeleteWithUndo() {
  const qc = useQueryClient()
  return useCallback(
    (tasks: Deletable[]) => {
      if (!tasks.length) return
      const ids = tasks.map((t) => t.id)
      const gone = new Set(ids)
      // Loaded subtasks go with their parent (the server deletes them too).
      for (const [, data] of qc.getQueriesData<TaskList>({ queryKey: taskKeys.lists })) {
        for (const t of listItems(data)) if (t.parent_id && gone.has(t.parent_id)) gone.add(t.id)
      }
      setHidden(new Set([...hidden, ...gone]))
      const key = Symbol('delete')
      pending.set(key, ids)
      const unhide = () => setHidden(new Set([...hidden].filter((id) => !gone.has(id))))
      const timer = setTimeout(async () => {
        if (!pending.delete(key)) return
        const failed = await bulkDelete(ids)
        if (failed)
          toast.error(
            failed === ids.length ? "Couldn't delete. Nothing was deleted." : `${failed} of ${ids.length} tasks couldn't be deleted.`,
          )
        for (const id of ids) qc.removeQueries({ queryKey: keys.task(id) })
        if (!failed) settleTaskLists(qc, { gone })
        else qc.invalidateQueries({ queryKey: taskKeys.lists })
        for (const t of tasks)
          if (t.parent_id && !gone.has(t.parent_id)) bumpParent(qc, t.parent_id, { subtasks: -1, done: t.done ? -1 : 0 })
        refreshTaskCounts(qc)
        unhide()
      }, 6000)
      toast.show(ids.length === 1 ? `Deleted "${tasks[0].title}"` : `Deleted ${plural(ids.length, 'task')}`, {
        action: {
          label: 'Undo',
          run: () => {
            clearTimeout(timer)
            pending.delete(key)
            unhide()
          },
        },
      })
    },
    [qc],
  )
}
