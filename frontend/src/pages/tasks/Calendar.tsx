// Calendar layout: a month of due dates. Chips per day (time, priority dot, colour), "N more" expands a
// day, drag a chip to another day to reschedule (keeps the time, shifts the start), "+" adds a task on
// that day, and the selected day's agenda sits under the grid (the only list on phones, where days
// show priority dots). Tasks load by date range (the list's filters plus due_after/due_before): moving to
// the next month fetches only the days not loaded yet, never the overlap with what's on screen.
import { useEffect, useMemo, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { useQueries } from '@tanstack/react-query'
import { Icon } from '../../components/Icon'
import { hoverText } from '../../components/TaskRow'
import { toast } from '../../components/toast'
import { Button, ErrorBox, fieldClass, Input } from '../../components/ui'
import { get } from '../../lib/api'
import { cn } from '../../lib/cn'
import { addDays, dayKey, fmtDate, fmtTime, isEndOfDay, isSameDay, parseDayKey, startOfDay, startOfWeek } from '../../lib/dates'
import { keys, useCreateTask, useUpdateTask, type TaskQuery } from '../../lib/queries'
import { previewQuick } from '../../lib/quick'
import type { Label, Task, TaskPage } from '../../lib/types'
import { allowDrop, beginDrag, draggedId, leftTarget } from './dnd'
import { prioColour } from './priority'
import { RangeHeader } from './RangeHeader'
import { isOverdue, isTempId, rescheduleTo } from './task'

const MAX = 4 // chips in a day cell
const OPEN_MAX = 60 // chips in an expanded day (the agenda below lists the rest)
const AGENDA_MAX = 200 // rows in the selected day's agenda before "Show all"
const PAGE = 500
const MAX_PAGES = 8 // per range: 4000 tasks

/** The 6-week window shown for `month` (weeks start on Monday, like the rest of the app). */
export function calendarRange(month: Date): { start: Date; end: Date } {
  const start = startOfWeek(new Date(month.getFullYear(), month.getMonth(), 1))
  return { start, end: addDays(start, 42) }
}

/** A range query for a list: its filters without the date-window views, and done tasks included. */
export function calendarParams(base: TaskQuery, start: Date, end: Date): TaskQuery {
  const p: TaskQuery = { ...base, due_after: start.toISOString(), due_before: end.toISOString(), limit: PAGE, sort: 'due' }
  delete p.top_level
  if (p.done === false && p.project) delete p.done
  if (['today', 'upcoming', 'overdue', 'nodate'].includes(String(p.view))) delete p.view
  return p
}

/** Parts of [a, b) not covered by `have` (ranges as ms). */
export function rangeGaps(have: [number, number][], a: number, b: number): [number, number][] {
  const out: [number, number][] = []
  let at = a
  for (const [s, e] of [...have].sort((x, y) => x[0] - y[0])) {
    if (e <= at || s >= b) continue
    if (s > at) out.push([at, s])
    at = Math.max(at, e)
    if (at >= b) break
  }
  if (at < b) out.push([at, b])
  return out
}

/** One range, all its pages (bounded), as one cached list. */
const fetchRange = async (p: TaskQuery, signal: AbortSignal): Promise<TaskPage> => {
  const items: Task[] = []
  let cursor: string | null = null
  for (let i = 0; i < MAX_PAGES; i++) {
    const r: TaskPage = await get<TaskPage>('tasks/', cursor ? { ...p, cursor, count: false } : p, signal)
    items.push(...r.items)
    cursor = r.next ?? null
    if (!cursor) break
  }
  return { items, total: null, next: cursor }
}

const chipBase =
  'flex w-full min-w-0 cursor-pointer items-center gap-1.25 rounded-xs border-0 text-left leading-[1.25] shadow-[inset_2px_0_0_var(--tc)] [--tc:transparent]'
const chipTint =
  'bg-[color-mix(in_srgb,var(--app-accent)_8%,var(--app-surface))] hover:bg-[color-mix(in_srgb,var(--app-accent)_16%,var(--app-surface))] dark:bg-[color-mix(in_srgb,var(--app-accent)_16%,var(--app-surface))]'

export function Calendar({
  base,
  labels,
  projectId,
  hidden,
  onOpen,
  selected,
}: {
  base: TaskQuery
  labels?: Label[]
  projectId: string | null
  hidden: Set<string>
  onOpen: (t: Task) => void
  selected: string | null
}) {
  const today = startOfDay(new Date())
  const [month, setMonth] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1))
  const [sel, setSel] = useState(dayKey(today))
  const [expanded, setExpanded] = useState<string | null>(null)
  const [adding, setAdding] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [over, setOver] = useState<string | null>(null)
  const [agendaAll, setAgendaAll] = useState(false)
  const update = useUpdateTask()
  const create = useCreateTask()
  const { start, end } = calendarRange(month)
  // Loaded ranges for these filters; the window's missing part becomes one new range.
  const baseKey = JSON.stringify(base)
  const [ranges, setRanges] = useState<{ base: string; list: [number, number][] }>({ base: baseKey, list: [] })
  const have = ranges.base === baseKey ? ranges.list : []
  const gaps = rangeGaps(have, start.getTime(), end.getTime())
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the window or filters move and something is missing
  useEffect(() => {
    if (gaps.length) setRanges({ base: baseKey, list: [...have, ...gaps] })
  }, [baseKey, gaps.length, start.getTime()])
  const shown = [...have, ...gaps].filter(([a, b]) => a < end.getTime() && b > start.getTime())
  const rangeParams = shown.map(([a, b]) => calendarParams(base, new Date(a), new Date(b)))
  const results = useQueries({
    queries: rangeParams.map((p) => ({
      queryKey: keys.taskList(p),
      queryFn: ({ signal }: { signal: AbortSignal }) => fetchRange(p, signal),
    })),
  })
  const tasks = {
    isFetching: results.some((r) => r.isFetching),
    error: results.find((r) => r.error)?.error ?? null,
    hasData: results.some((r) => r.data),
    refetch: () => {
      for (const r of results) if (r.error) r.refetch()
    },
  }
  const dataStamp = results.map((r) => r.dataUpdatedAt).join()
  // biome-ignore lint/correctness/useExhaustiveDependencies: `results` is a new array each render; dataStamp changes when any range's data does
  const byDay = useMemo(() => {
    const m = new Map<string, Task[]>()
    const seen = new Set<string>()
    for (const r of results) {
      for (const t of r.data?.items ?? []) {
        if (!t.due || hidden.has(t.id) || seen.has(t.id)) continue
        seen.add(t.id)
        const k = dayKey(new Date(t.due))
        const list = m.get(k)
        if (list) list.push(t)
        else m.set(k, [t])
      }
    }
    for (const list of m.values()) list.sort((a, b) => Number(a.done) - Number(b.done) || (a.due ?? '').localeCompare(b.due ?? ''))
    return m
  }, [dataStamp, hidden])
  /** The cached range holding a day (an add there shows at once). */
  const keyFor = (d: Date) => {
    const i = shown.findIndex(([a, b]) => d.getTime() >= a && d.getTime() < b)
    return i >= 0 ? keys.taskList(rangeParams[i]) : undefined
  }

  const nav = (n: number) => {
    setMonth(new Date(month.getFullYear(), month.getMonth() + n, 1))
    setExpanded(null)
    setAgendaAll(false)
  }
  const add = (k: string) => {
    const t = text.trim()
    setText('')
    setAdding(null)
    if (!t) return
    const d = parseDayKey(k)
    d.setHours(23, 59, 0, 0)
    const pv = previewQuick(t)
    create.mutate({
      quick: pv.when ? t : `${t} ${k}`,
      body: { title: pv.title || t, project_id: projectId },
      listKey: keyFor(d),
      optimistic: { title: pv.title || t, project_id: projectId, due: pv.when ? null : d.toISOString() },
    })
  }
  const cancelAdd = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return
    e.stopPropagation()
    setText('')
    setAdding(null)
  }
  const drop = (id: string, k: string) => {
    setOver(null)
    const t = [...byDay.values()].flat().find((x) => x.id === id)
    if (!t) return
    const body = rescheduleTo(t, parseDayKey(k))
    if (!body) return
    update.mutate({ id: t.id, body })
    toast.show(`Rescheduled to ${fmtDate(parseDayKey(k), { weekday: 'short', month: 'short', day: 'numeric' })}`)
  }

  const chip = (t: Task, agenda = false) => {
    const d = new Date(t.due as string)
    return (
      <button
        key={t.id}
        type="button"
        draggable={!isTempId(t.id)}
        data-task={t.id}
        className={cn(
          chipBase,
          agenda ? 'px-2 py-1.25 text-sm' : 'px-1.25 py-0.5 text-xs',
          t.done ? 'bg-transparent text-muted line-through' : chipTint,
          isOverdue(t) ? 'text-danger' : !t.done && 'text-fg',
          t.id === selected && 'outline-2 -outline-offset-1 outline-accent',
        )}
        style={t.colour ? ({ '--tc': t.colour } as CSSProperties) : undefined}
        title={hoverText(t, labels?.filter((l) => t.labels.includes(l.id)) ?? [])}
        onClick={(e) => {
          e.stopPropagation()
          onOpen(t)
        }}
        onDragStart={(e) => beginDrag(e, 'task', t.id)}
      >
        <span className="size-1.75 flex-none rounded-full" style={{ background: prioColour(t.priority) }} />
        {!isEndOfDay(d) && <span className="flex-none text-muted tabular-nums">{fmtTime(d)}</span>}
        <span className="truncate">{t.title}</span>
      </button>
    )
  }

  if (tasks.error && !tasks.hasData) return <ErrorBox error={tasks.error} retry={() => tasks.refetch()} />
  const selItems = byDay.get(sel) ?? []
  const monthName = fmtDate(month, { month: 'long', year: 'numeric' })
  return (
    <div className="grid gap-2">
      <RangeHeader
        title={monthName}
        note={tasks.isFetching && <span className="text-xs text-muted">Loading…</span>}
        prev="Previous month"
        next="Next month"
        onPrev={() => nav(-1)}
        onNext={() => nav(1)}
        onToday={() => {
          setMonth(new Date(today.getFullYear(), today.getMonth(), 1))
          setSel(dayKey(today))
          setAgendaAll(false)
        }}
      />
      <div className="grid grid-cols-7 overflow-hidden rounded-md border border-border bg-surface">
        {Array.from({ length: 7 }, (_, i) => {
          const wd = fmtDate(addDays(start, i), { weekday: 'short' })
          return (
            <div
              key={wd}
              className="border-b border-border px-2 py-1.5 text-xs font-semibold text-muted max-md:px-0 max-md:py-1 max-md:text-center"
            >
              {wd}
            </div>
          )
        })}
        {Array.from({ length: 42 }, (_, i) => {
          const d = addDays(start, i)
          const k = dayKey(d)
          const items = byDay.get(k) ?? []
          const open = expanded === k
          const isToday = isSameDay(d, today)
          const out = d.getMonth() !== month.getMonth()
          return (
            // biome-ignore lint/a11y/noStaticElementInteractions: the whole cell picks the day for pointers; its date button is the keyboard control
            // biome-ignore lint/a11y/useKeyWithClickEvents: the whole cell picks the day for pointers; its date button is the keyboard control
            <div
              key={k}
              className={cn(
                'group/day flex min-h-28 min-w-0 cursor-default flex-col gap-0.5 border-border p-1 max-md:min-h-13 max-md:cursor-pointer max-md:items-center max-md:p-0.5',
                i % 7 !== 6 && 'border-r',
                i < 35 && 'border-b',
                over === k ? 'bg-accent-soft' : out && 'bg-[color-mix(in_srgb,var(--app-surface-2)_60%,var(--app-surface))]',
                k === sel && 'shadow-[inset_0_0_0_2px_color-mix(in_srgb,var(--app-accent)_55%,transparent)]',
              )}
              onClick={() => setSel(k)}
              onDragOver={(e) => {
                allowDrop(e)
                if (over !== k) setOver(k)
              }}
              onDragLeave={(e) => {
                if (leftTarget(e) && over === k) setOver(null)
              }}
              onDrop={(e) => {
                e.preventDefault()
                drop(draggedId(e, 'task'), k)
              }}
            >
              <div className="flex h-6 items-center justify-between">
                <button
                  type="button"
                  className={cn(
                    'inline-flex size-6 items-center justify-center rounded-full border-0 p-0 text-xs font-semibold tabular-nums',
                    isToday ? 'bg-accent text-white' : ['bg-transparent', out && 'text-muted'],
                  )}
                  aria-pressed={k === sel}
                  aria-label={fmtDate(d, { weekday: 'long', month: 'long', day: 'numeric' })}
                  onClick={(e) => {
                    e.stopPropagation()
                    setSel(k)
                  }}
                >
                  {d.getDate()}
                </button>
                <Button
                  variant="ghost"
                  size="sm"
                  icon
                  className="size-5.5! opacity-0 group-hover/day:opacity-100 focus-visible:opacity-100 max-md:hidden!"
                  aria-label={`Add task on ${fmtDate(d, { weekday: 'long', month: 'long', day: 'numeric' })}`}
                  onClick={(e) => {
                    e.stopPropagation()
                    setSel(k)
                    setAdding(k)
                    setText('')
                  }}
                >
                  <Icon name="plus" size={12} />
                </Button>
              </div>
              {adding === k && (
                // biome-ignore lint/a11y/useKeyWithClickEvents: keeps clicks in the field from selecting the day
                <form
                  onSubmit={(e) => {
                    e.preventDefault()
                    add(k)
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <input
                    className={cn(fieldClass.input, 'h-6! px-1.25! text-xs!')}
                    autoFocus
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    placeholder="New task"
                    maxLength={500}
                    aria-label="New task"
                    onBlur={() => add(k)}
                    onKeyDown={cancelAdd}
                  />
                </form>
              )}
              <div className={cn('grid min-w-0 gap-0.5', over === k ? 'max-md:grid' : 'max-md:hidden')}>
                {(open ? items.slice(0, OPEN_MAX) : items.slice(0, MAX)).map((t) => chip(t))}
                {!open && items.length > MAX && (
                  <button
                    type="button"
                    className="border-0 bg-transparent px-1.25 py-px text-left text-2xs text-muted hover:text-fg"
                    onClick={(e) => {
                      e.stopPropagation()
                      setSel(k)
                      setExpanded(k)
                      setAgendaAll(false)
                    }}
                  >
                    {items.length - MAX} more
                  </button>
                )}
                {open && items.length > OPEN_MAX && (
                  <span className="px-1.25 py-px text-2xs text-muted">{items.length - OPEN_MAX} more below</span>
                )}
              </div>
              {items.length > 0 && (
                <div className="mt-auto hidden justify-center gap-0.75 pb-0.5 max-md:flex" aria-hidden="true">
                  {items.slice(0, 5).map((t) => (
                    <span
                      key={t.id}
                      className={cn('size-1.75 flex-none rounded-full', t.done && 'opacity-35')}
                      style={{ background: prioColour(t.priority) }}
                    />
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
      <section className="grid gap-1 rounded-md border border-border bg-surface px-3 py-2.5" aria-label="Selected day">
        <h3 className="flex items-center gap-1.5 text-sm">
          {fmtDate(parseDayKey(sel), { weekday: 'long', month: 'long', day: 'numeric' })}{' '}
          <span className="text-muted">{selItems.length || ''}</span>
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto h-6!"
            onClick={() => {
              setAdding(`a:${sel}`)
              setText('')
            }}
          >
            <Icon name="plus" size={12} />
            Add
          </Button>
        </h3>
        {adding === `a:${sel}` && (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              add(sel)
            }}
          >
            <Input
              autoFocus
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder='New task, e.g. "Dentist 3pm !2"'
              maxLength={500}
              aria-label="New task"
              onBlur={() => add(sel)}
              onKeyDown={cancelAdd}
            />
          </form>
        )}
        {selItems.length ? (
          (agendaAll ? selItems : selItems.slice(0, AGENDA_MAX)).map((t) => chip(t, true))
        ) : (
          <p className="text-xs text-muted">Nothing due.</p>
        )}
        {!agendaAll && selItems.length > AGENDA_MAX && (
          <Button variant="ghost" size="sm" className="px-0! py-1!" onClick={() => setAgendaAll(true)}>
            Show all {selItems.length}
          </Button>
        )}
      </section>
    </div>
  )
}
