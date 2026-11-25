// Calendar-only shapes the shared lib/types.ts doesn't carry: a calendar's settings detail, its people and
// invite codes, the PATCH body, birthdays from Contacts, and the overlays every view draws on top of events.
import type { Schemas, Task } from '../../lib/types'

export type Person = { id: string; username: string; first_name?: string; last_name?: string; name?: string }
export const personName = (u: Person) => u.name || [u.first_name, u.last_name].filter(Boolean).join(' ') || u.username

/** owner and user: the server types them as plain dicts. */
export type CalendarDetail = Omit<Schemas['CalendarDetailOut'], 'owner'> & { owner: Person }
export type CalendarPatchBody = Schemas['CalendarPatch']
export type Subscriber = Omit<Schemas['SubscriberOut'], 'user'> & { user: Person }
export type Invite = Schemas['InviteOut']
export type Birthday = Schemas['BirthdayOut']

/** What the month, week and day views draw besides events, by day key; plus how to open a task. */
export interface Layers {
  tasks: Map<string, Task[]>
  birthdays: Map<string, Birthday[]>
  photos?: Record<string, number>
  onTask: (t: Task) => void
}
