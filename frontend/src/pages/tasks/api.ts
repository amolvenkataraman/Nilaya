// Tasks-page mutations not shared with other pages: projects, buckets, comments, saved views.
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { del, patch, post } from '../../lib/api'
import { keys, patchTaskCaches } from '../../lib/queries'
import { toast } from '../../components/toast'
import type { Bucket, Comment, Project, SavedView } from '../../lib/types'

const onError = (e: unknown) => toast.error((e as Error).message)

export function useSaveProject() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id?: string; body: Partial<Project> }) =>
      id ? patch<Project>(`tasks/projects/${id}`, body) : post<Project>('tasks/projects', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.projects }),
    onError,
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

export function useSaveView() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { name: string; filters: Record<string, unknown> }) => post<SavedView>('tasks/views', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.views }),
    onError,
  })
}

export function useDeleteView() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => del(`tasks/views/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.views }),
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
