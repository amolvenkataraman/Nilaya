// Timeline (Gantt) layout: one row per dated task, a bar from start to due over a 6-week window that
// steps by 2 weeks. Drag a bar to shift both dates, drag an edge to change start or due (mouse/pen;
// touch taps open the task). Bars are buttons, so Tab + Enter opens the task drawer.
import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as RPointerEvent } from 'react'
import { toast } from '../../components/toast'
import { cn } from '../../lib/cn'
import { addDays, dayDiff, fmtDate, startOfDay, startOfWeek } from '../../lib/dates'
import { plural } from '../../lib/format'
import { useUpdateTask } from '../../lib/queries'
import type { Task, TaskPatch } from '../../lib/types'
import { prioColour } from './priority'
import { RangeHeader } from './RangeHeader'
import { isOverdue, isTempId } from './task'

const DAYS = 42
const STEP = 14
type Edge = 'move' | 'start' | 'end'

/** [first day, last day] of a task's bar (local midnight), or null when it has no dates. */
export function taskSpan(t: Pick<Task, 'start' | 'due'>): [Date, Date] | null {
  const a = t.start ?? t.due
  const b = t.due ?? t.start
  if (!a || !b) return null
  const s = startOfDay(new Date(a))
  const e = startOfDay(new Date(b))
  return e < s ? [e, s] : [s, e]
}

const shift = (iso: string, n: number) => {
  const d = new Date(iso)
  d.setDate(d.getDate() + n) // calendar days: keeps the wall-clock time across DST changes
  return d.toISOString()
}

/** The PATCH for dragging `edge` by `delta` days, or an error message. Pure, for predictable drops. */
export function dragPatch(t: Pick<Task, 'start' | 'due'>, edge: Edge, delta: number): TaskPatch | string {
  const body: TaskPatch = {}
  if (edge === 'move') {
    if (t.due) body.due = shift(t.due, delta)
    if (t.start) body.start = shift(t.start, delta)
  } else if (edge === 'end') {
    if (t.due) body.due = shift(t.due, delta)
    else if (t.start) {
      const d = new Date(shift(t.start, delta))
      d.setHours(23, 59, 0, 0)
      body.due = d.toISOString()
    }
  } else {
    if (t.start) body.start = shift(t.start, delta)
    else if (t.due) {
      const d = startOfDay(new Date(t.due))
      d.setDate(d.getDate() + delta)
      d.setHours(9, 0, 0, 0)
      body.start = d.toISOString()
    }
  }
  const s = body.start ?? t.start
  const e = body.due ?? t.due
  if (s && e && new Date(s) > new Date(e)) return 'The start must be before the due date.'
  return body
}

/** Sticky header cells and the name column sit on the surface, above the bars. */
const sticky = 'sticky bg-surface'
const handle =
  'absolute inset-y-0 z-1 w-1.75 cursor-ew-resize touch:hidden after:absolute after:inset-y-1.25 after:left-[0.15rem] after:w-0.5 after:rounded-[1px] after:bg-(--c) after:opacity-0 after:transition-opacity after:duration-100 group-hover/bar:after:opacity-60'

export function Timeline({ tasks, onOpen, selected }: { tasks: Task[]; onOpen: (t: Task) => void; selected: string | null }) {
  const today = startOfDay(new Date())
  const home = addDays(startOfWeek(today), -7)
  const [start, setStart] = useState(home)
  const end = addDays(start, DAYS)
  const update = useUpdateTask()
  const [drag, setDrag] = useState<{ id: string; edge: Edge; delta: number } | null>(null)
  const justDragged = useRef(false)
  const scroller = useRef<HTMLDivElement>(null)
  const dayCell = useRef<HTMLDivElement>(null)
  const startMs = start.getTime()

  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed by the window's start time (a new Date each render)
  const { rows, undated, outside } = useMemo(() => {
    const out: { t: Task; s: Date; e: Date }[] = []
    let undated = 0
    let outside = 0
    for (const t of tasks) {
      const sp = taskSpan(t)
      if (!sp) {
        if (!t.done) undated++
        continue
      }
      if (sp[1] < start || sp[0] >= end) {
        outside++
        continue
      }
      out.push({ t, s: sp[0], e: sp[1] })
    }
    out.sort((a, b) => a.s.getTime() - b.s.getTime() || a.e.getTime() - b.e.getTime() || a.t.title.localeCompare(b.t.title))
    return { rows: out, undated, outside }
  }, [tasks, startMs])

  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed by the window's start time
  const days = useMemo(() => Array.from({ length: DAYS }, (_, i) => addDays(start, i)), [startMs])
  const months = useMemo(() => {
    const out: { label: string; from: number; span: number }[] = []
    days.forEach((d, i) => {
      if (i === 0 || d.getDate() === 1) {
        const left = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate() - d.getDate() + 1
        out.push({ label: fmtDate(d, { month: 'long', year: 'numeric' }), from: i, span: Math.min(left, DAYS - i) })
      }
    })
    return out
  }, [days])
  const todayIdx = dayDiff(start, today)

  // Narrow screens scroll sideways: bring today into view (when it's in this window and hidden).
  const hasRows = rows.length > 0
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-centres when the window moves or the grid appears
  useLayoutEffect(() => {
    const el = scroller.current
    const cell = dayCell.current
    if (!el || !cell || el.scrollWidth <= el.clientWidth) return
    const w = cell.getBoundingClientRect().width
    const name = cell.offsetLeft // the sticky name column's width
    const x = name + todayIdx * w
    const inView = x >= el.scrollLeft + name && x + w <= el.scrollLeft + el.clientWidth
    if (todayIdx >= 0 && todayIdx < DAYS && !inView) el.scrollLeft = Math.max(0, (todayIdx - 1) * w)
    else if (todayIdx < 0 || todayIdx >= DAYS) el.scrollLeft = 0
  }, [startMs, hasRows])

  const onPointerDown = (e: RPointerEvent<HTMLButtonElement>, t: Task) => {
    if (e.button !== 0 || e.pointerType === 'touch' || isTempId(t.id)) return
    const edge = ((e.target as HTMLElement).dataset.edge as Edge | undefined) ?? 'move'
    const dayW = dayCell.current?.getBoundingClientRect().width || 24
    const el = e.currentTarget
    const x0 = e.clientX
    let delta = 0
    let moved = false
    let shown = false
    el.setPointerCapture(e.pointerId)
    const move = (ev: PointerEvent) => {
      if (!moved && Math.abs(ev.clientX - x0) < 4) return
      moved = true
      const d = Math.round((ev.clientX - x0) / dayW)
      if (d !== delta || !shown) {
        shown = true
        delta = d
        setDrag({ id: t.id, edge, delta: d })
      }
    }
    const up = () => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
      setDrag(null)
      if (!moved) return // the click that follows opens the task
      justDragged.current = true
      setTimeout(() => {
        justDragged.current = false
      }, 0)
      if (!delta) return
      const body = dragPatch(t, edge, delta)
      if (typeof body === 'string') return toast.error(body)
      update.mutate({ id: t.id, body })
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
    e.preventDefault()
  }

  return (
    <div className="grid gap-2">
      <RangeHeader
        title={`${fmtDate(start, { month: 'short', day: 'numeric' })} – ${fmtDate(addDays(end, -1), { month: 'short', day: 'numeric', year: 'numeric' })}`}
        note={
          <span className="text-xs text-muted max-md:order-3 max-md:basis-full">
            {[undated ? `${plural(undated, 'undated task')} not shown` : '', outside ? `${outside} outside this range` : '']
              .filter(Boolean)
              .join(' · ')}
          </span>
        }
        prev="Two weeks earlier"
        next="Two weeks later"
        onPrev={() => setStart(addDays(start, -STEP))}
        onNext={() => setStart(addDays(start, STEP))}
        onToday={() => setStart(home)}
        todayDisabled={startMs === home.getTime()}
      />
      {rows.length === 0 ? (
        <div className="px-4 py-12 text-center text-sm text-muted">
          No tasks with dates in this range. Give tasks a start or due date to plan them here.
        </div>
      ) : (
        <div
          className="max-h-[calc(100dvh-12rem)] overflow-auto rounded-md border border-border bg-surface max-md:max-h-[calc(100dvh-13rem)]"
          ref={scroller}
        >
          <div
            className="relative grid min-w-min grid-cols-[var(--tl-name)_repeat(42,minmax(var(--tl-day),1fr))] overflow-clip [--tl-day:1.125rem] [--tl-name:13rem] max-md:[--tl-day:1.75rem] max-md:[--tl-name:7.5rem]"
            style={{ gridTemplateRows: `auto auto repeat(${rows.length}, 2.25rem)` }}
          >
            <div
              className={cn(
                sticky,
                'top-0 left-0 z-4 col-1 row-[1/3] flex items-end border-r border-b border-border px-3 py-1.5 text-xs font-semibold text-muted',
              )}
            >
              Task
            </div>
            {months.map((m) => (
              <div
                key={m.from}
                className={cn(
                  sticky,
                  'top-0 z-3 row-1 overflow-clip pt-1.5 pb-0.5 text-xs font-semibold whitespace-nowrap shadow-[inset_1px_0_0_var(--app-border)]',
                )}
                style={{ gridColumn: `${m.from + 2} / span ${m.span}` }}
              >
                <span className="sticky left-[calc(var(--tl-name)+0.375rem)] px-1.5">{m.label}</span>
              </div>
            ))}
            {days.map((d, i) => {
              const we = d.getDay() === 0 || d.getDay() === 6
              const isToday = i === todayIdx
              return (
                <div
                  key={d.getTime()}
                  ref={i === 0 ? dayCell : undefined}
                  className={cn(
                    'sticky',
                    'top-[1.5625rem] z-3 row-2 grid justify-items-center border-b border-border pt-px pb-1 text-2xs leading-[1.25] tabular-nums',
                    we ? 'bg-[color-mix(in_srgb,var(--app-surface-2)_70%,var(--app-surface))]' : 'bg-surface',
                    isToday ? 'font-bold text-accent' : we ? 'text-muted' : 'text-fg',
                  )}
                  style={{ gridColumn: i + 2 }}
                  title={fmtDate(d, { weekday: 'long', month: 'long', day: 'numeric' })}
                >
                  <span className={cn('text-3xs', isToday ? 'text-accent' : 'text-muted')}>{fmtDate(d, { weekday: 'narrow' })}</span>
                  {d.getDate()}
                </div>
              )
            })}
            {days.map(
              (d, i) =>
                (d.getDay() === 0 || d.getDay() === 6 || d.getDay() === 1) && (
                  <div
                    key={`c${d.getTime()}`}
                    className={cn(
                      'pointer-events-none row-[3/-1]',
                      d.getDay() === 1
                        ? 'shadow-[inset_1px_0_0_var(--app-border)]'
                        : 'bg-[color-mix(in_srgb,var(--app-surface-2)_70%,transparent)]',
                    )}
                    style={{ gridColumn: i + 2 }}
                    aria-hidden="true"
                  />
                ),
            )}
            {todayIdx >= 0 && todayIdx < DAYS && (
              <div
                className="pointer-events-none z-1 row-[2/-1] w-0.5 justify-self-center rounded-[1px] bg-accent opacity-70"
                style={{ gridColumn: todayIdx + 2 }}
                aria-hidden="true"
              />
            )}
            {rows.map(({ t, s, e }, r) => {
              const row = r + 3
              let from = dayDiff(start, s)
              let to = dayDiff(start, e)
              const dragging = drag?.id === t.id
              if (drag && dragging) {
                if (drag.edge !== 'end') from += drag.delta
                if (drag.edge !== 'start') to += drag.delta
                if (from > to) [from, to] = drag.edge === 'start' ? [to, to] : [from, from]
              }
              const clipL = from < 0
              const clipR = to > DAYS - 1
              from = Math.max(0, Math.min(DAYS - 1, from))
              to = Math.max(from, Math.min(DAYS - 1, to))
              const overdue = isOverdue(t)
              const short = to - from < 3
              const sel = t.id === selected
              const range = `${t.start ? `${fmtDate(new Date(t.start), { month: 'short', day: 'numeric' })} → ` : ''}${t.due ? fmtDate(new Date(t.due), { month: 'short', day: 'numeric' }) : 'no due date'}`
              const colour = t.colour || prioColour(t.priority)
              return [
                <div
                  key={`r${t.id}`}
                  className={cn(
                    'pointer-events-none col-[1/-1] border-b border-border',
                    sel && 'bg-[color-mix(in_srgb,var(--app-accent-soft)_70%,transparent)]',
                  )}
                  style={{ gridRow: row }}
                  aria-hidden="true"
                />,
                <button
                  key={`n${t.id}`}
                  type="button"
                  className={cn(
                    sticky,
                    'left-0 z-2 col-1 flex min-w-0 items-center gap-2 border-0 border-r border-b border-solid border-border px-3 text-left text-sm text-fg hover:bg-[color-mix(in_srgb,var(--app-fg)_4%,var(--app-surface))] max-md:px-2 max-md:text-xs',
                  )}
                  style={{ gridRow: row }}
                  onClick={() => onOpen(t)}
                  title={t.title}
                >
                  <span className="size-2 flex-none rounded-full" style={{ background: colour }} />
                  <span className={cn('truncate', t.done && 'text-muted line-through')}>{t.title}</span>
                </button>,
                <button
                  key={`b${t.id}`}
                  type="button"
                  className={cn(
                    'group/bar relative z-1 mx-0.5 flex h-6 min-w-0 cursor-grab touch-pan-x touch-pan-y items-center self-center rounded-[0.375rem] border px-2 text-left text-xs text-fg transition-[box-shadow,background-color] duration-120 touch:cursor-pointer',
                    'bg-[color-mix(in_srgb,var(--c)_16%,var(--app-surface))] hover:bg-[color-mix(in_srgb,var(--c)_24%,var(--app-surface))] dark:bg-[color-mix(in_srgb,var(--c)_22%,var(--app-surface))] dark:hover:bg-[color-mix(in_srgb,var(--c)_22%,var(--app-surface))]',
                    overdue
                      ? 'border-danger shadow-[inset_3px_0_0_var(--app-danger)]'
                      : 'border-[color-mix(in_srgb,var(--c)_45%,transparent)]',
                    !overdue &&
                      (dragging ? 'shadow-[inset_3px_0_0_var(--c),0_4px_12px_rgba(16,24,40,.16)]' : 'shadow-[inset_3px_0_0_var(--c)]'),
                    dragging && 'z-2 cursor-grabbing',
                    sel && 'outline-2 outline-offset-1 outline-accent',
                    t.done && 'opacity-55',
                    clipL && 'rounded-l-none [border-left-style:dashed]',
                    clipR && 'rounded-r-none [border-right-style:dashed]',
                  )}
                  data-task={t.id}
                  style={{ gridRow: row, gridColumn: `${from + 2} / ${to + 3}`, '--c': colour } as CSSProperties}
                  aria-label={`${t.title}, ${range}${overdue ? ', overdue' : ''}${t.done ? ', completed' : ''}. Open details`}
                  title={`${t.title}\n${range}\nDrag to move, drag an edge to change the start or due date`}
                  onPointerDown={(ev) => onPointerDown(ev, t)}
                  onClick={() => {
                    if (!justDragged.current) onOpen(t)
                  }}
                >
                  {!clipL && <span className={cn(handle, '-left-px')} data-edge="start" aria-hidden="true" />}
                  <span
                    className={cn(
                      'pointer-events-none min-w-0 text-ellipsis whitespace-nowrap',
                      short ? 'absolute left-[calc(100%+0.375rem)] max-w-56 overflow-visible' : 'overflow-hidden',
                      overdue ? 'text-danger' : short && 'text-muted',
                      t.done && 'line-through',
                    )}
                  >
                    {t.title}
                  </span>
                  {!clipR && <span className={cn(handle, '-right-px')} data-edge="end" aria-hidden="true" />}
                </button>,
              ]
            })}
          </div>
        </div>
      )}
    </div>
  )
}
