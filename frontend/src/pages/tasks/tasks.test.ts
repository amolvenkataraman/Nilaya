import { describe, expect, it } from 'vitest'
import { dragPatch, taskSpan } from './Timeline'
import { dueOn, positionsBetween } from './api'

const at = (d: number, h: number, m = 0) => new Date(2026, 10, d, h, m).toISOString()
const day = (iso: string | null | undefined) => (iso ? new Date(iso).getDate() : null)

describe('timeline drag', () => {
  it('moves both dates, resizes one edge, and refuses start after due', () => {
    const t = { start: at(4, 9), due: at(6, 23, 59) }
    expect(dragPatch(t, 'move', 2)).toEqual({ start: at(6, 9), due: at(8, 23, 59) })
    expect(dragPatch(t, 'end', -1)).toEqual({ due: at(5, 23, 59) })
    expect(dragPatch(t, 'start', 3)).toBe('The start must be before the due date.')
    // A due-only task gains a 9:00 start when its left edge is dragged.
    expect(dragPatch({ start: null, due: at(6, 23, 59) }, 'start', -2)).toEqual({ start: at(4, 9) })
    expect(taskSpan({ start: null, due: null })).toBeNull()
    expect(taskSpan({ start: at(6, 9), due: at(4, 9) })!.map((d) => d.getDate())).toEqual([4, 6])
  })
})

describe('bulk helpers', () => {
  it('keeps a due time of day, else lands on 23:59', () => {
    const target = new Date(2026, 10, 10)
    expect(new Date(dueOn(at(4, 17, 30), target)!).getHours()).toBe(17)
    expect(day(dueOn(at(4, 17, 30), target))).toBe(10)
    expect(new Date(dueOn(at(4, 23, 59), target)!).getMinutes()).toBe(59)
    expect(dueOn(at(4, 9), null)).toBeNull()
  })
})

import { calendarRange, fitsList, nestTasks, parseMinutes, repeatText, rescheduleTo } from './util'
import { treeDrop } from './Sidebar'
import { withFilters } from './TasksPage'
import type { Project, Task } from '../../lib/types'
import { QueryClient } from '@tanstack/react-query'
import { listItems, listTotal, settleTaskLists } from '../../lib/taskLists'
import { rangeGaps } from './Calendar'

describe('task helpers', () => {
  it('parses time spent and words repeats', () => {
    expect([parseMinutes('45m'), parseMinutes('1h 30m'), parseMinutes('1.5h'), parseMinutes('1:30'), parseMinutes('90'), parseMinutes(''), parseMinutes('soon')])
      .toEqual([45, 90, 90, 90, 90, 0, null])
    expect(repeatText(1, 604800)).toBe('Every week')
    expect(repeatText(3, 259200)).toBe('Every 3 days after completion')
    expect(repeatText(2, null, true)).toBe('Monthly')
  })
  it('knows whether a new task belongs to the list on screen', () => {
    const t = { id: 'a', title: 'Pay rent', description: '', project_id: 'p1', parent_id: null, due: null, done: false, favorite: false, labels: [3], priority: 10, assignees: [] } as unknown as Task
    expect(fitsList(t, { project: 'p2' })).toBe(false)
    expect(fitsList(t, { project: 'p1', label: '3' })).toBe(true)
    expect(fitsList(t, { view: 'today' })).toBe(false)
    expect(fitsList(t, { view: 'nodate', priority_min: 15 })).toBe(false)
    // Server rules: views and loose lists hold open tasks; date windows are [due_after, due_before).
    expect(fitsList({ ...t, done: true }, { project: 'p1', done: false })).toBe(false)
    expect(fitsList({ ...t, due: at(1, 9) }, { view: 'overdue' })).toBe(true)
    expect(fitsList({ ...t, done: true, due: at(1, 9) }, { view: 'overdue' })).toBe(false)
    expect(fitsList({ ...t, due: at(6, 9) }, { due_after: at(6, 0), due_before: at(7, 0) })).toBe(true)
    expect(fitsList({ ...t, due: at(7, 0) }, { due_after: at(6, 0), due_before: at(7, 0) })).toBe(false)
  })
  it('settles a changed task into cached pages: leaves, joins in order, never past the loaded range', () => {
    const qc = new QueryClient()
    const mk = (id: string, position: number, done = false) => ({ id, title: id, description: '', project_id: 'p1', parent_id: null, bucket_id: null, due: null, done, done_at: done ? at(5, 9) : null, favorite: false, labels: [], priority: 10, assignees: [], position, created_on: at(1, 9), updated_on: at(1, 9) }) as unknown as Task
    const cursor = (t: Task) => btoa(JSON.stringify(['position', [t.position, t.created_on, t.id]])).replace(/=+$/, '')
    const openKey = ['tasks', 'list', { project: 'p1', done: false, sort: 'position' }, 'pages']
    const doneKey = ['tasks', 'list', { project: 'p1', done: true, sort: 'done' }]
    const [a, b] = [mk('a', 1), mk('b', 3)]
    qc.setQueryData(openKey, { pages: [{ items: [a, b], total: 9, next: cursor(b) }], pageParams: [null] })
    qc.setQueryData(doneKey, { items: [], total: 0, next: null })
    settleTaskLists(qc, { tasks: [{ ...a, done: true, done_at: at(6, 9) }, mk('c', 2), mk('z', 99)] })
    expect(listItems(qc.getQueryData(openKey)).map((t) => t.id)).toEqual(['c', 'b']) // a left, c joined between, z waits for its page
    expect(listTotal(qc.getQueryData(openKey))).toBe(9)
    expect(listItems(qc.getQueryData(doneKey)).map((t) => t.id)).toEqual(['a'])
    settleTaskLists(qc, { gone: ['b'] })
    expect(listItems(qc.getQueryData(openKey)).map((t) => t.id)).toEqual(['c'])
  })
  it('finds the days a calendar still needs, and drop positions between neighbours', () => {
    expect(rangeGaps([[10, 20]], 0, 30)).toEqual([[0, 10], [20, 30]])
    expect(rangeGaps([[0, 15], [15, 40]], 10, 30)).toEqual([])
    expect(positionsBetween(2, 1, 2)).toEqual([1 + 1 / 3, 1 + 2 / 3])
    expect(positionsBetween(1, 5)).toEqual([6])
  })
  it('nests loaded subtasks, keeps orphans as roots', () => {
    const { roots, kids } = nestTasks([{ id: 'a', parent_id: null }, { id: 'b', parent_id: 'a' }, { id: 'c', parent_id: 'zz' }])
    expect(roots.map((t) => t.id)).toEqual(['a', 'c'])
    expect(kids.get('a')!.map((t) => t.id)).toEqual(['b'])
  })
  it('reschedules keeping the time and the start offset; month window starts on Monday', () => {
    const r = rescheduleTo({ due: at(6, 17), start: at(5, 9) }, new Date(2026, 10, 10))!
    expect([new Date(r.due).getDate(), new Date(r.due).getHours(), new Date(r.start!).getDate()]).toEqual([10, 17, 9])
    expect(calendarRange(new Date(2026, 10, 1)).start.getDay()).toBe(1)
  })
  it('drops projects in the tree, never into their own subtree', () => {
    const p = (id: string, parent: string | null, position: number) => ({ id, parent_id: parent, position, name: id, is_inbox: false, archived: false, favorite: false }) as Project
    const list = [p('a', null, 1), p('b', null, 2), p('c', 'a', 1)]
    expect(treeDrop(list, list[0], list[2], 'inside', false)).toBeNull()
    expect(treeDrop(list, list[1], list[0], 'inside', false)).toEqual({ parent_id: 'a', position: 2 })
    expect(treeDrop(list, list[2], list[0], 'before', false)).toEqual({ parent_id: null, position: 0 })
  })
  it('adds filters on top of a saved view without dropping its own', () => {
    expect(withFilters({ label: '1', priority_min: 10 }, { label: '2', prio: 0, assignee: 'me' })).toEqual({ label: '1,2', priority_min: 10, assignee: 'me' })
  })
})
