// /api/v2/contacts/ types and hooks (query keys under ['contacts']).
import { keepPreviousData, useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { api, ApiError, apiUrl, del, errorMessage, get, loginUrl, patch, post, readCookie } from '../../lib/api'
import { toast } from '../../components/toast'
import { queryGroup } from '../../lib/batch'

export interface LabeledValue { label: string; value: string }
export interface Address { label: string; street: string; city: string; region: string; postcode: string; country: string }
export interface ProfileLink { network: string; label: string; handle: string; url: string | null }
export interface Link { label: string; url: string }
export interface CustomField { key: string; value: string }
export interface PersonBrief {
  id: string; name: string; first_name: string; last_name: string; company: string; title: string; favorite: boolean
  email: string; phone: string; has_avatar: boolean; profile_links: ProfileLink[]; tags: string[]; groups: string[]
  birthday: string; last_contacted: string | null; keep_in_touch_days: number | null; next_due: string | null
  overdue: boolean; created_on: string
}
export interface Interaction { id: string; person_id: string; kind: string; date: string; summary: string; notes: string; created_on: string }
export interface Relationship { id: number; kind: string; other_id: string; other_name: string }
/** PersonOut: the full record without history (also what GET duplicates returns per side). */
export interface PersonFull extends PersonBrief {
  prefix: string; middle_name: string; suffix: string; nickname: string; display_name: string; department: string
  emails: LabeledValue[]; phones: LabeledValue[]; addresses: Address[]; profiles: Record<string, string>; links: Link[]
  custom_fields: CustomField[]; anniversary: string | null; how_met: string; notes: string
  sources: string[]; linked_user: { username: string; name: string } | null; updated_on: string
}
export interface PersonDetail extends PersonFull { interactions: Interaction[]; relationships: Relationship[] }
export interface PersonIn {
  prefix?: string; first_name?: string; middle_name?: string; last_name?: string; suffix?: string; nickname?: string
  display_name?: string; company?: string; title?: string; department?: string
  emails?: LabeledValue[]; phones?: LabeledValue[]; addresses?: Address[]; profiles?: Record<string, string>
  links?: Link[]; custom_fields?: CustomField[]; birthday?: string; anniversary?: string | null
  how_met?: string; notes?: string; tags?: string[]; groups?: string[]; favorite?: boolean
  keep_in_touch_days?: number | null; username?: string
}
export interface Tag { id: number; kind: 'tag' | 'group' | string; name: string; count?: number }
export interface ContactStats {
  total: number; favorites: number; overdue: number; keep_in_touch: number; recent: number; birthdays_this_month: number
  upcoming_birthdays?: { id: string; name: string; date: string; days: number; age: number | null }[]
  overdue_people?: { id: string; name: string; next_due: string; days_overdue: number }[]
  sources?: Record<string, number>
}
export interface Network { key: string; label: string; group: string; kind: 'url' | 'handle' | string }
export interface ContactMeta {
  networks: Network[]; relationship_kinds: string[]; interaction_kinds: string[]
  import_formats: Record<string, string>; import_fields: Record<string, string>; max_upload_bytes: number
}
export interface ImportOptions { format: string; mapping: Record<string, string> | null; mode: 'merge' | 'skip' }
export interface PreviewRow { name: string; detail: string; status: 'new' | 'update' | 'duplicate'; match: string }
export interface ImportPreview {
  format: string; format_label: string; total: number; new: number; updated: number; duplicates: number
  columns: string[]; mapping: Record<string, string>; fields: Record<string, string>; sample: PreviewRow[]
}
export interface ImportResult { format: string; total: number; created: number; updated: number; duplicates: number }
export interface DuplicatePair { a: PersonFull; b: PersonFull; reasons: string[] }
export type Filter = '' | 'favorites' | 'overdue' | 'kit' | 'recent' | 'birthdays'

export const AVATAR_MAX = 2_000_000
const onError = (e: unknown) => toast.error((e as Error).message)

/** Refresh contact queries after a write; meta never changes and the edited person was just set. */
function refresh(qc: QueryClient, keepPerson?: string) {
  return qc.invalidateQueries({
    queryKey: ['contacts'],
    predicate: (q) => q.queryKey[1] !== 'meta' && !(keepPerson && q.queryKey[1] === 'person' && q.queryKey[2] === keepPerson),
  })
}

/** Multipart POST (imports, photos). The shared JSON client only sends JSON bodies. */
async function upload<T>(path: string, fd: FormData): Promise<T> {
  let res: Response
  try {
    res = await fetch(apiUrl(path), { method: 'POST', body: fd, credentials: 'same-origin', headers: { 'X-CSRFToken': readCookie('csrftoken'), Accept: 'application/json' } })
  } catch {
    throw new ApiError(0, "Couldn't reach the server. Check your connection.")
  }
  if (res.status === 401) {
    window.location.assign(loginUrl())
    throw new ApiError(401, 'Signed out')
  }
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new ApiError(res.status, errorMessage(res.status, data))
  return data as T
}

// Cache-busting for photos: the avatar URL is cached for 5 minutes, so a fresh upload gets a new query string.
const avatarVersion = new Map<string, number>()
export const avatarSrc = (p: { id: string; has_avatar: boolean }) =>
  p.has_avatar ? `/api/v2/contacts/${p.id}/avatar${avatarVersion.has(p.id) ? `?v=${avatarVersion.get(p.id)}` : ''}` : null
export const exportHref = (format: 'vcf' | 'csv', ids?: string[]) =>
  apiUrl('contacts/export', { format, ids: ids?.length ? ids.join(',') : undefined })

export const usePeople = (params: { q?: string; filter?: Filter; tag?: string; group?: string; sort?: string }) =>
  useQuery({
    // `limit` is part of the key so the calendar's 8-result attendee search never fills this list.
    queryKey: ['contacts', 'list', { ...params, limit: 500 }],
    queryFn: ({ signal }) => get<{ items: PersonBrief[]; total: number }>('contacts/', { ...params, limit: 500 }, signal),
    placeholderData: keepPreviousData,
  })
/** Small name search (relationship picker); same key and size as the calendar's attendee search. */
export const usePeopleSearch = (q: string) =>
  useQuery({
    queryKey: ['contacts', 'list', { q, filter: undefined, tag: undefined, sort: 'name' }],
    queryFn: ({ signal }) => get<{ items: PersonBrief[] }>('contacts/', { q, sort: 'name', limit: 8 }, signal),
    enabled: q.length >= 2,
    staleTime: 60_000,
  })
export const usePerson = (id: string | null) =>
  useQuery({ queryKey: ['contacts', 'person', id], queryFn: () => get<PersonDetail>(`contacts/${id}`), enabled: !!id })
// Meta, tags and stats: fetched together (first load, or invalidating ['contacts']) they cost one
// GET /contacts/overview; refetched alone, each uses its own endpoint.
const side = queryGroup('contacts/overview', {
  meta: { key: ['contacts', 'meta'], path: 'contacts/meta' },
  tags: { key: ['contacts', 'tags'], path: 'contacts/tags' },
  stats: { key: ['contacts', 'stats'], path: 'contacts/stats' },
}, (all, k) => all[k])
export const useContactStats = () => useQuery({ queryKey: ['contacts', 'stats'], queryFn: side<ContactStats>('stats') })
export const useContactTags = () => useQuery({ queryKey: ['contacts', 'tags'], queryFn: side<Tag[]>('tags') })
export const useContactMeta = () =>
  useQuery({ queryKey: ['contacts', 'meta'], queryFn: side<ContactMeta>('meta'), staleTime: Infinity })
export const useDuplicates = () =>
  useQuery({ queryKey: ['contacts', 'duplicates'], queryFn: () => get<DuplicatePair[]>('contacts/duplicates') })

/** `toastErrors: false` when the caller shows the error itself (the edit form). */
export function useSavePerson(toastErrors = true) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id?: string; body: PersonIn }) => (id ? patch<PersonDetail>(`contacts/${id}`, body) : post<PersonDetail>('contacts/', body)),
    onSuccess: (p) => {
      qc.setQueryData(['contacts', 'person', p.id], p)
      refresh(qc, p.id)
    },
    onError: toastErrors ? onError : undefined,
  })
}

export function useDeletePerson() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => del(`contacts/${id}`),
    onSuccess: (_r, id) => {
      qc.removeQueries({ queryKey: ['contacts', 'person', id] })
      refresh(qc)
    },
    onError,
  })
}

export function useBulkDelete() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (ids: string[]) => post<void>('contacts/bulk-delete', { ids }),
    onSuccess: (_r, ids) => {
      for (const id of ids) qc.removeQueries({ queryKey: ['contacts', 'person', id] })
      refresh(qc)
    },
    onError,
  })
}

export function useAvatar(personId: string) {
  const qc = useQueryClient()
  const done = (p: PersonDetail) => {
    avatarVersion.set(p.id, Date.now())
    qc.setQueryData(['contacts', 'person', p.id], p)
    refresh(qc, p.id)
  }
  const set = useMutation({
    mutationFn: (file: File) => {
      const fd = new FormData()
      fd.append('file', file)
      return upload<PersonDetail>(`contacts/${personId}/avatar`, fd)
    },
    onSuccess: done,
    onError,
  })
  const remove = useMutation({ mutationFn: () => api<PersonDetail>(`contacts/${personId}/avatar`, { method: 'DELETE' }), onSuccess: done, onError })
  return { set, remove }
}

export function useLogInteraction(personId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { kind: string; summary: string; date?: string | null; notes?: string }) => post<Interaction>(`contacts/${personId}/interactions`, body),
    onSuccess: () => refresh(qc),
    onError,
  })
}

export function useUpdateInteraction() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: { kind?: string; summary?: string; date?: string; notes?: string } }) => patch<Interaction>(`contacts/interactions/${id}`, body),
    onSuccess: () => refresh(qc),
    onError,
  })
}

export function useDeleteInteraction() {
  const qc = useQueryClient()
  return useMutation({ mutationFn: (id: string) => del(`contacts/interactions/${id}`), onSuccess: () => refresh(qc), onError })
}

export function useRelationships(personId: string) {
  const qc = useQueryClient()
  const add = useMutation({
    mutationFn: (body: { other_id: string; kind: string }) => post<Relationship>(`contacts/${personId}/relationships`, body),
    onSuccess: () => refresh(qc),
    onError,
  })
  const remove = useMutation({ mutationFn: (id: number) => del(`contacts/relationships/${id}`), onSuccess: () => refresh(qc), onError })
  return { add, remove }
}

function importForm(file: File, o: ImportOptions): FormData {
  const fd = new FormData()
  fd.append('file', file)
  fd.append('format', o.format)
  fd.append('mode', o.mode)
  if (o.mapping) fd.append('mapping', JSON.stringify(o.mapping))
  return fd
}
export const importPreview = (file: File, o: ImportOptions) => upload<ImportPreview>('contacts/import/preview', importForm(file, o))

export function useImportCommit() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ file, opts }: { file: File; opts: ImportOptions }) => upload<ImportResult>('contacts/import/commit', importForm(file, opts)),
    onSuccess: () => refresh(qc),
    onError,
  })
}

export function useMerge() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { keep_id: string; other_id: string; fields: Record<string, 'keep' | 'other'> }) => post<PersonDetail>('contacts/merge', body),
    onSuccess: (p, v) => {
      qc.removeQueries({ queryKey: ['contacts', 'person', v.other_id] })
      qc.setQueryData(['contacts', 'person', p.id], p)
      refresh(qc, p.id)
    },
    onError,
  })
}

export function useDismissDuplicate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { a_id: string; b_id: string }) => post<void>('contacts/duplicates/dismiss', body),
    onSuccess: (_r, v) => qc.setQueryData<DuplicatePair[]>(['contacts', 'duplicates'], (old) =>
      old?.filter((d) => !((d.a.id === v.a_id && d.b.id === v.b_id) || (d.a.id === v.b_id && d.b.id === v.a_id)))),
    onError,
  })
}

// ---------------------------------------------------------------- tags & groups
export function useRenameTag() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, name }: { id: number; name: string }) => patch<Tag>(`contacts/tags/${id}`, { name }),
    onSuccess: () => refresh(qc), // contacts show tag names, so every list and open person refreshes
  })
}

export function useDeleteTag() {
  const qc = useQueryClient()
  return useMutation({ mutationFn: (id: number) => del(`contacts/tags/${id}`), onSuccess: () => refresh(qc), onError })
}

// ---------------------------------------------------------------- merge several into one
/** Merge each of `others` into `keep`, one after another (the server keeps `keep`'s value where both have one). */
export function useMergeMany() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ keep, others }: { keep: string; others: string[] }) => {
      let out: PersonDetail | null = null
      for (const other of others) out = await post<PersonDetail>('contacts/merge', { keep_id: keep, other_id: other, fields: {} })
      return out!
    },
    onSuccess: (p, v) => {
      for (const id of v.others) qc.removeQueries({ queryKey: ['contacts', 'person', id] })
      qc.setQueryData(['contacts', 'person', p.id], p)
      refresh(qc, p.id)
    },
    // Some merges may have gone through before the failure: refresh everything.
    onError: (e) => (refresh(qc), onError(e)),
  })
}

// ---------------------------------------------------------------- reminder settings
export interface ContactSettings { birthday_reminders: 'off' | 'day_before' | 'on_day'; keep_in_touch_reminders: boolean }
// Same key as Notifications › Reminders, so both screens share one cached copy.
const SETTINGS_KEY = ['settings', 'contacts/settings']
export const useContactSettings = (enabled = true) =>
  useQuery({ queryKey: SETTINGS_KEY, queryFn: () => get<ContactSettings>('contacts/settings'), enabled })
export function useSaveContactSettings() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: Partial<ContactSettings>) => patch<ContactSettings>('contacts/settings', body),
    onMutate: (body) => {
      const prev = qc.getQueryData<ContactSettings>(SETTINGS_KEY)
      if (prev) qc.setQueryData(SETTINGS_KEY, { ...prev, ...body })
      return { prev }
    },
    onError: (e, _b, ctx) => (ctx?.prev && qc.setQueryData(SETTINGS_KEY, ctx.prev), onError(e)),
    onSuccess: (s) => qc.setQueryData(SETTINGS_KEY, s),
  })
}
