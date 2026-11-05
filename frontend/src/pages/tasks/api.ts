// Tasks-page mutations not shared with other pages: projects, buckets, comments, saved views, labels,
// members, relations and bulk actions.
import { useCallback, useSyncExternalStore } from 'react'
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { API_BASE, ApiError, del, get, patch, post, readCookie } from '../../lib/api'
import { bumpParent, keys, refreshTaskCounts } from '../../lib/queries'
import { cachedTask, listItems, patchTaskLists, settleTaskLists, type TaskList } from '../../lib/taskLists'
import { dayKey } from '../../lib/dates'
import { toast } from '../../components/toast'
import type { Bucket, Comment, Label, Member, Project, Relation, SavedView, Task, TaskDetail, UserBrief } from '../../lib/types'

const onError = (e: unknown) => toast.error((e as Error).message)

const setProjects = (qc: QueryClient, fn: (l: Project[]) => Project[]) => {
  qc.setQueriesData<Project[]>({ queryKey: keys.projects }, (old) => (old ? fn(old) : old))
  qc.setQueryData<{ projects?: Project[] }>(keys.overview, (o) => (o?.projects ? { ...o, projects: fn(o.projects) } : o))
}

export function useSaveProject() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id?: string; body: Partial<Project> }) =>
      id ? patch<Project>(`tasks/projects/${id}`, body) : post<Project>('tasks/projects', body),
    onMutate: async ({ id, body }) => {
      // Optimistic for edits (drag in the tree, favourite, archive): every cached project list + the overview copy.
      if (!id) return
      await qc.cancelQueries({ queryKey: keys.projects })
      const snaps = [...qc.getQueriesData({ queryKey: keys.projects }), [keys.overview, qc.getQueryData(keys.overview)] as const]
      setProjects(qc, (list) => list.map((p) => (p.id === id ? { ...p, ...body } : p)))
      return { rollback: () => snaps.forEach(([k, d]) => qc.setQueryData(k, d)) }
    },
    onSuccess: (p) => {
      // The response has no open count: keep the one we have. Counts and the archived list refresh from the overview.
      setProjects(qc, (list) => (list.some((x) => x.id === p.id) ? list.map((x) => (x.id === p.id ? { ...x, ...p, open_count: x.open_count, done_count: x.done_count } : x)) : [...list, p]))
      qc.invalidateQueries({ queryKey: keys.overview })
      qc.invalidateQueries({ queryKey: [...keys.projects, 'archived'] })
    },
    onError: (e, _v, ctx) => (ctx?.rollback(), onError(e)),
  })
}

export function useDeleteProject() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => del(`tasks/projects/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks'] }),
    onError,
  })
}

export function useSaveBucket(projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id?: number; body: Partial<Bucket> }) =>
      id ? patch<Bucket>(`tasks/buckets/${id}`, body) : post<Bucket>(`tasks/projects/${projectId}/buckets`, body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: keys.buckets(projectId) }); qc.invalidateQueries({ queryKey: ['tasks', 'board', projectId] }) },
    onError,
  })
}

export function useDeleteBucket() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => del(`tasks/buckets/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks'] }),
    onError,
  })
}

/** Take myself off a task's assignees (allowed even when the task is view-only for me). */
export function useUnassignMe(taskId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => post<void>(`tasks/${taskId}/unassign`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks'] }),
    onError,
  })
}

export function useAddComment(taskId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: string) => post<Comment>(`tasks/${taskId}/comments`, { body }),
    onSuccess: (c) => {
      qc.setQueryData<Comment[]>(keys.comments(taskId), (old) => [...(old ?? []), c])
      patchTaskLists(qc, [taskId], (t) => ({ ...t, comments: (t.comments ?? 0) + 1 }))
    },
    onError,
  })
}

export function useDeleteComment(taskId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => del(`tasks/comments/${id}`),
    onMutate: (id) => qc.setQueryData<Comment[]>(keys.comments(taskId), (old) => old?.filter((c) => c.id !== id)),
    onSettled: () => qc.invalidateQueries({ queryKey: keys.comments(taskId) }),
    onError,
  })
}

export function useEditComment(taskId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: string }) => patch<Comment>(`tasks/comments/${id}`, { body }),
    onSuccess: (c) => qc.setQueryData<Comment[]>(keys.comments(taskId), (old) => old?.map((x) => (x.id === c.id ? c : x))),
    onError,
  })
}

/** Saved views live in their own cache and in the overview's copy (which re-seeds it); keep both in step. */
const setViews = (qc: QueryClient, fn: (v: SavedView[]) => SavedView[]) => {
  const sort = (l: SavedView[]) => [...l].sort((a, b) => a.position - b.position)
  qc.setQueryData<SavedView[]>(keys.views, (old) => sort(fn(old ?? [])))
  qc.setQueryData<{ views?: SavedView[] }>(keys.overview, (o) => (o?.views ? { ...o, views: sort(fn(o.views)) } : o))
}

/** Create a view, or rename / change filters / move one (PATCH). */
export function useSaveView() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id?: string; body: { name?: string; filters?: Record<string, unknown>; position?: number } }) =>
      id ? patch<SavedView>(`tasks/views/${id}`, body) : post<SavedView>('tasks/views', body),
    onSuccess: (v) => setViews(qc, (list) => (list.some((x) => x.id === v.id) ? list.map((x) => (x.id === v.id ? v : x)) : [...list, v])),
    onError,
  })
}

export function useDeleteView() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => del(`tasks/views/${id}`),
    onSuccess: (_r, id) => setViews(qc, (list) => list.filter((x) => x.id !== id)),
    onError,
  })
}

export function useDuplicateTask() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => post<{ id: string; title: string }>(`tasks/${id}/duplicate`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks'] }),
    onError,
  })
}

/** Put tasks (in this order) right after one task, or before another, in a project's manual order. The
 *  server picks positions between the neighbours, so it works when only part of the list is loaded. */
export function usePlaceTasks(projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (v: { ids: string[]; after?: string; before?: string; positions: number[] }) =>
      post<{ positions: Record<string, number>; renumbered: boolean }>(`tasks/projects/${projectId}/place`, { ids: v.ids, after: v.after, before: v.before }),
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: ['tasks', 'list'] })
      const tasks = v.ids.map((id, i) => { const t = cachedTask(qc, id); return t && { ...t, position: v.positions[i] } }).filter((t): t is Task => !!t)
      return { rollback: settleTaskLists(qc, { tasks, keep: v.ids }) }
    },
    onSuccess: (r, v) => {
      if (r.renumbered) return qc.invalidateQueries({ queryKey: ['tasks', 'list'] }) // other tasks moved too (rare)
      const tasks = Object.entries(r.positions).map(([id, position]) => { const t = cachedTask(qc, id); return t && { ...t, position } }).filter((t): t is Task => !!t)
      settleTaskLists(qc, { tasks, keep: v.ids })
    },
    onError: (e, _v, ctx) => (ctx?.rollback(), onError(e)),
  })
}

/** Positions for `n` tasks dropped between two loaded neighbours (the optimistic copy of the server's choice). */
export function positionsBetween(n: number, prev?: number, next?: number): number[] {
  if (prev == null && next == null) return Array.from({ length: n }, (_, i) => i + 1)
  if (next == null) return Array.from({ length: n }, (_, i) => prev! + i + 1)
  if (prev == null) return Array.from({ length: n }, (_, i) => next - n + i)
  return Array.from({ length: n }, (_, i) => prev + ((next - prev) * (i + 1)) / (n + 1))
}

// ---------------------------------------------------------------- bulk actions
/** Same areas as lib/queries refreshTaskCounts, plus every list (after a filter-wide change). */
export function refreshTaskAreas(qc: QueryClient) {
  for (const k of [['tasks', 'list'], ['tasks', 'overview'], ['tasks', 'board'], ['tasks', 'detail'], ['calendar', 'agenda']]) qc.invalidateQueries({ queryKey: k })
}

/** What a bulk action applies to: loaded rows by id, or every task matching the list ("select all N"). */
export type BulkTarget = string[] | { filter: Record<string, unknown>; total: number }
export const targetCount = (t: BulkTarget) => (Array.isArray(t) ? t.length : t.total)
const BULK_IDS = 500

export interface BulkBody {
  action: 'done' | 'reopen' | 'update' | 'move' | 'delete'
  priority?: number; favorite?: boolean; due?: string | null; due_day?: string; clear_due?: boolean
  add_label?: number; remove_label?: number; project_id?: string
}
interface BulkOut { count: number; failed: number; more: boolean; ids: string[]; tasks: Task[] | null }

/** The list filters a "select all matching" sends (GET / params without paging and sort). */
export function bulkFilter(p: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const k of ['view', 'project', 'label', 'priority_min', 'q', 'done', 'due_before', 'due_after', 'parent', 'top_level', 'assignee', 'done_after', 'bucket']) {
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
        for (let i = 0; i < 10; i++) { // 5000 a call; "more" means run again
          const r = await post<BulkOut>('tasks/bulk', { ...v.body, filter: v.target.filter })
          out.count += r.count; out.failed = r.failed; out.ids.push(...r.ids)
          if (!r.more || v.body.action !== 'delete') break // only a delete shrinks the match; others would repeat
        }
        return out
      }
      const out: BulkOut = { count: 0, failed: 0, more: false, ids: [], tasks: [] }
      for (let i = 0; i < v.target.length; i += BULK_IDS) {
        const r = await post<BulkOut>('tasks/bulk', { ...v.body, ids: v.target.slice(i, i + BULK_IDS) })
        out.count += r.count; out.failed += r.failed; out.ids.push(...r.ids); out.tasks!.push(...(r.tasks ?? []))
      }
      return out
    },
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: ['tasks'] })
      const ids = Array.isArray(v.target) ? v.target : [] // filter mode: no optimistic pass (we don't hold them all)
      if (v.body.action === 'delete') return { rollback: settleTaskLists(qc, { gone: ids }) }
      if (v.settle) return { rollback: settleTaskLists(qc, { tasks: ids.map((id) => cachedTask(qc, id)).filter((t): t is Task => !!t).map(v.settle) }) }
      if (v.patch) return { rollback: patchTaskLists(qc, ids, v.patch) }
      return { rollback: () => {} }
    },
    onSuccess: (r, v) => {
      if (!Array.isArray(v.target)) refreshTaskAreas(qc)
      else if (v.body.action === 'delete') settleTaskLists(qc, { gone: r.ids })
      else settleTaskLists(qc, { tasks: r.tasks ?? [] })
      if (r.failed) toast.error(r.count ? `${r.failed} of ${r.count + r.failed} tasks couldn't be changed (view-only).` : "You can only view these tasks.")
      const msg = typeof v.done === 'function' ? v.done(r.count) : v.done
      if (msg && r.count) toast.show(msg, v.undo ? { action: { label: 'Undo', run: () => v.undo!(r.ids) } } : undefined)
    },
    onError: (e, _v, ctx) => { ctx?.rollback(); toast.error((e as Error).message) },
    onSettled: () => refreshTaskCounts(qc),
  })
}

const PRIO_LABEL: Record<number, string> = { 0: 'None', 5: 'Low', 10: 'Medium', 15: 'High', 20: 'Urgent' }
export const plural = (n: number, w = 'task') => `${n.toLocaleString()} ${w}${n === 1 ? '' : 's'}`

/** Ready-made bulk operations (bulk bar, keyboard, drag and drop). Each takes loaded ids or a filter. */
export function useBulkOps() {
  const bulk = useBulk()
  const update = (target: BulkTarget, body: Partial<Task>, done?: string) => {
    const b: BulkBody = { action: 'update' }
    if (body.favorite !== undefined) b.favorite = body.favorite
    if (body.priority !== undefined) b.priority = body.priority
    if (body.due !== undefined) { if (body.due) b.due = body.due; else b.clear_due = true }
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
        patch: (t) => ({ ...t, due: each.has(t.id) ? each.get(t.id)! : dueOn(t.due, day) }),
      })
    },
    setPriority: (target: BulkTarget, priority: number) => update(target, { priority, priority_label: PRIO_LABEL[priority] ?? '' } as Partial<Task>),
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
        done: done ? (n) => `Completed ${plural(n)}` : undefined,
        undo: done ? (ids) => ops.setDone(ids, false) : undefined,
      }),
    move: (target: BulkTarget, project: Pick<Project, 'id' | 'name' | 'is_inbox'>) =>
      bulk.mutate({
        target,
        body: { action: 'move', project_id: project.id },
        settle: (t) => ({ ...t, project_id: project.id, bucket_id: null }),
        done: (n) => `Moved ${plural(n)} to ${project.is_inbox ? 'Inbox' : project.name}`,
      }),
    /** Delete right away (no undo window): for "all N matching", after a confirm. */
    remove: (target: BulkTarget) => bulk.mutate({ target, body: { action: 'delete' }, done: (n) => `Deleted ${plural(n)}` }),
  }
  return ops
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

// ---------------------------------------------------------------- labels
const setLabels = (qc: QueryClient, fn: (l: Label[]) => Label[]) => {
  qc.setQueryData<Label[]>(keys.labels, (old) => fn(old ?? []))
  qc.setQueryData<{ labels?: Label[] }>(keys.overview, (o) => (o?.labels ? { ...o, labels: fn(o.labels) } : o))
}

export function useSaveLabel() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id?: number; body: { name?: string; colour?: string } }) =>
      id ? patch<Label>(`tasks/labels/${id}`, body) : post<Label>('tasks/labels', body),
    onSuccess: (l) => setLabels(qc, (list) => (list.some((x) => x.id === l.id) ? list.map((x) => (x.id === l.id ? l : x)) : [...list, l])),
    onError,
  })
}

export function useDeleteLabel() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => del(`tasks/labels/${id}`),
    onSuccess: (_r, id) => {
      setLabels(qc, (list) => list.filter((x) => x.id !== id))
      qc.invalidateQueries({ queryKey: ['tasks', 'list'] }) // tasks lose the label
    },
    onError,
  })
}

// ---------------------------------------------------------------- project members
const membersKey = (projectId: string) => ['tasks', 'members', projectId] as const
export const useMembers = (projectId: string | null) =>
  useQuery({ queryKey: membersKey(projectId ?? ''), queryFn: () => get<Member[]>(`tasks/projects/${projectId}/members`), enabled: !!projectId })

/** The `shared` flag on projects comes from the overview (which re-seeds the projects cache). */
const refreshShared = (qc: QueryClient) => {
  qc.invalidateQueries({ queryKey: keys.overview })
  qc.invalidateQueries({ queryKey: [...keys.projects, 'archived'] })
}

/** Add someone, or change their role (the API upserts by username). */
export function useSaveMember(projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { username: string; role: number }) => post<Member>(`tasks/projects/${projectId}/members`, body),
    onSuccess: (m) => {
      qc.setQueryData<Member[]>(membersKey(projectId), (old) => (old?.some((x) => x.id === m.id) ? old.map((x) => (x.id === m.id ? m : x)) : [...(old ?? []), m]))
      refreshShared(qc)
    },
    onError: (e, v) => toast.error(e instanceof ApiError && e.status === 404 ? `No user called "${v.username}".` : (e as Error).message),
  })
}

export function useRemoveMember(projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => del(`tasks/projects/${projectId}/members/${id}`),
    onSuccess: (_r, id) => {
      qc.setQueryData<Member[]>(membersKey(projectId), (old) => old?.filter((x) => x.id !== id))
      refreshShared(qc)
    },
    onError,
  })
}

export type ProjectWithOwner = Project & { owner?: UserBrief }

// ---------------------------------------------------------------- relations
export const RELATION_KINDS = [
  ['related', 'Related to'], ['blocks', 'Blocks'], ['blocked_by', 'Blocked by'], ['precedes', 'Precedes'], ['follows', 'Follows'],
  ['duplicate_of', 'Duplicate of'], ['duplicated_by', 'Duplicated by'],
] as const
export type RelationKind = (typeof RELATION_KINDS)[number][0]

export function useAddRelation(taskId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { other_id: string; kind: RelationKind }) => post<Relation>(`tasks/${taskId}/relations`, body),
    onSuccess: (r) => {
      qc.setQueryData<TaskDetail>(keys.task(taskId), (old) => (old ? { ...old, relations: [...old.relations.filter((x) => x.id !== r.id), r] } : old))
      qc.invalidateQueries({ queryKey: keys.task(r.other_id) }) // the reverse link (only refetches if open)
    },
    onError,
  })
}

export function useRemoveRelation(taskId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (r: Relation) => del(`tasks/${taskId}/relations/${r.id}`),
    onMutate: (r) => {
      const prev = qc.getQueryData<TaskDetail>(keys.task(taskId))
      if (prev) qc.setQueryData<TaskDetail>(keys.task(taskId), { ...prev, relations: prev.relations.filter((x) => x.id !== r.id) })
      return { prev }
    },
    onError: (e, _r, ctx) => (ctx?.prev && qc.setQueryData(keys.task(taskId), ctx.prev), onError(e)),
    onSettled: (_d, _e, r) => qc.invalidateQueries({ queryKey: keys.task(r.other_id) }),
  })
}

// ---------------------------------------------------------------- delete with undo
// Deleted tasks leave the lists at once; the DELETE goes out when the 6 s undo toast expires (or when
// the page is left). Hidden ids are filtered from lists so a refetch inside the window can't bring them back.
let hidden = new Set<string>()
const hiddenListeners = new Set<() => void>()
const setHidden = (next: Set<string>) => { hidden = next; hiddenListeners.forEach((l) => l()) }
const pending = new Map<symbol, string[]>()
export const useHiddenTasks = () => useSyncExternalStore((l) => (hiddenListeners.add(l), () => hiddenListeners.delete(l)), () => hidden)

/** Delete through the bulk endpoint, 500 ids a request; keepalive lets it finish while the page unloads. */
async function bulkDelete(ids: string[], keepalive = false): Promise<number> {
  let failed = 0
  for (let i = 0; i < ids.length; i += BULK_IDS) {
    const chunk = ids.slice(i, i + BULK_IDS)
    try {
      if (keepalive) {
        await fetch(`${API_BASE}/tasks/bulk`, { method: 'POST', keepalive: true, credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-CSRFToken': readCookie('csrftoken') }, body: JSON.stringify({ action: 'delete', ids: chunk }) })
      } else {
        await post('tasks/bulk', { action: 'delete', ids: chunk })
      }
    } catch { failed += chunk.length }
  }
  return failed
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => {
    for (const ids of pending.values()) bulkDelete(ids, true).catch(() => {})
    pending.clear()
  })
}

export function useDeleteWithUndo() {
  const qc = useQueryClient()
  return useCallback((tasks: (Pick<Task, 'id' | 'title'> & Partial<Pick<Task, 'parent_id' | 'done'>>)[]) => {
    if (!tasks.length) return
    const ids = tasks.map((t) => t.id)
    const gone = new Set(ids)
    // Loaded subtasks go with their parent (the server deletes them too).
    for (const [, data] of qc.getQueriesData<TaskList>({ queryKey: ['tasks', 'list'] })) {
      for (const t of listItems(data)) if (t.parent_id && gone.has(t.parent_id)) gone.add(t.id)
    }
    setHidden(new Set([...hidden, ...gone]))
    const key = Symbol('delete')
    pending.set(key, ids)
    const unhide = () => setHidden(new Set([...hidden].filter((id) => !gone.has(id))))
    const timer = setTimeout(async () => {
      if (!pending.delete(key)) return
      const failed = await bulkDelete(ids)
      if (failed) toast.error(failed === ids.length ? "Couldn't delete. Nothing was deleted." : `${failed} of ${ids.length} tasks couldn't be deleted.`)
      for (const id of ids) qc.removeQueries({ queryKey: keys.task(id) })
      if (!failed) settleTaskLists(qc, { gone })
      else qc.invalidateQueries({ queryKey: ['tasks', 'list'] })
      for (const t of tasks) if ('parent_id' in t && t.parent_id && !gone.has(t.parent_id)) bumpParent(qc, t.parent_id as string, { subtasks: -1, done: (t as Task).done ? -1 : 0 })
      refreshTaskCounts(qc)
      unhide()
    }, 6000)
    toast.show(ids.length === 1 ? `Deleted "${tasks[0].title}"` : `Deleted ${plural(ids.length)}`, {
      action: { label: 'Undo', run: () => { clearTimeout(timer); pending.delete(key); unhide() } },
    })
  }, [qc])
}
