// Cached task lists: plain pages (GET /tasks/ once) and infinite ones (keyset pages). One set of helpers
// edits both in place after a change, so a completed, moved or edited task leaves the lists it no longer
// fits and joins the ones it now fits, in sort order, without refetching every loaded page.
import type { InfiniteData, QueryClient, QueryKey } from '@tanstack/react-query'
import { addDays, startOfDay } from './dates'
import type { Me, Task, TaskDetail, TaskPage } from './types'

export type TaskPages = InfiniteData<TaskPage, unknown>
export type TaskList = TaskPage | TaskPages
type Params = Record<string, unknown>

export const isPages = (d: TaskList): d is TaskPages => 'pages' in d

/** Every loaded task once, in order (a task that moved between pages shows where it was first seen). */
export function listItems(d: TaskList | undefined): Task[] {
  if (!d) return []
  if (!isPages(d)) return d.items
  if (d.pages.length === 1) return d.pages[0].items
  const seen = new Set<string>()
  const out: Task[] = []
  for (const p of d.pages) for (const t of p.items) if (!seen.has(t.id)) { seen.add(t.id); out.push(t) }
  return out
}
export const listTotal = (d: TaskList | undefined): number | null | undefined => (d ? (isPages(d) ? d.pages[0]?.total : d.total) : undefined)
const lastNext = (d: TaskList) => (isPages(d) ? d.pages.at(-1)?.next : d.next) ?? null

// ---------------------------------------------------------------- sort order (mirrors tasks/api.py SORTS)
type Key = [field: keyof Task, desc: boolean, date: boolean]
const SORT_KEYS: Record<string, Key[]> = {
  position: [['position', false, false], ['created_on', false, true]],
  due: [['due', false, true], ['priority', true, false]],
  priority: [['priority', true, false], ['due', false, true]],
  created: [['created_on', true, true]],
  updated: [['updated_on', true, true]],
  title: [['title', false, false]],
  done: [['done_at', true, true]],
}
type Val = number | string | null
const keyOf = (t: Task, sort: string): Val[] =>
  [...(SORT_KEYS[sort] ?? SORT_KEYS.position).map(([f, , date]) => {
    const v = t[f] as unknown
    return v == null ? null : date ? Date.parse(String(v)) : (v as number | string)
  }), t.id]
function cmpKeys(a: Val[], b: Val[], sort: string): number {
  const keys = SORT_KEYS[sort] ?? SORT_KEYS.position
  for (let i = 0; i < a.length; i++) {
    const x = a[i], y = b[i]
    if (x === y) continue
    if (x == null) return 1 // nulls last
    if (y == null) return -1
    const desc = i < keys.length && keys[i][1]
    return (x < y ? -1 : 1) * (desc ? -1 : 1)
  }
  return 0
}
export const compareTasks = (sort: string) => (a: Task, b: Task) => cmpKeys(keyOf(a, sort), keyOf(b, sort), sort)

/** The last row the server sent (decoded from the next-page cursor): rows after it arrive with later pages. */
function boundary(cursor: string, sort: string): Val[] | null {
  try {
    const [s, vals] = JSON.parse(atob(cursor.replace(/-/g, '+').replace(/_/g, '/'))) as [string, Val[]]
    if (s !== sort) return null
    const keys = SORT_KEYS[sort] ?? SORT_KEYS.position
    return vals.map((v, i) => (v != null && i < keys.length && keys[i][2] ? Date.parse(String(v)) : v))
  } catch {
    return null
  }
}

// ---------------------------------------------------------------- does a task belong in a list?
const bool = (v: unknown) => (v === true || v === 'true' ? true : v === false || v === 'false' ? false : undefined)

/** Mirrors the server's list filters (tasks/api.py _filter); null = can't tell (refetch that list). */
export function fitsList(t: Task, p: Params, me?: string, now = new Date()): boolean | null {
  const end = new Date(now); end.setHours(23, 59, 59, 999)
  const due = t.due ? new Date(t.due) : null
  if (p.project && t.project_id !== p.project) return false
  if (p.parent && t.parent_id !== p.parent) return false
  if (bool(p.top_level) && t.parent_id) return false
  if (p.bucket != null && p.bucket !== '' && t.bucket_id !== Number(p.bucket)) return t.bucket_id == null ? null : false
  const views: Record<string, () => boolean> = {
    today: () => !!due && due <= end,
    upcoming: () => !!due && due >= startOfDay(now) && due <= addDays(end, 7),
    overdue: () => !!due && due < now,
    nodate: () => !due,
    favorites: () => t.favorite,
    assigned: () => !!me && t.assignees.some((a) => (typeof a === 'string' ? a === me : a.username === me)),
    done: () => t.done,
  }
  const view = (p.view as string | undefined) || ''
  if (view && views[view] && !views[view]()) return false
  // Open tasks only, unless the list asks for done ones (a project's own list without `done` has both).
  const done = view === 'done' ? true : bool(p.done) ?? (view || !p.project ? false : undefined)
  if (done !== undefined && t.done !== done) return false
  if (p.due_after && (!due || due < new Date(String(p.due_after)))) return false
  if (p.due_before && (!due || due >= new Date(String(p.due_before)))) return false
  if (p.done_after && (!t.done_at || new Date(t.done_at) < new Date(String(p.done_after)))) return false
  if (p.label && !String(p.label).split(',').every((id) => t.labels.includes(Number(id)))) return false
  if (p.priority_min && t.priority < Number(p.priority_min)) return false
  if (p.assignee && !t.assignees.some((a) => (typeof a === 'string' ? a === p.assignee : a.username === p.assignee))) return false
  if (p.q && !`${t.title} ${t.description}`.toLowerCase().includes(String(p.q).toLowerCase())) return false
  return true
}

// ---------------------------------------------------------------- editing cached lists
/** Rebuild a list from new flat items, keeping its page split (cursors stay valid: they're keyset). */
function withItems(d: TaskList, items: Task[], delta: number): TaskList {
  if (!isPages(d)) return { ...d, items, total: d.total == null ? d.total : Math.max(0, d.total + delta) }
  const pages = d.pages.map((p, i) => ({ ...p, total: i === 0 && p.total != null ? Math.max(0, p.total + delta) : p.total, items: [] as Task[] }))
  let at = 0
  d.pages.forEach((p, i) => {
    const n = i === d.pages.length - 1 ? items.length - at : Math.min(p.items.length, items.length - at)
    pages[i].items = items.slice(at, at + Math.max(0, n))
    at += Math.max(0, n)
  })
  return { ...d, pages }
}

export interface Settle {
  /** Tasks as they are now (server copies, or optimistic ones). */
  tasks?: Task[]
  /** Ids that no longer exist. */
  gone?: Iterable<string>
  /** Ids the user just placed (a drop): sort them in even past the loaded range (they land at its end). */
  keep?: Iterable<string>
}

/** Put changed tasks where they belong in every cached list: replace in place, re-sort, drop from lists
 *  they no longer fit, add to loaded ranges they now fit. Lists it can't decide on are invalidated
 *  (only refetched if on screen). Returns a rollback for optimistic use. */
export function settleTaskLists(qc: QueryClient, { tasks = [], gone = [], keep = [] }: Settle): () => void {
  const me = qc.getQueryData<Me>(['me'])?.username
  const byId = new Map(tasks.map((t) => [t.id, t]))
  const goneSet = new Set(gone)
  const keepSet = new Set(keep)
  const snaps: [QueryKey, unknown][] = []
  const stale: QueryKey[] = []
  for (const [key, data] of qc.getQueriesData<TaskList>({ queryKey: ['tasks', 'list'] })) {
    if (!data) continue
    const params = (key[2] ?? {}) as Params
    const sort = String(params.sort ?? 'position')
    const cmp = compareTasks(sort)
    const flat = listItems(data)
    const next = lastNext(data)
    const edge = next ? boundary(next, sort) : null
    const inRange = (t: Task) => !next || keepSet.has(t.id) || (edge != null && cmpKeys(keyOf(t, sort), edge, sort) <= 0)
    let items = flat
    let delta = 0
    let dirty = false
    const present = new Set<string>()
    if (goneSet.size || byId.size) {
      items = []
      for (const t of flat) {
        if (goneSet.has(t.id)) { delta--; dirty = true; continue }
        const n = byId.get(t.id)
        if (!n) { items.push(t); continue }
        present.add(t.id)
        const fit = fitsList(n, params, me)
        if (fit === false) { delta--; dirty = true; continue }
        if (fit === null) stale.push(key)
        items.push(n)
        if (n !== t) dirty = true
      }
    }
    for (const t of tasks) {
      if (present.has(t.id) || goneSet.has(t.id)) continue
      const fit = fitsList(t, params, me)
      if (fit === null) { stale.push(key); continue }
      if (fit && inRange(t)) { items.push(t); delta++; dirty = true }
    }
    if (!dirty) continue
    // Re-sort only the changed tasks: take them out and insert each at its place (stable for the rest).
    // A task whose new place is past the loaded range stays where it is (its later page is deduplicated).
    if (byId.size) {
      const keep = items.filter((t) => !byId.has(t.id) || !inRange(t))
      for (const t of items) {
        if (!byId.has(t.id) || !inRange(t)) continue
        let lo = 0, hi = keep.length
        while (lo < hi) { const mid = (lo + hi) >> 1; if (cmp(keep[mid], t) <= 0) lo = mid + 1; else hi = mid }
        keep.splice(lo, 0, t)
      }
      items = keep
    }
    snaps.push([key, data])
    qc.setQueryData<TaskList>(key, withItems(data, items, delta))
  }
  for (const t of tasks) {
    const old = qc.getQueryData<TaskDetail>(['tasks', 'detail', t.id])
    if (old) { snaps.push([['tasks', 'detail', t.id], old]); qc.setQueryData<TaskDetail>(['tasks', 'detail', t.id], { ...old, ...t }) }
  }
  for (const k of stale) qc.invalidateQueries({ queryKey: k, exact: true })
  return () => snaps.reverse().forEach(([k, d]) => qc.setQueryData(k, d))
}

/** Apply `fn` to tasks in place (no moves between lists): for optimistic edits. Returns a rollback. */
export function patchTaskLists(qc: QueryClient, ids: Iterable<string>, fn: (t: Task) => Task): () => void {
  const set = new Set(ids)
  const snaps: [QueryKey, unknown][] = []
  for (const [key, data] of qc.getQueriesData<TaskList>({ queryKey: ['tasks', 'list'] })) {
    if (!data || !listItems(data).some((t) => set.has(t.id))) continue
    snaps.push([key, data])
    const map = (items: Task[]) => items.map((t) => (set.has(t.id) ? fn(t) : t))
    const next: TaskList = isPages(data) ? { ...data, pages: data.pages.map((p) => ({ ...p, items: map(p.items) })) } : { ...data, items: map(data.items) }
    qc.setQueryData<TaskList>(key, next)
  }
  for (const id of set) {
    const old = qc.getQueryData<TaskDetail>(['tasks', 'detail', id])
    if (old) { snaps.push([['tasks', 'detail', id], old]); qc.setQueryData<TaskDetail>(['tasks', 'detail', id], { ...old, ...fn(old) } as TaskDetail) }
  }
  return () => snaps.reverse().forEach(([k, d]) => qc.setQueryData(k, d))
}

/** A task from any cached list or detail (no request). */
export function cachedTask(qc: QueryClient, id: string): Task | undefined {
  const d = qc.getQueryData<Task>(['tasks', 'detail', id])
  if (d) return d
  for (const [, data] of qc.getQueriesData<TaskList>({ queryKey: ['tasks', 'list'] })) {
    const t = listItems(data).find((x) => x.id === id)
    if (t) return t
  }
  return undefined
}
