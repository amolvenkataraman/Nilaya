// Timeline (Gantt) layout: one row per dated task, a bar from start to due over a 6-week window that
// steps by 2 weeks. Drag a bar to shift both dates, drag an edge to change start or due (mouse/pen;
// touch taps open the task). Bars are buttons, so Tab + Enter opens the task drawer.
import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as RPointerEvent } from 'react'
import { Icon } from '../../components/Icon'
import { toast } from '../../components/toast'
import { useUpdateTask } from '../../lib/queries'
import { addDays, dayDiff, fmtDate, isEndOfDay, startOfDay, startOfWeek } from '../../lib/dates'
import type { Task, TaskPatch } from '../../lib/types'
import { plural } from './api'

const DAYS = 42
const STEP = 14
type Edge = 'move' | 'start' | 'end'

const prioLevel = (p: number) => (p >= 20 ? 20 : p >= 15 ? 15 : p >= 10 ? 10 : 5)
const PRIO_COLOUR: Record<number, string> = { 5: 'var(--app-muted)', 10: 'var(--app-accent)', 15: 'var(--app-warning)', 20: 'var(--app-danger)' }

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

  const { rows, undated, outside } = useMemo(() => {
    const out: { t: Task; s: Date; e: Date }[] = []
    let undated = 0
    let outside = 0
    for (const t of tasks) {
      const sp = taskSpan(t)
      if (!sp) { if (!t.done) undated++; continue }
      if (sp[1] < start || sp[0] >= end) { outside++; continue }
      out.push({ t, s: sp[0], e: sp[1] })
    }
    out.sort((a, b) => a.s.getTime() - b.s.getTime() || a.e.getTime() - b.e.getTime() || a.t.title.localeCompare(b.t.title))
    return { rows: out, undated, outside }
  }, [tasks, start.getTime()]) // eslint-disable-line react-hooks/exhaustive-deps

  const days = useMemo(() => Array.from({ length: DAYS }, (_, i) => addDays(start, i)), [start.getTime()]) // eslint-disable-line react-hooks/exhaustive-deps
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
  }, [start.getTime(), rows.length > 0]) // eslint-disable-line react-hooks/exhaustive-deps

  const onPointerDown = (e: RPointerEvent<HTMLButtonElement>, t: Task) => {
    if (e.button !== 0 || e.pointerType === 'touch' || t.id.startsWith('temp-')) return
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
      if (d !== delta || !shown) { shown = true; delta = d; setDrag({ id: t.id, edge, delta: d }) }
    }
    const up = () => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
      setDrag(null)
      if (!moved) return // the click that follows opens the task
      justDragged.current = true
      setTimeout(() => (justDragged.current = false), 0)
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
    <div className="tl">
      <div className="tl-head">
        <h2 className="tl-range">{fmtDate(start, { month: 'short', day: 'numeric' })} – {fmtDate(addDays(end, -1), { month: 'short', day: 'numeric', year: 'numeric' })}</h2>
        <span className="muted xsmall tl-note">
          {[undated ? `${plural(undated, 'undated task')} not shown` : '', outside ? `${outside} outside this range` : ''].filter(Boolean).join(' · ')}
        </span>
        <span className="spacer" />
        <div className="tl-nav">
          <button className="btn sm icon" onClick={() => setStart(addDays(start, -STEP))} aria-label="Two weeks earlier" title="Two weeks earlier"><Icon name="chevronLeft" size={14} /></button>
          <button className="btn sm" onClick={() => setStart(home)} disabled={start.getTime() === home.getTime()}>Today</button>
          <button className="btn sm icon" onClick={() => setStart(addDays(start, STEP))} aria-label="Two weeks later" title="Two weeks later"><Icon name="chevronRight" size={14} /></button>
        </div>
      </div>
      {rows.length === 0 ? (
        <div className="empty tasks-empty">No tasks with dates in this range. Give tasks a start or due date to plan them here.</div>
      ) : (
        <div className="tl-scroll" ref={scroller}>
          <div className="tl-grid" style={{ '--days': DAYS, gridTemplateRows: `auto auto repeat(${rows.length}, 2.25rem)` } as CSSProperties}>
            <div className="tl-corner">Task</div>
            {months.map((m) => (
              <div key={m.from} className="tl-month" style={{ gridColumn: `${m.from + 2} / span ${m.span}` }}><span>{m.label}</span></div>
            ))}
            {days.map((d, i) => {
              const we = d.getDay() === 0 || d.getDay() === 6
              return (
                <div key={i} ref={i === 0 ? dayCell : undefined} className={'tl-day' + (we ? ' we' : '') + (i === todayIdx ? ' today' : '') + (d.getDay() === 1 ? ' wk' : '')}
                  style={{ gridColumn: i + 2 }} title={fmtDate(d, { weekday: 'long', month: 'long', day: 'numeric' })}>
                  <span className="tl-wd">{fmtDate(d, { weekday: 'narrow' })}</span>{d.getDate()}
                </div>
              )
            })}
            {days.map((d, i) => (d.getDay() === 0 || d.getDay() === 6 || d.getDay() === 1) && (
              <div key={'c' + i} className={'tl-col' + (d.getDay() === 1 ? ' wk' : ' we')} style={{ gridColumn: i + 2 }} aria-hidden="true" />
            ))}
            {todayIdx >= 0 && todayIdx < DAYS && <div className="tl-now" style={{ gridColumn: todayIdx + 2 }} aria-hidden="true" />}
            {rows.map(({ t, s, e }, r) => {
              const row = r + 3
              let from = dayDiff(start, s)
              let to = dayDiff(start, e)
              if (drag?.id === t.id) {
                if (drag.edge !== 'end') from += drag.delta
                if (drag.edge !== 'start') to += drag.delta
                if (from > to) [from, to] = drag.edge === 'start' ? [to, to] : [from, from]
              }
              const clipL = from < 0
              const clipR = to > DAYS - 1
              from = Math.max(0, Math.min(DAYS - 1, from))
              to = Math.max(from, Math.min(DAYS - 1, to))
              const overdue = !t.done && !!t.due && (new Date(t.due) < new Date()) && (dayDiff(new Date(), new Date(t.due)) < 0 || !isEndOfDay(new Date(t.due)))
              const short = to - from < 3
              const range = `${t.start ? fmtDate(new Date(t.start), { month: 'short', day: 'numeric' }) + ' → ' : ''}${t.due ? fmtDate(new Date(t.due), { month: 'short', day: 'numeric' }) : 'no due date'}`
              const cls = 'tl-bar p' + prioLevel(t.priority) + (t.done ? ' done' : '') + (overdue ? ' overdue' : '') + (short ? ' short' : '') +
                (clipL ? ' clip-l' : '') + (clipR ? ' clip-r' : '') + (drag?.id === t.id ? ' dragging' : '') + (t.id === selected ? ' sel' : '')
              return [
                <div key={'r' + t.id} className={'tl-rowline' + (t.id === selected ? ' sel' : '')} style={{ gridRow: row }} aria-hidden="true" />,
                <button key={'n' + t.id} className={'tl-name' + (t.done ? ' done' : '')} style={{ gridRow: row }} onClick={() => onOpen(t)} title={t.title}>
                  <span className="tl-dot" style={{ background: t.colour || PRIO_COLOUR[prioLevel(t.priority)] }} />
                  <span className="truncate">{t.title}</span>
                </button>,
                <button
                  key={'b' + t.id}
                  type="button"
                  className={cls}
                  data-task={t.id}
                  style={{ gridRow: row, gridColumn: `${from + 2} / ${to + 3}`, '--c': t.colour || PRIO_COLOUR[prioLevel(t.priority)] } as CSSProperties}
                  aria-label={`${t.title}, ${range}${overdue ? ', overdue' : ''}${t.done ? ', completed' : ''}. Open details`}
                  title={`${t.title}\n${range}\nDrag to move, drag an edge to change the start or due date`}
                  onPointerDown={(ev) => onPointerDown(ev, t)}
                  onClick={() => { if (!justDragged.current) onOpen(t) }}
                >
                  {!clipL && <span className="tl-h l" data-edge="start" aria-hidden="true" />}
                  <span className="tl-bar-t">{t.title}</span>
                  {!clipR && <span className="tl-h r" data-edge="end" aria-hidden="true" />}
                </button>,
              ]
            })}
          </div>
        </div>
      )}
    </div>
  )
}

/** Small "timeline" glyph for the layout switch (the shared icon set has none). */
