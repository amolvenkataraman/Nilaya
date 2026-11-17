// Profiles: someone's public card (GET /users/{username}, also by user id). PictureDialog refreshes it after
// you change your picture, by the same key.
import { queryOptions } from '@tanstack/react-query'
import { get } from '../../lib/api'
import type { GroupBrief, UUID } from '../../lib/types'

export interface Person {
  id: UUID
  username: string
  name: string
  description: string
  profile_picture: string
  is_staff: boolean
  groups: GroupBrief[]
}

export const personQuery = (username: string) =>
  queryOptions({
    queryKey: ['users', username] as const,
    queryFn: ({ signal }) => get<Person>(`users/${encodeURIComponent(username)}`, undefined, signal),
    staleTime: 5 * 60_000,
  })
