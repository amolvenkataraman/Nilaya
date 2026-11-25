// Tasks-page queries and mutations not shared with other pages: projects, board columns, comments, saved
// views, labels, members and relations, plus the query keys and factories this app adds to lib/queries'
// `keys`. Bulk actions are in bulk.ts, delete-with-undo in deleteUndo.ts.
import { queryOptions, useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { ApiError, del, get, patch, post } from '../../lib/api'
import { keys } from '../../lib/queries'
import { cachedTask, patchTaskLists, settleTaskLists } from '../../lib/taskLists'
import type { Bucket, Comment, Label, Member, Project, Relation, SavedView, Schemas, Task, TaskDetail, TaskPage } from '../../lib/types'

// ---------------------------------------------------------------- keys and query factories
/** Keys this app uses beyond lib/queries' `keys` (prefixes of those, for invalidating an area). */
export const taskKeys = {
  all: ['tasks'] as const,
  lists: ['tasks', 'list'] as const,
  /** Every board query of a project (whatever its search). */
  boardOf: (projectId: string) => ['tasks', 'board', projectId] as const,
  members: (projectId: string) => ['tasks', 'members', projectId] as const,
}

export const membersQuery = (projectId: string | null) =>
  queryOptions({
    queryKey: taskKeys.members(projectId ?? ''),
    queryFn: ({ signal }) => get<Member[]>(`tasks/projects/${projectId}/members`, undefined, signal),
    enabled: !!projectId,
  })
export const useMembers = (projectId: string | null) => useQuery(membersQuery(projectId))

export const BOARD_PAGE = 50
/** One board column's paged list (the board request seeds its first page). */
export const columnParams = (projectId: string, bucketId: number, q: string) => ({
  project: projectId,
  bucket: bucketId,
  top_level: true,
  sort: 'position',
  limit: BOARD_PAGE,
  q: q || undefined,
})

/** A board column as cached: its first page of cards moves into the column's own task list. */
export type BoardColumn = Omit<Schemas['BoardColumn'], 'items' | 'next'>
export type BoardOut = { columns: BoardColumn[] }

/** A board's columns and counts in one request (GET projects/{id}/board), its cards seeded into one paged
 *  list per column. Refetches (after a change) skip the cards when every column's list is cached. */
export const boardQuery = (qc: QueryClient, projectId: string, q: string) =>
  queryOptions({
    queryKey: keys.board(projectId, q),
    queryFn: async ({ signal }): Promise<BoardOut> => {
      const prev = qc.getQueryData<BoardOut>(keys.board(projectId, q))
      const cached = !!prev?.columns.length && prev.columns.every((c) => qc.getQueryData(keys.taskPages(columnParams(projectId, c.id, q))))
      const r = await get<Schemas['BoardOut']>(
        `tasks/projects/${projectId}/board`,
        { q: q || undefined, per: BOARD_PAGE, items: cached ? false : undefined },
        signal,
      )
      for (const c of r.columns) {
        const k = keys.taskPages(columnParams(projectId, c.id, q))
        if (c.items && !qc.getQueryData(k))
          qc.setQueryData(k, { pages: [{ items: c.items, total: c.total, next: c.next ?? null } satisfies TaskPage], pageParams: [null] })
      }
      return { columns: r.columns.map(({ items: _i, next: _n, ...c }) => c) }
    },
  })

// ---------------------------------------------------------------- projects and board columns
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
      return {
        rollback: () => {
          for (const [k, d] of snaps) qc.setQueryData(k, d)
        },
      }
    },
    onSuccess: (p) => {
      // The response has no open count: keep the one we have. Counts and the archived list refresh from the overview.
      setProjects(qc, (list) =>
        list.some((x) => x.id === p.id)
          ? list.map((x) => (x.id === p.id ? { ...x, ...p, open_count: x.open_count, done_count: x.done_count } : x))
          : [...list, p],
      )
      qc.invalidateQueries({ queryKey: keys.overview })
      qc.invalidateQueries({ queryKey: [...keys.projects, 'archived'] })
    },
    onError: (_e, _v, ctx) => ctx?.rollback(),
  })
}

export function useDeleteProject() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => del(`tasks/projects/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: taskKeys.all }),
  })
}

export function useSaveBucket(projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id?: number; body: Partial<Bucket> }) =>
      id ? patch<Bucket>(`tasks/buckets/${id}`, body) : post<Bucket>(`tasks/projects/${projectId}/buckets`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.buckets(projectId) })
      qc.invalidateQueries({ queryKey: taskKeys.boardOf(projectId) })
    },
  })
}

export function useDeleteBucket() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => del(`tasks/buckets/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: taskKeys.all }),
  })
}

// ---------------------------------------------------------------- tasks
/** Take myself off a task's assignees (allowed even when the task is view-only for me). */
export function useUnassignMe(taskId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => post<void>(`tasks/${taskId}/unassign`),
    onSuccess: () => qc.invalidateQueries({ queryKey: taskKeys.all }),
  })
}

export function useDuplicateTask() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => post<{ id: string; title: string }>(`tasks/${id}/duplicate`),
    onSuccess: () => qc.invalidateQueries({ queryKey: taskKeys.all }),
  })
}

/** Put tasks (in this order) right after one task, or before another, in a project's manual order. The
 *  server picks positions between the neighbours, so it works when only part of the list is loaded. */
export function usePlaceTasks(projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (v: { ids: string[]; after?: string; before?: string; positions: number[] }) =>
      post<{ positions: Record<string, number>; renumbered: boolean }>(`tasks/projects/${projectId}/place`, {
        ids: v.ids,
        after: v.after,
        before: v.before,
      }),
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: taskKeys.lists })
      const tasks = v.ids
        .map((id, i) => {
          const t = cachedTask(qc, id)
          return t && { ...t, position: v.positions[i] }
        })
        .filter((t): t is Task => !!t)
      return { rollback: settleTaskLists(qc, { tasks, keep: v.ids }) }
    },
    onSuccess: (r, v) => {
      if (r.renumbered) return qc.invalidateQueries({ queryKey: taskKeys.lists }) // other tasks moved too (rare)
      const tasks = Object.entries(r.positions)
        .map(([id, position]) => {
          const t = cachedTask(qc, id)
          return t && { ...t, position }
        })
        .filter((t): t is Task => !!t)
      settleTaskLists(qc, { tasks, keep: v.ids })
    },
    onError: (_e, _v, ctx) => ctx?.rollback(),
  })
}

// ---------------------------------------------------------------- comments
export function useAddComment(taskId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: string) => post<Comment>(`tasks/${taskId}/comments`, { body }),
    onSuccess: (c) => {
      qc.setQueryData<Comment[]>(keys.comments(taskId), (old) => [...(old ?? []), c])
      patchTaskLists(qc, [taskId], (t) => ({ ...t, comments: (t.comments ?? 0) + 1 }))
    },
  })
}

export function useDeleteComment(taskId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => del(`tasks/comments/${id}`),
    onMutate: (id) => qc.setQueryData<Comment[]>(keys.comments(taskId), (old) => old?.filter((c) => c.id !== id)),
    onSettled: () => qc.invalidateQueries({ queryKey: keys.comments(taskId) }),
  })
}

export function useEditComment(taskId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: string }) => patch<Comment>(`tasks/comments/${id}`, { body }),
    onSuccess: (c) => qc.setQueryData<Comment[]>(keys.comments(taskId), (old) => old?.map((x) => (x.id === c.id ? c : x))),
  })
}

// ---------------------------------------------------------------- saved views
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
  })
}

export function useDeleteView() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => del(`tasks/views/${id}`),
    onSuccess: (_r, id) => setViews(qc, (list) => list.filter((x) => x.id !== id)),
  })
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
  })
}

export function useDeleteLabel() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => del(`tasks/labels/${id}`),
    onSuccess: (_r, id) => {
      setLabels(qc, (list) => list.filter((x) => x.id !== id))
      qc.invalidateQueries({ queryKey: taskKeys.lists }) // tasks lose the label
    },
  })
}

// ---------------------------------------------------------------- project members
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
      qc.setQueryData<Member[]>(taskKeys.members(projectId), (old) =>
        old?.some((x) => x.id === m.id) ? old.map((x) => (x.id === m.id ? m : x)) : [...(old ?? []), m],
      )
      refreshShared(qc)
    },
    meta: {
      errorMessage: (e, v) =>
        e instanceof ApiError && e.status === 404 ? `No user called "${(v as { username: string }).username}".` : (e as Error).message,
    },
  })
}

export function useRemoveMember(projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => del(`tasks/projects/${projectId}/members/${id}`),
    onSuccess: (_r, id) => {
      qc.setQueryData<Member[]>(taskKeys.members(projectId), (old) => old?.filter((x) => x.id !== id))
      refreshShared(qc)
    },
  })
}

// ---------------------------------------------------------------- relations
export const RELATION_KINDS = [
  ['related', 'Related to'],
  ['blocks', 'Blocks'],
  ['blocked_by', 'Blocked by'],
  ['precedes', 'Precedes'],
  ['follows', 'Follows'],
  ['duplicate_of', 'Duplicate of'],
  ['duplicated_by', 'Duplicated by'],
] as const
export type RelationKind = (typeof RELATION_KINDS)[number][0]

export function useAddRelation(taskId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { other_id: string; kind: RelationKind }) => post<Relation>(`tasks/${taskId}/relations`, body),
    onSuccess: (r) => {
      qc.setQueryData<TaskDetail>(keys.task(taskId), (old) =>
        old ? { ...old, relations: [...old.relations.filter((x) => x.id !== r.id), r] } : old,
      )
      qc.invalidateQueries({ queryKey: keys.task(r.other_id) }) // the reverse link (only refetches if open)
    },
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
    onError: (_e, _r, ctx) => ctx?.prev && qc.setQueryData(keys.task(taskId), ctx.prev),
    onSettled: (_d, _e, r) => qc.invalidateQueries({ queryKey: keys.task(r.other_id) }),
  })
}
