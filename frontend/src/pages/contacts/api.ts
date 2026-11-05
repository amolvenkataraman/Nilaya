// /api/v2/contacts/ types and hooks (query keys under ['contacts']).
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { del, get, patch, post } from '../../lib/api'
import { toast } from '../../components/toast'

export interface LabeledValue { label: string; value: string }
export interface Address { label: string; street: string; city: string; region: string; postcode: string; country: string }
export interface ProfileLink { network: string; label: string; handle: string; url: string | null }
export interface PersonBrief {
  id: string; name: string; first_name: string; last_name: string; company: string; title: string; favorite: boolean
  email: string; phone: string; has_avatar: boolean; profile_links: ProfileLink[]; tags: string[]; groups: string[]
  birthday: string; last_contacted: string | null; keep_in_touch_days: number | null; next_due: string | null
  overdue: boolean; created_on: string
}
export interface Interaction { id: string; person_id: string; kind: string; date: string; summary: string; notes: string; created_on: string }
export interface Relationship { id: number; kind: string; other_id: string; other_name: string }
export interface PersonDetail extends PersonBrief {
  prefix: string; middle_name: string; suffix: string; nickname: string; display_name: string; department: string
  emails: LabeledValue[]; phones: LabeledValue[]; addresses: Address[]; links: { label: string; url: string }[]
  custom_fields: { key: string; value: string }[]; anniversary: string | null; how_met: string; notes: string
  sources: string[]; updated_on: string; interactions: Interaction[]; relationships: Relationship[]
}
export type PersonIn = Partial<Pick<PersonDetail,
  'first_name' | 'last_name' | 'company' | 'title' | 'emails' | 'phones' | 'birthday' | 'how_met' | 'notes' | 'tags' | 'favorite' | 'keep_in_touch_days' | 'nickname'>>
export interface Tag { id: number; kind: string; name: string; count?: number }
export interface ContactStats {
  total: number; favorites: number; overdue: number; keep_in_touch: number; recent: number; birthdays_this_month: number
  upcoming_birthdays?: { id: string; name: string; date: string; days: number; age: number | null }[]
  overdue_people?: { id: string; name: string; next_due: string; days_overdue: number }[]
  sources?: Record<string, number>
}
export type Filter = '' | 'favorites' | 'overdue' | 'kit' | 'recent' | 'birthdays'

const onError = (e: unknown) => toast.error((e as Error).message)

export const usePeople = (params: { q?: string; filter?: Filter; tag?: string; sort?: string }) =>
  useQuery({
    queryKey: ['contacts', 'list', params],
    queryFn: ({ signal }) => get<{ items: PersonBrief[]; total: number }>('contacts/', { ...params, limit: 500 }, signal),
    placeholderData: keepPreviousData,
  })
export const usePerson = (id: string | null) =>
  useQuery({ queryKey: ['contacts', 'person', id], queryFn: () => get<PersonDetail>(`contacts/${id}`), enabled: !!id })
export const useContactStats = () => useQuery({ queryKey: ['contacts', 'stats'], queryFn: () => get<ContactStats>('contacts/stats') })
export const useContactTags = () => useQuery({ queryKey: ['contacts', 'tags'], queryFn: () => get<Tag[]>('contacts/tags') })
export const useInteractionKinds = () =>
  useQuery({ queryKey: ['contacts', 'meta'], queryFn: () => get<{ interaction_kinds: string[] }>('contacts/meta'), staleTime: Infinity })

export function useSavePerson() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id?: string; body: PersonIn }) => (id ? patch<PersonDetail>(`contacts/${id}`, body) : post<PersonDetail>('contacts/', body)),
    onSuccess: (p) => {
      qc.setQueryData(['contacts', 'person', p.id], p)
      qc.invalidateQueries({ queryKey: ['contacts'], predicate: (q) => q.queryKey[1] !== 'person' || q.queryKey[2] !== p.id })
    },
    onError,
  })
}

export function useDeletePerson() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => del(`contacts/${id}`),
    onSuccess: (_r, id) => {
      qc.removeQueries({ queryKey: ['contacts', 'person', id] })
      qc.invalidateQueries({ queryKey: ['contacts'], predicate: (q) => q.queryKey[1] !== 'person' })
    },
    onError,
  })
}

export function useLogInteraction(personId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { kind: string; summary: string; date?: string | null }) => post<Interaction>(`contacts/${personId}/interactions`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['contacts'] }),
    onError,
  })
}

export function useDeleteInteraction() {
  const qc = useQueryClient()
  return useMutation({ mutationFn: (id: string) => del(`contacts/interactions/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ['contacts'] }), onError })
}
