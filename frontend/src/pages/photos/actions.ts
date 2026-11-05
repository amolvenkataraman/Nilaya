// Photos: shared queries and write actions (albums, libraries/Sources, hidden mode, ingest, originals).
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { ApiError, api, errorMessage, get, patch, post, readCookie } from '../../lib/api'
import type { Album, Library } from '../../lib/types'
import { toast } from '../../components/toast'

export type HiddenMode = { show: boolean; minutes: number }
export type AlbumMember = { id: number; username: string; name: string; role: 'editor' | 'viewer' }

export const useAlbums = () => useQuery({ queryKey: ['photos', 'albums'], queryFn: () => get<Album[]>('photos/albums'), staleTime: 5 * 60_000 })
export const useLibraries = () => useQuery({ queryKey: ['photos', 'libraries'], queryFn: () => get<Library[]>('photos/libraries'), staleTime: 10 * 60_000 })
export const useHiddenMode = () =>
  useQuery({ queryKey: ['photos', 'hidden-mode'], queryFn: () => get<HiddenMode>('photos/hidden-mode'), staleTime: 5 * 60_000 })

/** Can the user change files in this library (owner/editor)? Libraries are matched by name (details.library). */
export function canEditLibrary(libs: Library[] | undefined, name: string | undefined): boolean {
  if (!libs || !name) return false
  return libs.some((l) => l.name === name && (l.role === 'owner' || l.role === 'editor'))
}

// Keys whose data depends on which libraries are visible / whether hidden photos show.
const LISTING = new Set(['timeline', 'summary', 'stats', 'storage', 'browse', 'days', 'on-this-day', 'libraries', 'counts'])
/** Refetch everything that lists the library (timeline, totals, stats…), not albums or single photos. */
export function refreshListings(qc: QueryClient) {
  return qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'photos' && LISTING.has(String(q.queryKey[1])) })
}
/** Everything photo-related except the hidden-mode flag itself. */
export function refreshAll(qc: QueryClient) {
  return qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'photos' && q.queryKey[1] !== 'hidden-mode' })
}

// ---------------------------------------------------------------- hidden mode
export function useToggleHidden() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (show: boolean) => post<{ show: boolean }>('photos/hidden-mode', { show }),
    onSuccess: (r) => {
      qc.setQueryData<HiddenMode>(['photos', 'hidden-mode'], (old) => ({ minutes: old?.minutes ?? 30, show: r.show }))
      refreshAll(qc)
      toast.show(r.show ? 'Showing hidden photos (turns off after 30 minutes)' : 'Hidden photos are out of sight again')
    },
    onError: (e) => toast.error((e as Error).message || "Couldn't change hidden-photo mode."),
  })
}

// ---------------------------------------------------------------- libraries (Sources)
export function useLibraryVisibility() {
  const qc = useQueryClient()
  const done = () => refreshListings(qc)
  const setVisible = useMutation({
    mutationFn: ({ id, visible }: { id: number; visible: boolean }) => patch<{ id: number; visible: boolean }>(`photos/libraries/${id}`, { visible }),
    onSettled: done,
    onError: (e) => toast.error((e as Error).message),
  })
  const only = useMutation({
    mutationFn: (id: number) => post<{ id: number }>(`photos/libraries/${id}/only`),
    onMutate: (id) => {
      const before = qc.getQueryData<Library[]>(['photos', 'libraries'])
      qc.setQueryData<Library[]>(['photos', 'libraries'], (old) => old?.map((l) => ({ ...l, visible: l.id === id })))
      return { before }
    },
    onSuccess: (_r, id, ctx) => {
      const name = ctx?.before?.find((l) => l.id === id)?.name ?? 'this library'
      const restore = ctx?.before?.filter((l) => l.visible) ?? []
      toast.show(`Showing only ${name}`, restore.length ? {
        action: {
          label: 'Undo',
          run: () => Promise.all((ctx?.before ?? []).map((l) => patch(`photos/libraries/${l.id}`, { visible: l.visible }))).then(() => {
            qc.setQueryData(['photos', 'libraries'], ctx?.before)
            done()
          }, (e) => toast.error((e as Error).message)),
        },
      } : {})
    },
    onSettled: done,
    onError: (e) => toast.error((e as Error).message),
  })
  /** Optimistic: update the cached list before the request goes out. */
  const toggle = (id: number, visible: boolean) => {
    qc.setQueryData<Library[]>(['photos', 'libraries'], (old) => old?.map((l) => (l.id === id ? { ...l, visible } : l)))
    setVisible.mutate({ id, visible })
  }
  return { toggle, only }
}

// ---------------------------------------------------------------- ingest
export async function startIngest() {
  try {
    await post('photos/ingest')
    toast.show('Ingest started. New photos appear once it finishes.')
  } catch (e) {
    const err = e as ApiError
    toast.error(err.status === 403 ? "Ingest needs a library you own or edit. Ask the library's owner to run it." : err.message)
  }
}

// ---------------------------------------------------------------- originals
/**
 * POST /photos/{id}/delete-original. The endpoint reuses the classic view, which answers a viewer with
 * 401 (not 403): the shared client would treat that as "signed out" and redirect, so this call is raw.
 */
export async function deleteOriginal(id: string): Promise<{ freed_kb: number; size: number; size_total: number }> {
  const res = await fetch(`/api/v2/photos/${encodeURIComponent(id)}/delete-original`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { Accept: 'application/json', 'X-CSRFToken': readCookie('csrftoken') },
  })
  let data: unknown = null
  try { data = await res.json() } catch { /* empty */ }
  if (res.status === 401 || res.status === 403) throw new ApiError(403, 'Only owners and editors of this library can delete originals.')
  if (!res.ok) {
    const d = (data as { data?: unknown } | null)?.data
    throw new ApiError(res.status, typeof d === 'string' && d ? d : errorMessage(res.status, data))
  }
  return data as { freed_kb: number; size: number; size_total: number }
}

// ---------------------------------------------------------------- albums
export function useAlbumMutations() {
  const qc = useQueryClient()
  const refreshAlbums = () => qc.invalidateQueries({ queryKey: ['photos', 'albums'] })
  const create = useMutation({
    mutationFn: (body: { name: string; description: string; public: boolean }) => post<Album>('photos/albums', body),
    onSuccess: (a) => {
      qc.setQueryData<Album[]>(['photos', 'albums'], (old) => (old ? [...old, a].sort((x, y) => x.name.localeCompare(y.name)) : old))
      refreshAlbums()
    },
  })
  const update = useMutation({
    mutationFn: ({ id, ...body }: { id: string; name?: string; description?: string; public?: boolean; cover_photo_id?: string }) => patch<Album>(`photos/albums/${id}`, body),
    onSuccess: (a) => {
      qc.setQueryData<Album[]>(['photos', 'albums'], (old) => old?.map((x) => (x.id === a.id ? { ...x, ...a } : x)))
      refreshAlbums()
    },
  })
  return { create, update }
}

/** Delete an album (owner; the photos stay). Not tied to a component: the album page has already been left. */
export async function deleteAlbum(qc: QueryClient, album: Album) {
  await api<void>(`photos/albums/${album.id}`, { method: 'DELETE' })
  qc.setQueryData<Album[]>(['photos', 'albums'], (old) => old?.filter((x) => x.id !== album.id))
  qc.removeQueries({ queryKey: ['photos', 'album', album.id] })
  qc.invalidateQueries({ queryKey: ['photos', 'albums'] })
}

/** Remove photos from an album (owner/editor); with Undo. */
export async function removeFromAlbum(qc: QueryClient, album: Album, ids: string[]) {
  try {
    const r = await api<{ removed: number }>(`photos/albums/${album.id}/photos`, { method: 'DELETE', body: { ids } })
    const refresh = () => (qc.invalidateQueries({ queryKey: ['photos', 'album', album.id] }), qc.invalidateQueries({ queryKey: ['photos', 'albums'] }))
    refresh()
    toast.show(`Removed ${r.removed} from "${album.name}"`, r.removed ? {
      action: { label: 'Undo', run: () => post(`photos/albums/${album.id}/photos`, { ids }).then(refresh, (e) => toast.error((e as Error).message)) },
    } : {})
    return true
  } catch (e) {
    const err = e as ApiError
    toast.error(err.status === 404 ? 'You can only remove photos from albums you own or edit.' : err.message)
    return false
  }
}

export async function setAlbumCover(qc: QueryClient, album: Album, photoId: string) {
  try {
    const a = await patch<Album>(`photos/albums/${album.id}`, { cover_photo_id: photoId })
    qc.setQueryData<Album[]>(['photos', 'albums'], (old) => old?.map((x) => (x.id === a.id ? { ...x, ...a } : x)))
    toast.show(`Cover set for "${album.name}"`)
  } catch (e) {
    toast.error((e as Error).message)
  }
}

/** Absolute link(s) to photos, for the clipboard. */
export function copyLinks(urls: (string | null)[]) {
  const links = urls.filter(Boolean).map((u) => new URL(u!, location.origin).href)
  if (!links.length) return
  navigator.clipboard?.writeText(links.join('\n')).then(
    () => toast.show(links.length === 1 ? 'Link copied' : `Copied ${links.length} links`),
    () => toast.error("Couldn't copy the link"),
  )
}
