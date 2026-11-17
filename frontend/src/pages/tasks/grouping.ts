// How a list is cut into sections: subtasks nested under their loaded parents, then sections by due date
// (Upcoming as a 7-day planner), priority or project, or none; the Completed view by the day each task was
// done. Section keys double as drop targets (a due-date section reschedules, a priority one re-prioritises,
// a project one moves). Pure, unit-tested.
import { addDays, dayKey, fmtDate, groupByDay, groupByDue, isSameDay, parseDayKey, startOfDay, weekdayName } from '../../lib/dates'
import type { SmartView } from '../../lib/qs'
import type { Task } from '../../lib/types'
import { PRIORITY_OPTIONS, prioLevel } from './priority'
import type { Grouping } from './useTasksUrl'

export interface Section {
  key: string
  label: string
  items: Task[]
  /** Shown even when empty (Upcoming's days, so you can drop onto them). */
  keep: boolean
}

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

const doneDayLabel = (d: Date | null, now: Date) =>
  !d
    ? 'Undated'
    : isSameDay(d, now)
      ? 'Today'
      : isSameDay(d, addDays(now, -1))
        ? 'Yesterday'
        : fmtDate(d, { weekday: 'long', month: 'short', day: 'numeric' })

export function groupTasks({
  view,
  items,
  roots,
  grouping,
  projectList,
  sort,
  projectLabel,
  now = new Date(),
}: {
  view: SmartView | null
  /** Every row (the Completed view lists them flat). */
  items: Task[]
  /** Top-level rows (subtasks render under their parents). */
  roots: Task[]
  grouping: Grouping
  /** A project or the inbox: automatic grouping shows one manual-order section there. */
  projectList: boolean
  sort: string
  projectLabel: (projectId: string) => string
  now?: Date
}): Section[] {
  if (view === 'done')
    return groupByDay(items, (t) => t.done_at).map((g) => ({ key: g.key, label: doneDayLabel(g.date, now), items: g.items, keep: false }))
  if (grouping === 'none' || (grouping === 'auto' && projectList && sort !== 'due'))
    return [{ key: 'all', label: '', items: roots, keep: false }]
  if (grouping === 'priority')
    return [...PRIORITY_OPTIONS]
      .reverse()
      .map((p) => ({ key: `p${p.value}`, label: p.label, keep: false, items: roots.filter((t) => prioLevel(t.priority) === p.value) }))
      .filter((g) => g.items.length)
  if (grouping === 'project') {
    const m = new Map<string, Task[]>()
    for (const t of roots) m.set(t.project_id ?? '', [...(m.get(t.project_id ?? '') ?? []), t])
    return [...m.entries()].map(([id, list]) => ({
      key: `pr${id}`,
      label: id ? projectLabel(id) : 'No project',
      items: list,
      keep: false,
    }))
  }
  const byDue = groupByDue(roots, (t) => t.due, now).map((x) => ({ ...x, keep: false }))
  if (view !== 'upcoming') return byDue
  // Upcoming reads like a planner: one section per day for the coming week, empty ones included (drop targets).
  const today = startOfDay(now)
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = addDays(today, i)
    const key = i === 0 ? 'today' : i === 1 ? 'tomorrow' : `day:${dayKey(d)}`
    const label = i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : `${weekdayName(d)}, ${fmtDate(d)}`
    return { key, label, items: byDue.find((x) => x.key === key)?.items ?? [], keep: true }
  })
  return [...byDue.filter((x) => x.key === 'overdue'), ...days]
}

/** The day a due-date section stands for (null: "No date"), or undefined for other sections. */
export function sectionDay(key: string, today: Date): Date | null | undefined {
  if (key === 'nodate') return null
  if (key === 'today') return today
  if (key === 'tomorrow') return addDays(today, 1)
  if (key.startsWith('day:')) return parseDayKey(key.slice(4))
  return undefined
}

/** The priority a section stands for ("p15"), or undefined. */
export const sectionPriority = (key: string): number | undefined => (/^p\d+$/.test(key) ? Number(key.slice(1)) : undefined)

/** What dropping onto a section does, for its hint ("Drop to reschedule to tomorrow"). */
export function dropHint(key: string, label: string): string {
  if (key === 'nodate') return 'clear the due date'
  if (sectionPriority(key) !== undefined) return `set ${label.toLowerCase()} priority`
  if (key.startsWith('pr')) return `move to ${label}`
  const l = label.toLowerCase()
  return `reschedule to ${l === 'today' || l === 'tomorrow' ? l : label}`
}
