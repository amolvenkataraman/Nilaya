// Facts about one task or project that several Tasks views ask: is it saved yet, is it overdue, may I edit
// it, what's its project called, where does it land when moved to another day, and what it looks like
// after an optimistic PATCH. Pure (no React), unit-tested.
import { dayDiff, isEndOfDay } from '../../lib/dates'
import type { Project, Task } from '../../lib/types'

/** Optimistically added tasks carry a temporary id until the server answers; they can't be opened or changed. */
export const isTempId = (id: string): boolean => id.startsWith('temp-')

/** The inbox is a project, shown as "Inbox". */
export const projectName = (p: Pick<Project, 'name' | 'is_inbox'>): string => (p.is_inbox ? 'Inbox' : p.name)

/** Project roles: 0 view, 1 edit, 2 admin. */
export const canEditIn = (p: Pick<Project, 'role'> | undefined): boolean => (p?.role ?? 0) >= 1
export const isProjectAdmin = (p: Pick<Project, 'role'> | undefined): boolean => (p?.role ?? 0) >= 2

/** Due before now; a 23:59 ("all day") task due today isn't overdue yet. */
export function isOverdue(t: Pick<Task, 'due' | 'done'>, now = new Date()): boolean {
  if (!t.due || t.done) return false
  const d = new Date(t.due)
  return d < now && (dayDiff(now, d) < 0 || !isEndOfDay(d))
}

/** Whether I can edit a task, as the server decides (tasks.service.can_edit_task): a loose task is its
 *  creator's; in a project it takes edit rights there (a creator made view-only keeps none). Until the
 *  projects load, my own tasks count as editable. No `me` yet: assume yes (the server still checks). */
export function canEditTask(
  t: Pick<Task, 'owner' | 'project_id'>,
  me: { id: string } | undefined,
  projects: Project[] | undefined,
): boolean {
  if (!me) return true
  if (!t.project_id) return t.owner.id === me.id
  const p = projects?.find((x) => x.id === t.project_id)
  return p ? canEditIn(p) : !projects && t.owner.id === me.id
}

/** Minutes from "45m", "1h 30m", "1.5h", "1:30" or "90"; "" is 0; null when unreadable. */
export function parseMinutes(s: string): number | null {
  const v = s.trim().toLowerCase()
  if (!v) return 0
  let m = /^(\d+):(\d{1,2})$/.exec(v)
  if (m) return Number(m[1]) * 60 + Number(m[2])
  if (/^\d+$/.test(v)) return Number(v)
  m = /^(?:(\d+(?:\.\d+)?)\s*h(?:ours?|rs?)?)?\s*(?:(\d+)\s*m(?:in(?:utes?|s)?)?)?$/.exec(v)
  if (m && (m[1] || m[2])) return Math.round(Number(m[1] ?? 0) * 60) + Number(m[2] ?? 0)
  return null
}

/** Same wall-clock time on another day; start shifts by the same amount. */
export function rescheduleTo(t: Pick<Task, 'due' | 'start'>, day: Date): { due: string; start?: string } | null {
  if (!t.due) return null
  const old = new Date(t.due)
  const nd = new Date(day.getFullYear(), day.getMonth(), day.getDate(), old.getHours(), old.getMinutes())
  if (nd.getTime() === old.getTime()) return null
  const out: { due: string; start?: string } = { due: nd.toISOString() }
  if (t.start) out.start = new Date(new Date(t.start).getTime() + (nd.getTime() - old.getTime())).toISOString()
  return out
}
