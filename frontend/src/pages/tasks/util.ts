// Pure helpers for the Tasks page (no React): repeat/reminder wording, time-spent parsing, whether a new
// task belongs to the list on screen, subtask nesting and the calendar month window. Unit-tested.
import { addDays, dayDiff, isEndOfDay, startOfDay, startOfWeek } from '../../lib/dates'
import type { Task, TaskReminder } from '../../lib/types'

// ---------------------------------------------------------------- repeat
export const REPEAT_PRESETS: { label: string; short: string; mode: number; every: number | null }[] = [
  { label: 'Does not repeat', short: '', mode: 0, every: null },
  { label: 'Every day', short: 'Daily', mode: 1, every: 86400 },
  { label: 'Every week', short: 'Weekly', mode: 1, every: 604800 },
  { label: 'Every 2 weeks', short: 'Every 2 wk', mode: 1, every: 1209600 },
  { label: 'Every month', short: 'Monthly', mode: 2, every: null },
  { label: 'Every year', short: 'Yearly', mode: 1, every: 31536000 },
]
export const REPEAT_UNITS: [string, number][] = [['hours', 3600], ['days', 86400], ['weeks', 604800], ['months', 2592000], ['years', 31536000]]

/** "Every week", "Every 3 days after completion"; short gives "Weekly" for rows. */
export function repeatText(mode: number, every: number | null, short = false): string {
  if (!mode) return ''
  const preset = mode === 2 ? REPEAT_PRESETS[4] : REPEAT_PRESETS.find((p) => p.mode === (mode === 3 ? 1 : mode) && p.every === every)
  let s: string
  if (preset) s = short ? preset.short : preset.label
  else {
    const [name, secs] = [...REPEAT_UNITS].reverse().find(([, x]) => (every ?? 0) % x === 0) ?? ['minutes', 60]
    const n = Math.round((every ?? 0) / secs)
    s = `Every ${n} ${n === 1 ? name.replace(/s$/, '') : name}`
  }
  if (mode === 3) s += short ? ' after done' : ' after completion'
  return s
}

/** Split repeat_every into [count, unit seconds] for the custom form. */
export function repeatParts(every: number | null): [number, number] {
  if (!every) return [1, 86400]
  const [, secs] = [...REPEAT_UNITS].reverse().find(([, s]) => every % s === 0) ?? REPEAT_UNITS[0]
  return [every / secs, secs]
}

// ---------------------------------------------------------------- reminders
export interface ReminderIn { at: string | null; relative_to: '' | 'due' | 'start'; offset: number }

export const durText = (secs: number) => {
  const a = Math.abs(secs)
  if (a % 604800 === 0) return `${a / 604800} week${a === 604800 ? '' : 's'}`
  if (a % 86400 === 0) return `${a / 86400} day${a === 86400 ? '' : 's'}`
  if (a % 3600 === 0) return `${a / 3600} hour${a === 3600 ? '' : 's'}`
  return `${Math.round(a / 60)} min`
}

/** "1 hour before due", "At start time"; absolute reminders return null (the caller formats the date). */
export function reminderText(r: Pick<TaskReminder, 'relative_to' | 'offset'>): string | null {
  if (!r.relative_to) return null
  const what = r.relative_to === 'due' ? 'due' : 'start'
  if (!r.offset) return `At ${what} time`
  return `${durText(r.offset)} ${r.offset < 0 ? 'before' : 'after'} ${what}`
}

export const reminderIn = (r: Pick<TaskReminder, 'at' | 'relative_to' | 'offset'>): ReminderIn =>
  ({ at: r.relative_to ? null : r.at, relative_to: (r.relative_to || '') as ReminderIn['relative_to'], offset: r.offset || 0 })

// ---------------------------------------------------------------- time spent
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

// ---------------------------------------------------------------- overdue
/** Due before now; a 23:59 ("all day") task due today isn't overdue yet. */
export function isOverdue(t: Pick<Task, 'due' | 'done'>, now = new Date()): boolean {
  if (!t.due || t.done) return false
  const d = new Date(t.due)
  return d < now && (dayDiff(now, d) < 0 || !isEndOfDay(d))
}

// ---------------------------------------------------------------- does a new task belong here?
/** Mirrors the server's list filters for the params on screen; null = can't tell (the refetch decides). */
export function fitsList(t: Task, p: Record<string, unknown>, me?: string, now = new Date()): boolean | null {
  if (p.due_before || p.due_after || p.done_after) return null
  const end = new Date(now); end.setHours(23, 59, 59, 999)
  const due = t.due ? new Date(t.due) : null
  if (p.project && t.project_id !== p.project) return false
  if (p.parent && t.parent_id !== p.parent) return false
  if (p.top_level && t.parent_id) return false
  const views: Record<string, () => boolean> = {
    today: () => !!due && due <= end,
    upcoming: () => !!due && due >= startOfDay(now) && due <= addDays(end, 7),
    overdue: () => !!due && due < now,
    nodate: () => !due,
    favorites: () => t.favorite,
    assigned: () => !!me && t.assignees.some((a) => a.username === me),
    done: () => t.done,
  }
  const view = p.view as string | undefined
  if (view && views[view] && !views[view]()) return false
  if (p.done === false && t.done) return false
  if (p.label && !String(p.label).split(',').every((id) => t.labels.includes(Number(id)))) return false
  if (p.priority_min && t.priority < Number(p.priority_min)) return false
  if (p.assignee && !t.assignees.some((a) => a.username === p.assignee)) return false
  if (p.q && !`${t.title} ${t.description}`.toLowerCase().includes(String(p.q).toLowerCase())) return false
  return true
}

// ---------------------------------------------------------------- subtasks under their parents
/** Roots in input order, and each loaded parent's loaded children (a child whose parent isn't loaded is a root). */
export function nestTasks<T extends Pick<Task, 'id' | 'parent_id'>>(items: T[]): { roots: T[]; kids: Map<string, T[]> } {
  const ids = new Set(items.map((t) => t.id))
  const kids = new Map<string, T[]>()
  const roots: T[] = []
  for (const t of items) {
    if (t.parent_id && ids.has(t.parent_id)) kids.set(t.parent_id, [...(kids.get(t.parent_id) ?? []), t])
    else roots.push(t)
  }
  return { roots, kids }
}

// ---------------------------------------------------------------- calendar
/** The 6-week window shown for `month` (weeks start on Monday, like the rest of the app). */
export function calendarRange(month: Date): { start: Date; end: Date } {
  const start = startOfWeek(new Date(month.getFullYear(), month.getMonth(), 1))
  return { start, end: addDays(start, 42) }
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

/** The board's list query (also read by the page for its counts). */
export const boardParams = (projectId: string, q: string) => ({ project: projectId, top_level: true, sort: 'position', limit: 500, q: q || undefined })
