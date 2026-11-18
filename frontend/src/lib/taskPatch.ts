// A task with a PATCH applied, as the server will return it, for optimistic cache updates. Assignees go out as
// usernames but come back as people: people already on the task (or in `known`, like the signed-in user) are
// kept, anyone else gets a placeholder until the server answers.
import type { Me, Task, TaskPatch, UserBrief } from './types'

const placeholder = (username: string): UserBrief => ({ id: username, username, name: username })

/** The signed-in user as a task assignee. */
export const meAsUser = (me: Me): UserBrief => ({ id: me.id, username: me.username, name: me.username })

export function applyPatch<T extends Task>(t: T, body: TaskPatch, known: UserBrief[] = []): T {
  const { assignees, ...rest } = body
  const out = { ...t, ...rest }
  if (assignees)
    out.assignees = assignees.map((u) => t.assignees.find((a) => a.username === u) ?? known.find((a) => a.username === u) ?? placeholder(u))
  return out
}
