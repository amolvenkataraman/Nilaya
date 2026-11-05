// React Query hooks for the V2 API. Query keys are hierarchical so one invalidate refreshes an area.
import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { del, get, patch, post } from './api'
import type {
  AgendaItem, Calendar, CalEvent, Category, Comment, Count, DoneOut, Inbox, Insights, Label, Me, MePatch, Overview,
  Project, SavedView, Task, TaskDetail, TaskIn, TaskPage, TaskPatch, Bucket, Notification,
} from './types'
import { toast } from '../components/toast'
import { isPages, patchTaskLists, settleTaskLists, type TaskList } from './taskLists'

// Dashboard queries, shared with lib/prefetch.ts so the prefetch hits exactly the same cache keys.
export const DASH_TODAY_PARAMS = { view: 'today', sort: 'due', limit: 100 } as const
export const DASH_AGENDA_DAYS = 7
export const DASH_INBOX_LIMIT = 5

export const keys = {
  me: ['me'] as const,
  notifCount: ['notifications', 'count'] as const,
  inbox: (unreadOnly = false) => ['notifications', 'inbox', unreadOnly] as const,
  overview: ['tasks', 'overview'] as const,
  projects: ['tasks', 'projects'] as const,
  labels: ['tasks', 'labels'] as const,
  views: ['tasks', 'views'] as const,
  taskList: (params: Record<string, unknown>) => ['tasks', 'list', params] as const,
  /** An infinite (paged) list; key[2] is still the params, so list helpers treat both alike. */
  taskPages: (params: Record<string, unknown>) => ['tasks', 'list', params, 'pages'] as const,
  board: (projectId: string, q: string) => ['tasks', 'board', projectId, q] as const,
  task: (id: string) => ['tasks', 'detail', id] as const,
  comments: (id: string) => ['tasks', 'comments', id] as const,
  buckets: (projectId: string) => ['tasks', 'buckets', projectId] as const,
  calendars: ['calendar', 'calendars'] as const,
  categories: ['calendar', 'categories'] as const,
  events: (start: string, end: string) => ['calendar', 'events', start, end] as const,
  agenda: (days: number) => ['calendar', 'agenda', days] as const,
  insights: (period: string, date: string) => ['calendar', 'insights', period, date] as const,
}

// ---------------------------------------------------------------- me / notifications
export const useMe = () => useQuery({ queryKey: keys.me, queryFn: () => get<Me>('me'), staleTime: 60 * 60_000 })
export function useUpdateMe() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: MePatch) => patch<Me>('me', body),
    onSuccess: (me) => qc.setQueryData(keys.me, me),
  })
}

export const useUnreadCount = () =>
  // The only poll in the app: 60 s, paused while the tab is hidden (refetchIntervalInBackground: false).
  useQuery({ queryKey: keys.notifCount, queryFn: () => get<Count>('notifications/unread-count'), staleTime: 30_000, refetchInterval: 60_000, refetchIntervalInBackground: false })

export const useInbox = (unreadOnly = false, limit = 30) =>
  useQuery({ queryKey: [...keys.inbox(unreadOnly), limit], queryFn: () => get<Inbox>('notifications/', { unread_only: unreadOnly || undefined, limit }) })

export function useMarkRead() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, read = true }: { id: string; read?: boolean }) => post<Notification>(`notifications/${id}/read`, undefined, { read }),
    onMutate: async ({ id, read = true }) => {
      await qc.cancelQueries({ queryKey: ['notifications'] })
      qc.setQueriesData<Inbox>({ queryKey: ['notifications', 'inbox'] }, (old) => {
        if (!old) return old
        const was = old.items.find((n) => n.id === id)
        const delta = was && was.read !== read ? (read ? -1 : 1) : 0
        return { unread: Math.max(0, old.unread + delta), items: old.items.map((n) => (n.id === id ? { ...n, read } : n)) }
      })
      qc.setQueryData<Count>(keys.notifCount, (old) => (old ? { unread: Math.max(0, old.unread + (read ? -1 : 1)) } : old))
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  })
}

export function useReadAll() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => post<Count>('notifications/read-all'),
    onMutate: () => {
      qc.setQueriesData<Inbox>({ queryKey: ['notifications', 'inbox'] }, (old) =>
        old ? { unread: 0, items: old.items.map((n) => ({ ...n, read: true })) } : old,
      )
      qc.setQueryData<Count>(keys.notifCount, { unread: 0 })
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  })
}

// ---------------------------------------------------------------- tasks
// One request for the Tasks sidebar: counts + projects + labels + saved views
// (GET /tasks/overview?include=…). It seeds the projects/labels/views caches, and those hooks read
// through it, so concurrent mounts share a single request.
type OverviewFull = Overview & { projects: Project[]; labels: Label[]; views: SavedView[] }
export async function fetchOverview(qc: QueryClient): Promise<OverviewFull> {
  const o = await get<OverviewFull>('tasks/overview', { include: 'projects,labels,views' })
  if (o.projects) qc.setQueryData(keys.projects, o.projects)
  if (o.labels) qc.setQueryData(keys.labels, o.labels)
  if (o.views) qc.setQueryData(keys.views, o.views)
  return o
}
const viaOverview = <T,>(qc: QueryClient, pick: (o: OverviewFull) => T) => () =>
  qc.fetchQuery({ queryKey: keys.overview, queryFn: () => fetchOverview(qc), staleTime: 5_000 }).then(pick)

export const useOverview = () => {
  const qc = useQueryClient()
  return useQuery({ queryKey: keys.overview, queryFn: () => fetchOverview(qc) })
}
export const useProjects = (includeArchived = false) => {
  const qc = useQueryClient()
  return useQuery({
    queryKey: includeArchived ? [...keys.projects, 'archived'] : keys.projects,
    queryFn: includeArchived
      ? () => get<OverviewFull>('tasks/overview', { include: 'projects,archived' }).then((o) => o.projects)
      : viaOverview(qc, (o) => o.projects),
    staleTime: 5 * 60_000,
  })
}
export const useLabels = () => {
  const qc = useQueryClient()
  return useQuery({ queryKey: keys.labels, queryFn: viaOverview(qc, (o) => o.labels), staleTime: 5 * 60_000 })
}
export const useSavedViews = () => {
  const qc = useQueryClient()
  return useQuery({ queryKey: keys.views, queryFn: viaOverview(qc, (o) => o.views), staleTime: 5 * 60_000 })
}
export const useBuckets = (projectId: string | null) =>
  useQuery({ queryKey: keys.buckets(projectId ?? ''), queryFn: () => get<Bucket[]>(`tasks/projects/${projectId}/buckets`), enabled: !!projectId })

export type TaskQuery = Record<string, string | number | boolean | undefined>
export const useTasks = (params: TaskQuery, enabled = true) =>
  useQuery({
    queryKey: keys.taskList(params),
    queryFn: ({ signal }) => get<TaskPage>('tasks/', params, signal),
    enabled,
    placeholderData: keepPreviousData,
  })
/** A long list, a page at a time (keyset cursors): the first page counts the total, later ones don't. */
export const useTaskPages = (params: TaskQuery, enabled = true) =>
  useInfiniteQuery({
    queryKey: keys.taskPages(params),
    queryFn: ({ signal, pageParam }) => get<TaskPage>('tasks/', pageParam ? { ...params, cursor: pageParam, count: false } : params, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next ?? undefined,
    enabled,
    placeholderData: keepPreviousData,
  })
export const useTask = (id: string | null) =>
  useQuery({ queryKey: keys.task(id ?? ''), queryFn: () => get<TaskDetail>(`tasks/${id}`), enabled: !!id })
export const useComments = (id: string | null) =>
  useQuery({ queryKey: keys.comments(id ?? ''), queryFn: () => get<Comment[]>(`tasks/${id}/comments`), enabled: !!id })

/** Apply `fn` to a task wherever it is cached (lists and detail), in place. Returns a rollback. */
export const patchTaskCaches = (qc: QueryClient, id: string, fn: (t: Task) => Task): (() => void) => patchTaskLists(qc, [id], fn)

/** After a task change: counts (sidebar, board columns) and the dashboard agenda. Lists are settled in
 *  place (lib/taskLists.ts), so loaded pages aren't refetched. */
export const refreshTaskCounts = (qc: QueryClient) => {
  // Overview refetches projects too (seeded into their cache), so projects needn't be invalidated separately.
  for (const k of [['tasks', 'overview'], ['tasks', 'board'], ['calendar', 'agenda']]) qc.invalidateQueries({ queryKey: k })
}

/** A subtask changed: its parent's "2/5" in every cached list. */
export function bumpParent(qc: QueryClient, parentId: string | null | undefined, d: { subtasks?: number; done?: number }) {
  if (!parentId) return
  patchTaskLists(qc, [parentId], (t) => ({ ...t, subtasks: Math.max(0, (t.subtasks ?? 0) + (d.subtasks ?? 0)), subtasks_done: Math.max(0, (t.subtasks_done ?? 0) + (d.done ?? 0)) }))
}

export function useSetDone() {
  const qc = useQueryClient()
  const m = useMutation({
    mutationFn: ({ task, done }: { task: Task; done: boolean }) => post<DoneOut>(`tasks/${task.id}/done`, undefined, { done }),
    onMutate: async ({ task, done }) => {
      await qc.cancelQueries({ queryKey: ['tasks'] })
      return { rollback: patchTaskCaches(qc, task.id, (t) => ({ ...t, done, done_at: done ? new Date().toISOString() : null })) }
    },
    onError: (e, _v, ctx) => {
      ctx?.rollback()
      toast.error((e as Error).message)
    },
    onSuccess: (res, { task, done }) => {
      // Let the check animation play, then move it out of open lists (and into done ones).
      setTimeout(() => settleTaskLists(qc, { tasks: [res.task] }), 350)
      if (res.task.done !== task.done) bumpParent(qc, task.parent_id, { done: res.task.done ? 1 : -1 })
      if (!done) return
      toast.show(res.repeated ? `"${task.title}" moved to its next date` : `Completed "${task.title}"`, {
        action: { label: 'Undo', run: () => m.mutate({ task: res.task, done: false }) },
      })
    },
    onSettled: () => refreshTaskCounts(qc),
  })
  return m
}

export function useUpdateTask() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: TaskPatch }) => patch<Task>(`tasks/${id}`, body),
    onMutate: async ({ id, body }) => {
      await qc.cancelQueries({ queryKey: ['tasks'] })
      return { rollback: patchTaskCaches(qc, id, (t) => ({ ...t, ...body }) as Task) }
    },
    onError: (e, _v, ctx) => {
      ctx?.rollback()
      toast.error((e as Error).message)
    },
    onSuccess: (task) => { settleTaskLists(qc, { tasks: [task] }) },
    onSettled: () => refreshTaskCounts(qc),
  })
}

export type MoveVars = { id: string; project_id?: string | null; bucket_id?: number | null; position?: number | null; after?: string; before?: string }
export function useMoveTask() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: MoveVars & { optimistic?: Task }) => {
      delete body.optimistic
      return post<Task>(`tasks/${id}/move`, body)
    },
    onMutate: async ({ id, optimistic, after: _a, before: _b, ...body }) => {
      await qc.cancelQueries({ queryKey: ['tasks'] })
      // A board drop passes the task as it will be (new column and position): it moves between the
      // column lists at once. Otherwise patch it where it is.
      if (optimistic) return { rollback: settleTaskLists(qc, { tasks: [optimistic], keep: [id] }) }
      const clean = Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined))
      return { rollback: patchTaskCaches(qc, id, (t) => ({ ...t, ...clean }) as Task) }
    },
    onError: (e, _v, ctx) => {
      ctx?.rollback()
      toast.error((e as Error).message)
    },
    onSuccess: (task, v) => { settleTaskLists(qc, { tasks: [task], keep: v.optimistic ? [task.id] : [] }) },
    onSettled: () => refreshTaskCounts(qc),
  })
}

let tempId = 0
/** Create a task (structured or quick/natural-language), showing it immediately in the list it was added to. */
export function useCreateTask() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (v: { quick?: string; body?: TaskIn; optimistic?: Partial<Task>; listKey?: readonly unknown[] }) =>
      v.quick !== undefined
        ? post<Task>('tasks/quick', { text: v.quick, project_id: v.body?.project_id ?? null, parent_id: v.body?.parent_id ?? null, bucket_id: v.body?.bucket_id ?? null })
        : post<Task>('tasks/', v.body),
    onMutate: async (v) => {
      if (!v.listKey || !v.optimistic) return {}
      await qc.cancelQueries({ queryKey: v.listKey })
      const now = new Date().toISOString()
      const temp = {
        id: `temp-${++tempId}`, title: '', description: '', done: false, done_at: null, due: null, start: null, priority: 10,
        priority_label: 'Medium', project_id: null, bucket_id: null, position: 1e9, parent_id: null, labels: [], assignees: [],
        percent: 0, time_spent: 0, repeat_mode: 0, repeat_every: null, favorite: false, colour: '', reminders: [], event_id: null,
        owner: { id: '', username: '', name: '' }, created_on: now, updated_on: now, ...v.optimistic,
      } as Task
      const prev = qc.getQueryData<TaskList>(v.listKey)
      if (prev) qc.setQueryData<TaskList>(v.listKey, appendTask(prev, temp))
      return { listKey: v.listKey, prev, temp }
    },
    onError: (e, _v, ctx) => {
      if (ctx?.listKey) qc.setQueryData(ctx.listKey, ctx.prev)
      toast.error((e as Error).message)
    },
    onSuccess: (task, _v, ctx) => {
      if (ctx?.listKey && ctx.temp) {
        const swap = (items: Task[]) => items.map((t) => (t.id === ctx.temp!.id ? task : t))
        qc.setQueryData<TaskList>(ctx.listKey, (old) => (!old ? old : isPages(old) ? { ...old, pages: old.pages.map((p) => ({ ...p, items: swap(p.items) })) } : { ...old, items: swap(old.items) }))
      }
      settleTaskLists(qc, { tasks: [task] })
      bumpParent(qc, task.parent_id, { subtasks: 1 })
    },
    onSettled: () => refreshTaskCounts(qc),
  })
}

/** The new task at the end of what's loaded (it's where the user is looking; the settle re-sorts it). */
function appendTask(d: TaskList, t: Task): TaskList {
  if (!isPages(d)) return { ...d, items: [...d.items, t], total: d.total == null ? d.total : d.total + 1 }
  const pages = d.pages.map((p, i) => ({ ...p, total: i === 0 && p.total != null ? p.total + 1 : p.total }))
  pages[pages.length - 1] = { ...pages[pages.length - 1], items: [...pages[pages.length - 1].items, t] }
  return { ...d, pages }
}

export function useDeleteTask() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => del(`tasks/${id}`),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ['tasks'] })
      return { rollback: settleTaskLists(qc, { gone: [id] }) }
    },
    onError: (e, _v, ctx) => {
      ctx?.rollback()
      toast.error((e as Error).message)
    },
    onSettled: () => refreshTaskCounts(qc),
  })
}

// ---------------------------------------------------------------- calendar
export const useCalendars = (includeInactive = false) =>
  useQuery({
    queryKey: includeInactive ? [...keys.calendars, 'all'] : keys.calendars,
    queryFn: () => get<Calendar[]>('calendar/calendars', { include_inactive: includeInactive || undefined }),
    staleTime: 5 * 60_000,
  })
export const useCategories = () =>
  useQuery({ queryKey: keys.categories, queryFn: () => get<Category[]>('calendar/categories'), staleTime: Infinity })
export const useEvents = (start: string, end: string) =>
  useQuery({
    queryKey: keys.events(start, end),
    queryFn: ({ signal }) => get<CalEvent[]>('calendar/events', { start, end }, signal),
    placeholderData: keepPreviousData,
    staleTime: 2 * 60_000,
  })
export const useAgenda = (days: number, includeOverdue = false) =>
  useQuery({
    queryKey: [...keys.agenda(days), includeOverdue],
    queryFn: () => get<AgendaItem[]>('calendar/agenda', { days, include_overdue: includeOverdue || undefined }),
    staleTime: 60_000, // today's agenda: fresher than the 2 min default
  })
export const useInsights = (period: 'week' | 'month', date: string) =>
  useQuery({
    queryKey: keys.insights(period, date),
    queryFn: () => get<Insights>('calendar/insights', { period, date: date || undefined }),
    placeholderData: keepPreviousData,
  })
