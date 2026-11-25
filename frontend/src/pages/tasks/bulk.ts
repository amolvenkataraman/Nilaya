// Bulk actions on many tasks (bulk bar, keyboard, drag and drop): one optimistic cache pass and one
// POST /tasks/bulk per 500 ids, or, for "select all N matching", the list's filter instead of ids.
import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { toast } from '../../components/toast'
import { post } from '../../lib/api'
import { dayKey } from '../../lib/dates'
import { plural } from '../../lib/format'
import { refreshTaskCounts } from '../../lib/queries'
import { cachedTask, patchTaskLists, settleTaskLists } from '../../lib/taskLists'
import type { Project, Schemas, Task } from '../../lib/types'
import { taskKeys } from './api'
import { prioLabel } from './priority'
import { projectName } from './task'

/** After a filter-wide change: lib's counts, plus every list and open task (we don't hold them all). */
export function refreshTaskAreas(qc: QueryClient) {
  refreshTaskCounts(qc)
  qc.invalidateQueries({ queryKey: taskKeys.lists })
  qc.invalidateQueries({ queryKey: ['tasks', 'detail'] })
}

/** What a bulk action applies to: loaded rows by id, or every task matching the list ("select all N"). */
export type BulkTarget = string[] | { filter: Record<string, unknown>; total: number }
export const targetCount = (t: BulkTarget) => (Array.isArray(t) ? t.length : t.total)
export const BULK_IDS = 500

/** The action and its fields; which tasks it applies to (ids or filter) is added when sent. */
export type BulkBody = Omit<Schemas['BulkIn'], 'ids' | 'filter'>
type BulkOut = Schemas['BulkOut']

/** The list filters a "select all matching" sends (GET / params without paging and sort). */
export function bulkFilter(p: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const k of [
    'view',
    'project',
    'label',
    'priority_min',
    'q',
    'done',
    'due_before',
    'due_after',
    'parent',
    'top_level',
    'assignee',
    'done_after',
    'bucket',
  ]) {
    if (p[k] !== undefined && p[k] !== '') out[k] = p[k]
  }
  return out
}

export interface BulkVars {
  target: BulkTarget
  body: BulkBody
  /** Optimistic change, in place, to each selected task that's loaded. */
  patch?: (t: Task) => Task
  /** Optimistic change that moves tasks between lists at once (move to another project). */
  settle?: (t: Task) => Task
  /** Success toast (omit for silent, e.g. when the change is already visible). */
  done?: string | ((n: number) => string)
  undo?: (ids: string[]) => void
}

/** One mutation for N tasks: one optimistic cache pass, one request (POST /tasks/bulk, 500 ids per call),
 *  then the changed tasks are put where they belong in the cached lists. */
export function useBulk() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (v: BulkVars): Promise<BulkOut> => {
      if (!Array.isArray(v.target)) {
        const out: BulkOut = { count: 0, failed: 0, more: false, ids: [], tasks: null }
        for (let i = 0; i < 10; i++) {
          // 5000 a call; "more" means run again
          const r = await post<BulkOut>('tasks/bulk', { ...v.body, filter: v.target.filter })
          out.count += r.count
          out.failed = r.failed
          out.ids.push(...r.ids)
          if (!r.more || v.body.action !== 'delete') break // only a delete shrinks the match; others would repeat
        }
        return out
      }
      const out: BulkOut = { count: 0, failed: 0, more: false, ids: [], tasks: [] }
      for (let i = 0; i < v.target.length; i += BULK_IDS) {
        const r = await post<BulkOut>('tasks/bulk', { ...v.body, ids: v.target.slice(i, i + BULK_IDS) })
        out.count += r.count
        out.failed += r.failed
        out.ids.push(...r.ids)
        out.tasks?.push(...(r.tasks ?? []))
      }
      return out
    },
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: taskKeys.all })
      const ids = Array.isArray(v.target) ? v.target : [] // filter mode: no optimistic pass (we don't hold them all)
      if (v.body.action === 'delete') return { rollback: settleTaskLists(qc, { gone: ids }) }
      if (v.settle)
        return {
          rollback: settleTaskLists(qc, {
            tasks: ids
              .map((id) => cachedTask(qc, id))
              .filter((t): t is Task => !!t)
              .map(v.settle),
          }),
        }
      if (v.patch) return { rollback: patchTaskLists(qc, ids, v.patch) }
      return { rollback: () => {} }
    },
    onSuccess: (r, v) => {
      if (!Array.isArray(v.target)) refreshTaskAreas(qc)
      else if (v.body.action === 'delete') settleTaskLists(qc, { gone: r.ids })
      else settleTaskLists(qc, { tasks: r.tasks ?? [] })
      if (r.failed)
        toast.error(
          r.count ? `${r.failed} of ${r.count + r.failed} tasks couldn't be changed (view-only).` : 'You can only view these tasks.',
        )
      const msg = typeof v.done === 'function' ? v.done(r.count) : v.done
      const undo = v.undo
      if (msg && r.count) toast.show(msg, undo ? { action: { label: 'Undo', run: () => undo(r.ids) } } : undefined)
    },
    onError: (_e, _v, ctx) => {
      ctx?.rollback()
    },
    onSettled: () => refreshTaskCounts(qc),
  })
}

/** New due ISO for a task moved to `day`: same time of day if it had one, else 23:59. */
export function dueOn(cur: string | null, day: Date | null): string | null {
  if (!day) return null
  const d = new Date(day)
  const old = cur ? new Date(cur) : null
  if (old && !(old.getHours() === 23 && old.getMinutes() === 59)) d.setHours(old.getHours(), old.getMinutes(), 0, 0)
  else d.setHours(23, 59, 0, 0)
  return d.toISOString()
}

/** Ready-made bulk operations (bulk bar, keyboard, drag and drop). Each takes loaded ids or a filter. */
export function useBulkOps() {
  const bulk = useBulk()
  const update = (target: BulkTarget, body: Partial<Task>, done?: string) => {
    const b: BulkBody = { action: 'update' }
    if (body.favorite !== undefined) b.favorite = body.favorite
    if (body.priority !== undefined) b.priority = body.priority
    if (body.due !== undefined) {
      if (body.due) b.due = body.due
      else b.clear_due = true
    }
    bulk.mutate({ target, body: b, patch: (t) => ({ ...t, ...body }), done })
  }
  const ops = {
    pending: bulk.isPending,
    update,
    /** Keep each task's time of day unless it had none (23:59 = "that day"). */
    setDue: (target: BulkTarget, tasks: Task[], day: Date | null) => {
      const each = new Map(tasks.map((t) => [t.id, dueOn(t.due, day)]))
      bulk.mutate({
        target,
        body: day ? { action: 'update', due_day: dayKey(day) } : { action: 'update', clear_due: true },
        patch: (t) => ({ ...t, due: each.has(t.id) ? (each.get(t.id) ?? null) : dueOn(t.due, day) }),
      })
    },
    setPriority: (target: BulkTarget, priority: number) => update(target, { priority, priority_label: prioLabel(priority) }),
    /** Add the label to all, or take it off when every (loaded) selected task has it. */
    toggleLabel: (target: BulkTarget, tasks: Task[], labelId: number) => {
      const all = tasks.length > 0 && tasks.every((t) => t.labels.includes(labelId))
      bulk.mutate({
        target,
        body: all ? { action: 'update', remove_label: labelId } : { action: 'update', add_label: labelId },
        patch: (t) => ({ ...t, labels: all ? t.labels.filter((x) => x !== labelId) : [...new Set([...t.labels, labelId])] }),
      })
    },
    setDone: (target: BulkTarget, done: boolean) =>
      bulk.mutate({
        target,
        body: { action: done ? 'done' : 'reopen' },
        patch: (t) => ({ ...t, done, done_at: done ? new Date().toISOString() : null }),
        done: done ? (n) => `Completed ${plural(n, 'task')}` : undefined,
        undo: done ? (ids) => ops.setDone(ids, false) : undefined,
      }),
    move: (target: BulkTarget, project: Pick<Project, 'id' | 'name' | 'is_inbox'>) =>
      bulk.mutate({
        target,
        body: { action: 'move', project_id: project.id },
        settle: (t) => ({ ...t, project_id: project.id, bucket_id: null }),
        done: (n) => `Moved ${plural(n, 'task')} to ${projectName(project)}`,
      }),
    /** Delete right away (no undo window): for "all N matching", after a confirm. */
    remove: (target: BulkTarget) => bulk.mutate({ target, body: { action: 'delete' }, done: (n) => `Deleted ${plural(n, 'task')}` }),
  }
  return ops
}

export type BulkOps = ReturnType<typeof useBulkOps>
