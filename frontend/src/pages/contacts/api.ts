// /api/v2/contacts/ types (aliases of the generated schemas where the server types them), queries and mutations
// (query keys under ['contacts']).
import { keepPreviousData, queryOptions, useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { api, apiUrl, del, get, patch, post, upload } from '../../lib/api'
import { queryGroup } from '../../lib/batch'
import type { Schemas } from '../../lib/types'

export type LabeledValue = Schemas['LabeledValue-Output']
export type Address = Schemas['Address-Output']
export type ProfileLink = Schemas['ProfileLink']
export type Link = Schemas['Link-Output']
export type CustomField = Schemas['CustomField-Output']
export type PersonBrief = Schemas['PersonBrief']
export type Interaction = Schemas['InteractionOut']
export type Relationship = Schemas['RelationshipOut']
/** The full record without history (also what GET duplicates returns per side). */
export type PersonFull = Schemas['ContactsPersonOut']
export type PersonDetail = Schemas['PersonDetail']
export type PersonIn = Schemas['PersonIn']
export type Tag = Schemas['TagOut']
export type ContactStats = Schemas['ContactsStatsOut']
// GET /contacts/meta: untyped on the server.
export interface Network {
  key: string
  label: string
  group: string
  kind: 'url' | 'handle' | string
}
export interface ContactMeta {
  networks: Network[]
  relationship_kinds: string[]
  interaction_kinds: string[]
  import_formats: Record<string, string>
  import_fields: Record<string, string>
  max_upload_bytes: number
}
export interface ImportOptions {
  format: string
  mapping: Record<string, string> | null
  mode: 'merge' | 'skip'
}
export type PreviewRow = Schemas['PreviewRow']
export type ImportPreview = Schemas['PreviewOut']
export type ImportResult = Schemas['CommitOut']
export type DuplicatePair = Schemas['DuplicateOut']
export type Filter = '' | 'favorites' | 'overdue' | 'kit' | 'recent' | 'birthdays'

export const AVATAR_MAX = 2_000_000

export const contactKeys = {
  all: ['contacts'] as const,
  /** The calendar's attendee search uses the same shape, so a name search is cached once for both. */
  list: (params: Record<string, unknown>) => ['contacts', 'list', params] as const,
  person: (id: string) => ['contacts', 'person', id] as const,
  duplicates: ['contacts', 'duplicates'] as const,
  stats: ['contacts', 'stats'] as const,
  tags: ['contacts', 'tags'] as const,
  meta: ['contacts', 'meta'] as const,
}

/** Refresh contact queries after a write; meta never changes and the edited person was just set. */
function refresh(qc: QueryClient, keepPerson?: string) {
  return qc.invalidateQueries({
    queryKey: contactKeys.all,
    predicate: (q) => q.queryKey[1] !== 'meta' && !(keepPerson && q.queryKey[1] === 'person' && q.queryKey[2] === keepPerson),
  })
}

// Cache-busting for photos: the avatar URL is cached for 5 minutes, so a fresh upload gets a new query string.
const avatarVersion = new Map<string, number>()
export const avatarSrc = (p: { id: string; has_avatar: boolean }) =>
  p.has_avatar ? apiUrl(`contacts/${p.id}/avatar`, { v: avatarVersion.get(p.id) }) : null
export const exportHref = (format: 'vcf' | 'csv', ids?: string[]) =>
  apiUrl('contacts/export', { format, ids: ids?.length ? ids.join(',') : undefined })

export const usePeople = (params: { q?: string; filter?: Filter; tag?: string; group?: string; sort?: string }) =>
  useQuery({
    // `limit` is part of the key so the calendar's 8-result attendee search never fills this list.
    queryKey: contactKeys.list({ ...params, limit: 500 }),
    queryFn: ({ signal }) => get<{ items: PersonBrief[]; total: number }>('contacts/', { ...params, limit: 500 }, signal),
    placeholderData: keepPreviousData,
  })
/** Small name search (relationship picker); same key and size as the calendar's attendee search. */
export const usePeopleSearch = (q: string) =>
  useQuery({
    queryKey: contactKeys.list({ q, filter: undefined, tag: undefined, sort: 'name' }),
    queryFn: ({ signal }) => get<{ items: PersonBrief[] }>('contacts/', { q, sort: 'name', limit: 8 }, signal),
    enabled: q.length >= 2,
    staleTime: 60_000,
  })
export const personQuery = (id: string) =>
  queryOptions({ queryKey: contactKeys.person(id), queryFn: ({ signal }) => get<PersonDetail>(`contacts/${id}`, undefined, signal) })
export const usePerson = (id: string | null) => useQuery({ ...personQuery(id ?? ''), enabled: !!id })
// Meta, tags and stats: fetched together (first load, or invalidating ['contacts']) they cost one
// GET /contacts/overview; refetched alone, each uses its own endpoint.
const side = queryGroup(
  'contacts/overview',
  {
    meta: { key: contactKeys.meta, path: 'contacts/meta' },
    tags: { key: contactKeys.tags, path: 'contacts/tags' },
    stats: { key: contactKeys.stats, path: 'contacts/stats' },
  },
  (all, k) => all[k],
)
export const useContactStats = () => useQuery({ queryKey: contactKeys.stats, queryFn: side<ContactStats>('stats') })
export const useContactTags = () => useQuery({ queryKey: contactKeys.tags, queryFn: side<Tag[]>('tags') })
export const useContactMeta = () => useQuery({ queryKey: contactKeys.meta, queryFn: side<ContactMeta>('meta'), staleTime: Infinity })
export const useDuplicates = () =>
  useQuery({ queryKey: contactKeys.duplicates, queryFn: ({ signal }) => get<DuplicatePair[]>('contacts/duplicates', undefined, signal) })

/** `toastErrors: false` when the caller shows the error itself (the edit form). */
export function useSavePerson(toastErrors = true) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id?: string; body: PersonIn }) =>
      id ? patch<PersonDetail>(`contacts/${id}`, body) : post<PersonDetail>('contacts/', body),
    onSuccess: (p) => {
      qc.setQueryData(contactKeys.person(p.id), p)
      refresh(qc, p.id)
    },
    meta: toastErrors ? undefined : { errorMessage: () => null },
  })
}

export function useDeletePerson() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => del(`contacts/${id}`),
    onSuccess: (_r, id) => {
      qc.removeQueries({ queryKey: contactKeys.person(id) })
      refresh(qc)
    },
  })
}

export function useBulkDelete() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (ids: string[]) => post<void>('contacts/bulk-delete', { ids }),
    onSuccess: (_r, ids) => {
      for (const id of ids) qc.removeQueries({ queryKey: contactKeys.person(id) })
      refresh(qc)
    },
  })
}

export function useAvatar(personId: string) {
  const qc = useQueryClient()
  const done = (p: PersonDetail) => {
    avatarVersion.set(p.id, Date.now())
    qc.setQueryData(contactKeys.person(p.id), p)
    refresh(qc, p.id)
  }
  const set = useMutation({
    mutationFn: (file: File) => {
      const fd = new FormData()
      fd.append('file', file)
      return upload<PersonDetail>(`contacts/${personId}/avatar`, fd)
    },
    onSuccess: done,
  })
  const remove = useMutation({
    mutationFn: () => api<PersonDetail>(`contacts/${personId}/avatar`, { method: 'DELETE' }),
    onSuccess: done,
  })
  return { set, remove }
}

export function useLogInteraction(personId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { kind: string; summary: string; date?: string | null; notes?: string }) =>
      post<Interaction>(`contacts/${personId}/interactions`, body),
    onSuccess: () => refresh(qc),
  })
}

export function useUpdateInteraction() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: { kind?: string; summary?: string; date?: string; notes?: string } }) =>
      patch<Interaction>(`contacts/interactions/${id}`, body),
    onSuccess: () => refresh(qc),
  })
}

export function useDeleteInteraction() {
  const qc = useQueryClient()
  return useMutation({ mutationFn: (id: string) => del(`contacts/interactions/${id}`), onSuccess: () => refresh(qc) })
}

export function useRelationships(personId: string) {
  const qc = useQueryClient()
  const add = useMutation({
    mutationFn: (body: { other_id: string; kind: string }) => post<Relationship>(`contacts/${personId}/relationships`, body),
    onSuccess: () => refresh(qc),
  })
  const remove = useMutation({ mutationFn: (id: number) => del(`contacts/relationships/${id}`), onSuccess: () => refresh(qc) })
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
    mutationFn: ({ file, opts }: { file: File; opts: ImportOptions }) =>
      upload<ImportResult>('contacts/import/commit', importForm(file, opts)),
    onSuccess: () => refresh(qc),
  })
}

export function useMerge() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { keep_id: string; other_id: string; fields: Record<string, 'keep' | 'other'> }) =>
      post<PersonDetail>('contacts/merge', body),
    onSuccess: (p, v) => {
      qc.removeQueries({ queryKey: contactKeys.person(v.other_id) })
      qc.setQueryData(contactKeys.person(p.id), p)
      refresh(qc, p.id)
    },
  })
}

export function useDismissDuplicate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { a_id: string; b_id: string }) => post<void>('contacts/duplicates/dismiss', body),
    onSuccess: (_r, v) =>
      qc.setQueryData<DuplicatePair[]>(contactKeys.duplicates, (old) =>
        old?.filter((d) => !((d.a.id === v.a_id && d.b.id === v.b_id) || (d.a.id === v.b_id && d.b.id === v.a_id))),
      ),
  })
}

// ---------------------------------------------------------------- tags & groups
export function useRenameTag() {
  const qc = useQueryClient()
  return useMutation({
    meta: { errorMessage: () => null }, // shown in the form
    mutationFn: ({ id, name }: { id: number; name: string }) => patch<Tag>(`contacts/tags/${id}`, { name }),
    onSuccess: () => refresh(qc), // contacts show tag names, so every list and open person refreshes
  })
}

export function useDeleteTag() {
  const qc = useQueryClient()
  return useMutation({ mutationFn: (id: number) => del(`contacts/tags/${id}`), onSuccess: () => refresh(qc) })
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
      for (const id of v.others) qc.removeQueries({ queryKey: contactKeys.person(id) })
      qc.setQueryData(contactKeys.person(p.id), p)
      refresh(qc, p.id)
    },
    // Some merges may have gone through before the failure: refresh everything.
    onError: () => refresh(qc),
  })
}

// ---------------------------------------------------------------- reminder settings
export type ContactSettings = Schemas['ContactsSettingsOut']
// Same key as Notifications › Reminders, so both screens share one cached copy.
const SETTINGS_KEY = ['settings', 'contacts/settings']
export const useContactSettings = (enabled = true) =>
  useQuery({ queryKey: SETTINGS_KEY, queryFn: ({ signal }) => get<ContactSettings>('contacts/settings', undefined, signal), enabled })
export function useSaveContactSettings() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: Partial<ContactSettings>) => patch<ContactSettings>('contacts/settings', body),
    onMutate: (body) => {
      const prev = qc.getQueryData<ContactSettings>(SETTINGS_KEY)
      if (prev) qc.setQueryData(SETTINGS_KEY, { ...prev, ...body })
      return { prev }
    },
    onError: (_e, _b, ctx) => ctx?.prev && qc.setQueryData(SETTINGS_KEY, ctx.prev),
    onSuccess: (s) => qc.setQueryData(SETTINGS_KEY, s),
  })
}
