// Tasks-page mutations not shared with other pages: projects, buckets, comments, saved views, labels,
// members, relations and bulk actions.
import { useCallback, useSyncExternalStore } from 'react'
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { API_BASE, ApiError, del, get, patch, post, readCookie } from '../../lib/api'
import { keys, patchTaskCaches } from '../../lib/queries'
import { toast } from '../../components/toast'
import type { Bucket, Comment, Label, Member, Project, Relation, SavedView, Task, TaskDetail, TaskPage, UserBrief } from '../../lib/types'

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
      setProjects(qc, (list) => (list.some((x) => x.id === p.id) ? list.map((x) => (x.id === p.id ? { ...x, ...p, open_count: x.open_count } : x)) : [...list, p]))
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
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.buckets(projectId) }),
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
      qc.invalidateQueries({ queryKey: ['tasks', 'list'] })
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

/** Set the order of tasks in a project (positions 0..n), e.g. a board column after a drop. */
export function useReorderTasks(projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (ids: string[]) => post<void>(`tasks/projects/${projectId}/reorder`, { ids }),
    onMutate: (ids) => {
      const rollbacks = ids.map((id, i) => patchTaskCaches(qc, id, (t) => ({ ...t, position: i })))
      return { rollback: () => rollbacks.reverse().forEach((r) => r()) }
    },
    onError: (e, _v, ctx) => (ctx?.rollback(), onError(e)),
    onSettled: () => qc.invalidateQueries({ queryKey: ['tasks', 'list'] }),
  })
}

// ---------------------------------------------------------------- bulk actions
/** Same areas as lib/queries refreshTasks: lists, counts, the open task, the dashboard agenda. */
export function refreshTaskAreas(qc: QueryClient) {
  for (const k of [['tasks', 'list'], ['tasks', 'overview'], ['tasks', 'detail'], ['calendar', 'agenda']]) qc.invalidateQueries({ queryKey: k })
}

/** Run `fn` over `items`, at most `n` at a time (the browser's per-host limit). Resolves to the failure count. */
export async function pool<T>(items: T[], fn: (x: T) => Promise<unknown>, n = 6): Promise<number> {
  let failed = 0
  let i = 0
  const worker = async () => {
    while (i < items.length) {
      const x = items[i++]
      try { await fn(x) } catch { failed++ }
    }
  }
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker))
  return failed
}

class BulkError extends Error {
  all: boolean
  constructor(failed: number, total: number) {
    super(failed === total ? `Couldn't change ${total === 1 ? 'the task' : 'the selected tasks'}.` : `${failed} of ${total} tasks couldn't be changed.`)
    this.all = failed === total
  }
}

export interface BulkVars {
  ids: string[]
  request: (id: string) => Promise<unknown>
  /** Optimistic change applied to each selected task in every cached list and detail. */
  patch?: (t: Task) => Task
  /** Optimistically remove the tasks from the list caches whose query params match. */
  drop?: (params: Record<string, unknown>) => boolean
  /** Success toast (omit for silent, e.g. when the change is already visible). */
  done?: string
  undo?: () => void
}

/** One mutation for N tasks: one optimistic cache pass, N requests (pooled), one refresh. */
export function useBulk() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (v: BulkVars) => {
      const failed = await pool(v.ids, v.request)
      if (failed) throw new BulkError(failed, v.ids.length)
    },
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: ['tasks'] })
      const set = new Set(v.ids)
      const snaps = qc.getQueriesData({ queryKey: ['tasks'] })
      for (const [key, data] of qc.getQueriesData<TaskPage>({ queryKey: ['tasks', 'list'] })) {
        if (!data) continue
        const params = (key[2] ?? {}) as Record<string, unknown>
        let items = data.items
        if (v.drop?.(params)) items = items.filter((t) => !set.has(t.id))
        else if (v.patch) items = items.map((t) => (set.has(t.id) ? v.patch!(t) : t))
        if (items !== data.items) qc.setQueryData<TaskPage>(key, { items, total: data.total - (data.items.length - items.length) })
      }
      if (v.patch) for (const id of v.ids) qc.setQueryData<TaskDetail>(keys.task(id), (old) => (old ? ({ ...old, ...v.patch!(old) } as TaskDetail) : old))
      return { rollback: () => snaps.forEach(([k, d]) => qc.setQueryData(k, d)) }
    },
    onSuccess: (_r, v) => { if (v.done) toast.show(v.done, v.undo ? { action: { label: 'Undo', run: v.undo } } : undefined) },
    onError: (e, _v, ctx) => {
      // All failed: put everything back. Partly failed: the refresh below shows what really changed.
      if (!(e instanceof BulkError) || e.all) ctx?.rollback()
      toast.error((e as Error).message)
    },
    onSettled: () => refreshTaskAreas(qc),
  })
}

const PRIO_LABEL: Record<number, string> = { 0: 'None', 5: 'Low', 10: 'Medium', 15: 'High', 20: 'Urgent' }
export const plural = (n: number, w = 'task') => `${n} ${w}${n === 1 ? '' : 's'}`

/** Ready-made bulk operations over task ids (used by the bulk bar and drag and drop). */
export function useBulkOps() {
  const bulk = useBulk()
  const update = (ids: string[], body: Partial<Task>, done?: string) =>
    bulk.mutate({ ids, request: (id) => patch<Task>(`tasks/${id}`, body), patch: (t) => ({ ...t, ...body }), done })
  const ops = {
    pending: bulk.isPending,
    update,
    setDue: (tasks: Task[], day: Date | null) => {
      // Keep each task's time of day unless it had none (23:59 = "that day").
      const each = new Map(tasks.map((t) => [t.id, dueOn(t.due, day)]))
      bulk.mutate({
        ids: tasks.map((t) => t.id),
        request: (id) => patch<Task>(`tasks/${id}`, { due: each.get(id) ?? null }),
        patch: (t) => ({ ...t, due: each.get(t.id) ?? null }),
      })
    },
    setPriority: (ids: string[], priority: number) => update(ids, { priority, priority_label: PRIO_LABEL[priority] ?? '' } as Partial<Task>),
    toggleLabel: (tasks: Task[], labelId: number) => {
      const all = tasks.every((t) => t.labels.includes(labelId))
      const next = new Map(tasks.map((t) => [t.id, all ? t.labels.filter((x) => x !== labelId) : [...new Set([...t.labels, labelId])]]))
      bulk.mutate({
        ids: tasks.map((t) => t.id),
        request: (id) => patch<Task>(`tasks/${id}`, { labels: next.get(id) }),
        patch: (t) => ({ ...t, labels: next.get(t.id) ?? t.labels }),
      })
    },
    setDone: (ids: string[], done: boolean) =>
      bulk.mutate({
        ids,
        request: (id) => post(`tasks/${id}/done`, undefined, { done }),
        patch: (t) => ({ ...t, done, done_at: done ? new Date().toISOString() : null }),
        done: done ? `Completed ${plural(ids.length)}` : undefined,
        undo: done ? () => ops.setDone(ids, false) : undefined,
      }),
    move: (ids: string[], project: Pick<Project, 'id' | 'name' | 'is_inbox'>) =>
      bulk.mutate({
        ids,
        request: (id) => post<Task>(`tasks/${id}/move`, { project_id: project.id }),
        patch: (t) => ({ ...t, project_id: project.id, bucket_id: null }),
        drop: (p) => typeof p.project === 'string' && p.project !== project.id,
        done: `Moved ${plural(ids.length)} to ${project.is_inbox ? 'Inbox' : project.name}`,
      }),
    remove: (ids: string[]) =>
      bulk.mutate({ ids, request: (id) => del(`tasks/${id}`), drop: () => true, done: `Deleted ${plural(ids.length)}` }),
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

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => {
    for (const ids of pending.values()) {
      for (const id of ids) {
        fetch(`${API_BASE}/tasks/${id}`, { method: 'DELETE', keepalive: true, credentials: 'same-origin', headers: { 'X-CSRFToken': readCookie('csrftoken') } }).catch(() => {})
      }
    }
    pending.clear()
  })
}

export function useDeleteWithUndo() {
  const qc = useQueryClient()
  return useCallback((tasks: Pick<Task, 'id' | 'title'>[]) => {
    if (!tasks.length) return
    const ids = tasks.map((t) => t.id)
    const gone = new Set(ids)
    // Loaded subtasks go with their parent (the server deletes them too).
    for (const [, data] of qc.getQueriesData<TaskPage>({ queryKey: ['tasks', 'list'] })) {
      for (const t of data?.items ?? []) if (t.parent_id && gone.has(t.parent_id)) gone.add(t.id)
    }
    setHidden(new Set([...hidden, ...gone]))
    const key = Symbol('delete')
    pending.set(key, ids)
    const unhide = () => setHidden(new Set([...hidden].filter((id) => !gone.has(id))))
    const timer = setTimeout(async () => {
      if (!pending.delete(key)) return
      const failed = await pool(ids, (id) => del(`tasks/${id}`).catch((e) => { if (!(e instanceof ApiError && e.status === 404)) throw e }))
      if (failed) toast.error(failed === ids.length ? "Couldn't delete. Nothing was deleted." : `${failed} of ${ids.length} tasks couldn't be deleted.`)
      for (const id of ids) qc.removeQueries({ queryKey: keys.task(id) })
      await Promise.all([['tasks', 'list'], ['tasks', 'overview'], ['calendar', 'agenda']].map((k) => qc.invalidateQueries({ queryKey: k })))
      unhide()
    }, 6000)
    toast.show(ids.length === 1 ? `Deleted "${tasks[0].title}"` : `Deleted ${plural(ids.length)}`, {
      action: { label: 'Undo', run: () => { clearTimeout(timer); pending.delete(key); unhide() } },
    })
  }, [qc])
}
