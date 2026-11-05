import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '../../components/Icon'
import { dayKey, fmtDate, fmtTime, isSameDay } from '../../lib/dates'
import type { CalEvent, Task } from '../../lib/types'
import { BirthdayChip, PhotoBadge, TaskChip, isAllDayTask, type Birthday } from './extras'
import { EventChip } from './MonthView'
import { atWallMin, layoutDay, snap } from './util'

interface Props {
  days: Date[]
  byDay: Map<string, CalEvent[]>
  colour: (e: CalEvent) => string
  now: Date
  onCreate: (start: Date, end?: Date, allDay?: boolean) => void
  onEvent: (e: CalEvent) => void
  onOpenDay: (d: Date) => void
  tasksByDay?: Map<string, Task[]>
  photos?: Record<string, number>
  onTask?: (t: Task) => void
  birthdaysByDay?: Map<string, Birthday[]>
  /** Events the user may drag (move / resize). */
  canEdit?: (e: CalEvent) => boolean
  /** Drag-moved or resized: the new start and end. */
  onMove?: (e: CalEvent, start: Date, end: Date | null) => void
}

// Mouse/pen drag on the time grid: drag empty space to create a range, drag an event to move it
// (also to another day), drag its bottom edge to resize. Touch keeps tap-to-create (scrolling wins).
type Drag = { mode: 'create' | 'move' | 'resize'; ev?: CalEvent; day: number; origDay: number; a: number; b: number; anchor: number; origStart: number; moved: boolean; x0: number; y0: number }
const Q = 15
const snapQ = (m: number) => Math.max(0, Math.min(1440, Math.round(m / Q) * Q))
const minLabel = (m: number) => fmtTime(new Date(2000, 0, 1, 0, m))

const hourFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric' })
const HOURS = Array.from({ length: 24 }, (_, h) => h)

export function WeekView({ days, byDay, colour, now, onCreate, onEvent, onOpenDay, tasksByDay, photos, onTask, birthdaysByDay, canEdit, onMove }: Props) {
  const scroller = useRef<HTMLDivElement>(null)
  const body = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<Drag | null>(null)
  const dragRef = useRef<Drag | null>(null)
  const suppress = useRef(false)
  const cb = useRef({ days, onCreate, onMove })
  cb.current = { days, onCreate, onMove }
  const stop = useRef<() => void>(() => {})
  useEffect(() => () => stop.current(), [])

  function locate(e: { clientX: number; clientY: number }) {
    const cols = Array.from(body.current?.querySelectorAll<HTMLElement>('.day-col') ?? [])
    if (!cols.length) return { day: 0, min: 0 }
    let day = cols.findIndex((c) => { const r = c.getBoundingClientRect(); return e.clientX >= r.left && e.clientX < r.right })
    if (day < 0) day = e.clientX < cols[0].getBoundingClientRect().left ? 0 : cols.length - 1
    const r = cols[0].getBoundingClientRect()
    return { day, min: Math.max(0, Math.min(1440, ((e.clientY - r.top) / r.height) * 1440)) }
  }

  function onPointerDown(pe: React.PointerEvent) {
    if (pe.button !== 0 || pe.pointerType === 'touch' || dragRef.current) return
    const t = pe.target as HTMLElement
    if (t.closest('.ev-task, .chip-task, .now-line')) return
    const { day, min } = locate(pe)
    const evEl = t.closest<HTMLElement>('[data-ev]')
    let d: Drag
    if (evEl) {
      const ev = placed[day]?.find((p) => p.event.id === evEl.dataset.ev)
      if (!ev || !canEdit?.(ev.event) || !onMove) return
      const resize = !!t.closest('.ev-resize')
      d = { mode: resize ? 'resize' : 'move', ev: ev.event, day, origDay: day, a: ev.startMin, b: ev.endMin, anchor: min - ev.startMin, origStart: ev.startMin, moved: false, x0: pe.clientX, y0: pe.clientY }
    } else {
      if (!t.closest('.day-col')) return
      const m0 = Math.floor(min / Q) * Q
      d = { mode: 'create', day, origDay: day, a: m0, b: m0 + Q, anchor: m0, origStart: m0, moved: false, x0: pe.clientX, y0: pe.clientY }
    }
    dragRef.current = d
    const move = (e: PointerEvent) => {
      const c = dragRef.current
      if (!c) return
      if (!c.moved && Math.hypot(e.clientX - c.x0, e.clientY - c.y0) < 6) return
      e.preventDefault()
      const { day: dy, min: m } = locate(e)
      let next: Drag
      if (c.mode === 'create') {
        const s = snapQ(m)
        next = { ...c, moved: true, a: Math.min(c.anchor, s), b: Math.max(c.anchor + Q, s) }
      } else if (c.mode === 'move') {
        const dur = c.b - c.a
        const a = Math.max(0, Math.min(1440 - Math.min(dur, 1440), snapQ(m - c.anchor)))
        next = { ...c, moved: true, day: dy, a, b: a + dur }
      } else {
        next = { ...c, moved: true, b: Math.max(c.a + Q, snapQ(m)) }
      }
      dragRef.current = next
      setDrag(next)
    }
    const up = () => {
      const c = dragRef.current
      stop.current()
      if (!c?.moved) return
      suppress.current = true
      setTimeout(() => (suppress.current = false), 0)
      const { days: ds, onCreate: create, onMove: moved } = cb.current
      // Wall-clock minutes → local times (right on DST change days too).
      const day = ds[c.day]
      if (c.mode === 'create') return create(atWallMin(day, c.a), atWallMin(day, c.b))
      const ev = c.ev!
      const s = new Date(ev.start)
      if (c.mode === 'resize') return moved?.(ev, s, atWallMin(day, c.b))
      const ns = new Date(s)
      ns.setDate(ns.getDate() + (c.day - c.origDay))
      ns.setMinutes(ns.getMinutes() + (c.a - c.origStart))
      if (ns.getTime() === s.getTime()) return
      moved?.(ev, ns, ev.end ? new Date(ns.getTime() + (new Date(ev.end).getTime() - s.getTime())) : null)
    }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); dragRef.current = null; stop.current() } }
    stop.current = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('keydown', key, true)
      dragRef.current = null
      setDrag(null)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('keydown', key, true)
  }
  const rangeKey = dayKey(days[0]) + days.length
  const showsToday = days.some((d) => isSameDay(d, now))

  // Scroll to the working day (or to just before now) when the range changes.
  useLayoutEffect(() => {
    const el = scroller.current
    if (!el) return
    const hour = showsToday ? Math.max(0, Math.min(now.getHours() - 1.5, 16)) : 7.5
    el.scrollTop = (el.scrollHeight / 24) * hour - 4
  }, [rangeKey])

  const allDay = useMemo(() => days.map((d) => (byDay.get(dayKey(d)) ?? []).filter((e) => e.all_day)), [days, byDay])
  const placed = useMemo(() => days.map((d) => layoutDay(byDay.get(dayKey(d)) ?? [], d)), [days, byDay])
  const dayTasks = useMemo(() => days.map((d) => tasksByDay?.get(dayKey(d)) ?? []), [days, tasksByDay])
  const dayBdays = useMemo(() => days.map((d) => birthdaysByDay?.get(dayKey(d)) ?? []), [days, birthdaysByDay])
  const anyAllDay = allDay.some((l) => l.length) || dayTasks.some((l) => l.some(isAllDayTask)) || dayBdays.some((l) => l.length)
  const nowMin = now.getHours() * 60 + now.getMinutes()

  return (
    <div className="week" style={{ '--cols': days.length } as React.CSSProperties}>
      <div className="week-head">
        <div className="gutter" aria-hidden="true" />
        {days.map((d) => {
          const t = isSameDay(d, now)
          return (
            <div key={d.getTime()} className="week-day-wrap">
              <button type="button" className={'week-day' + (t ? ' today' : '')} onClick={() => onOpenDay(d)} aria-label={fmtDate(d, { weekday: 'long', month: 'long', day: 'numeric' })}>
                <span className="wd">{fmtDate(d, { weekday: 'short' })}</span>
                <span className="dn tabular">{d.getDate()}</span>
              </button>
              <PhotoBadge day={d} count={photos?.[dayKey(d)]} />
            </div>
          )
        })}
      </div>
      <div className={'week-allday' + (anyAllDay ? '' : ' empty-row')}>
        <div className="gutter xsmall muted">all-day</div>
        {days.map((d, i) => (
          <div key={d.getTime()} className="allday-cell" onClick={() => onCreate(d, undefined, true)}>
            {dayBdays[i].map((b) => <BirthdayChip key={b.id} b={b} />)}
            {allDay[i].map((e) => <EventChip key={e.id} e={e} day={d} colour={colour(e)} onClick={() => onEvent(e)} />)}
            {dayTasks[i].filter(isAllDayTask).map((t) => <TaskChip key={t.id} task={t} onOpen={(x) => onTask?.(x)} />)}
          </div>
        ))}
      </div>
      <div className="week-scroll" ref={scroller}>
        <div className={'week-body' + (drag ? ' dragging' : '')} ref={body} onPointerDown={onPointerDown}
          onClickCapture={(e) => { if (suppress.current) { suppress.current = false; e.stopPropagation(); e.preventDefault() } }}>
          <div className="gutter hours" aria-hidden="true">
            {HOURS.map((h) => (
              <span key={h} style={{ top: `${(h / 24) * 100}%` }}>{h === 0 ? '' : hourFmt.format(new Date(2000, 0, 1, h))}</span>
            ))}
          </div>
          {days.map((d, i) => (
            <DayColumn key={d.getTime()} day={d} items={placed[i]} colour={colour} onEvent={onEvent} onCreate={onCreate} nowMin={isSameDay(d, now) ? nowMin : null}
              tasks={dayTasks[i].filter((t) => !isAllDayTask(t))} onTask={onTask} canEdit={onMove ? canEdit : undefined}
              ghost={drag?.moved && drag.day === i ? { a: drag.a, b: drag.b, colour: drag.ev ? colour(drag.ev) : 'var(--app-accent)', name: drag.ev?.name ?? '' } : null}
              draggingId={drag?.moved && drag.mode === 'move' ? drag.ev?.id : undefined} />
          ))}
        </div>
      </div>
    </div>
  )
}

function DayColumn({ day, items, colour, onEvent, onCreate, nowMin, tasks, onTask, canEdit, ghost, draggingId }: {
  day: Date; items: ReturnType<typeof layoutDay>; colour: (e: CalEvent) => string; onEvent: (e: CalEvent) => void
  onCreate: (start: Date, end?: Date) => void; nowMin: number | null; tasks: Task[]; onTask?: (t: Task) => void
  canEdit?: (e: CalEvent) => boolean; ghost: { a: number; b: number; colour: string; name: string } | null; draggingId?: string
}) {
  const col = useRef<HTMLDivElement>(null)
  return (
    <div
      ref={col}
      className="day-col"
      onClick={(e) => {
        const r = col.current!.getBoundingClientRect()
        const min = snap(((e.clientY - r.top) / r.height) * 1440 - 15)
        const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, min)
        onCreate(start, new Date(start.getTime() + 3600_000))
      }}
    >
      {items.map(({ event: e, startMin, endMin, col: c, cols }) => {
        const dur = endMin - startMin
        const s = new Date(e.start)
        const label = `${e.name}, ${e.kind === 'deadline' ? 'due ' : ''}${fmtTime(s)}${e.end ? ` to ${fmtTime(new Date(e.end))}` : ''}${e.location ? `, ${e.location}` : ''}`
        return (
          <button
            key={e.id}
            type="button"
            data-ev={e.id}
            className={'ev' + (e.kind === 'deadline' ? ' deadline' : '') + (dur < 45 ? ' short' : dur < 80 ? ' mid' : '') + (e.completed ? ' done' : '') + (draggingId === e.id ? ' drag-src' : '') + (canEdit?.(e) ? ' movable' : '') + (e.ghost ? ' ghost' : '')}
            style={{
              '--c': colour(e),
              top: `${(startMin / 1440) * 100}%`,
              height: e.kind === 'deadline' ? undefined : `calc(${(dur / 1440) * 100}% - 2px)`,
              left: `calc(${(c / cols) * 100}% + 1px)`,
              width: `calc(${(1 / cols) * 100}% - ${cols > 1 ? 3 : 6}px)`,
            } as React.CSSProperties}
            onClick={(ev) => (ev.stopPropagation(), onEvent(e))}
            title={label}
            aria-label={label}
          >
            {e.kind === 'deadline' ? (
              <span className="ev-line"><Icon name="flag" size={11} /> <span className="truncate">{e.name}</span></span>
            ) : dur < 45 ? (
              <span className="ev-line"><span className="truncate"><strong>{e.name}</strong> <span className="ev-time">{fmtTime(s)}</span></span></span>
            ) : (
              <>
                <strong className="ev-name">{(e.icon || e.category?.icon) && <Icon name={(e.icon || e.category?.icon)!} size={11} />} {e.name}{e.recurring && <Icon name="repeat" size={10} />}</strong>
                <span className="ev-time tabular">{fmtTime(s)} – {e.end ? fmtTime(new Date(e.end)) : ''}</span>
                {e.location && dur >= 75 && <span className="ev-time truncate">{e.location}</span>}
                {e.category && e.category.name !== 'Uncategorized' && dur >= 100 && <span className="ev-time truncate">{e.category.name}</span>}
              </>
            )}
            {e.kind !== 'deadline' && e.end && canEdit?.(e) && isSameDay(s, new Date(new Date(e.end).getTime() - 1)) && <span className="ev-resize" aria-hidden="true" />}
          </button>
        )
      })}
      {tasks.map((t) => {
        const due = new Date(t.due!)
        return (
          <div key={t.id} className="ev-task" style={{ top: `${((due.getHours() * 60 + due.getMinutes()) / 1440) * 100}%` }}>
            <TaskChip task={t} onOpen={(x) => onTask?.(x)} />
          </div>
        )
      })}
      {ghost && (
        <div className="ev-ghost" style={{ '--c': ghost.colour, top: `${(ghost.a / 1440) * 100}%`, height: `${((ghost.b - ghost.a) / 1440) * 100}%` } as React.CSSProperties} aria-hidden="true">
          {ghost.name && <strong className="truncate">{ghost.name}</strong>}<span className="tabular">{minLabel(ghost.a)} – {minLabel(ghost.b)}</span>
        </div>
      )}
      {nowMin != null && <div className="now-line" style={{ top: `${(nowMin / 1440) * 100}%` }} aria-hidden="true" />}
    </div>
  )
}
