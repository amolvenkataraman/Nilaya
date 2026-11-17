// The week (7 days, 3 on phones) and day views: all-day items on top, timed events placed by wall clock in the
// display zone, tasks at their due time, the now line, and mouse drag to create, move and resize events.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { Icon } from '../../components/Icon'
import { useIsPhone } from '../../components/ui'
import { cn } from '../../lib/cn'
import { dayKey, fmtTime, isSameDay } from '../../lib/dates'
import type { CalEvent, Task } from '../../lib/types'
import { BirthdayChip, EventChip, GHOST, PhotoBadge, TaskChip } from './chips'
import { categoryName, eventIcon, hourFmt } from './format'
import { isAllDayTask } from './layers'
import { atWallMin, clampDay, DAY_MIN, layoutDay, pct, snap, type Placed } from './layout'
import { DayHeader, dayColumn, NowLine, TimeGrid } from './TimeGrid'
import type { Layers } from './types'
import {
  HOME_ZONE,
  dayStartIn,
  fmtTimeIn,
  gmtLabel,
  shiftWall,
  useCalPrefs,
  wallParts,
  zoneDay,
  zoneDayKey,
  zoneMinutes,
  type Zone,
} from './zone'

interface Props {
  days: Date[]
  byDay: Map<string, CalEvent[]>
  colour: (e: CalEvent) => string
  now: Date
  layers: Layers
  onCreate: (start: Date, end?: Date, allDay?: boolean) => void
  onEvent: (e: CalEvent) => void
  onOpenDay: (d: Date) => void
  /** Events the user may drag (move / resize). */
  canEdit?: (e: CalEvent) => boolean
  /** Drag-moved or resized: the new start and end. */
  onMove?: (e: CalEvent, start: Date, end: Date | null) => void
  /** The time zone label in the corner was clicked (pick a display zone). */
  onZone?: () => void
}

// Mouse/pen drag on the time grid: drag empty space to create a range, drag an event to move it
// (also to another day), drag its bottom edge to resize. Touch keeps tap-to-create (scrolling wins).
type Drag = {
  mode: 'create' | 'move' | 'resize'
  ev?: CalEvent
  day: number
  origDay: number
  a: number
  b: number
  anchor: number
  origStart: number
  moved: boolean
  x0: number
  y0: number
}
/** Drag steps, in minutes. */
const Q = 15
const snapQ = (m: number) => clampDay(Math.round(m / Q) * Q)
const minLabel = (m: number) => fmtTime(new Date(2000, 0, 1, 0, m))
/** Pixels a press must travel before it counts as a drag (a click below that). */
const DRAG_SLOP = 6

/** The home zone's time at each display-zone hour of `day` ("9 PM", "8:30 PM"), for the second gutter. */
function homeHours(day: Date, tz: Zone): string[] {
  return Array.from({ length: 24 }, (_, h) => {
    const t = atWallMin(day, h * 60, tz).getTime()
    return wallParts(t, undefined).mi ? fmtTime(new Date(t)) : hourFmt.format(t)
  })
}

export function WeekView({ days, byDay, colour, now, layers, onCreate, onEvent, onOpenDay, canEdit, onMove, onZone }: Props) {
  const { tz } = useCalPrefs()
  // A second gutter with the home zone's hours while another zone is shown (not on phones: too narrow).
  const phone = useIsPhone()
  const dual = !!tz && !phone
  const scroller = useRef<HTMLDivElement>(null)
  const body = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<Drag | null>(null)
  const dragRef = useRef<Drag | null>(null)
  const suppress = useRef(false)
  const cb = useRef({ days, onCreate, onMove, tz })
  cb.current = { days, onCreate, onMove, tz }
  const stop = useRef<() => void>(() => {})
  useEffect(() => () => stop.current(), [])

  const allDay = useMemo(() => days.map((d) => (byDay.get(dayKey(d)) ?? []).filter((e) => e.all_day)), [days, byDay])
  const placed = useMemo(() => days.map((d) => layoutDay(byDay.get(dayKey(d)) ?? [], d, tz)), [days, byDay, tz])
  const dayTasks = useMemo(() => days.map((d) => layers.tasks.get(dayKey(d)) ?? []), [days, layers.tasks])
  const dayBdays = useMemo(() => days.map((d) => layers.birthdays.get(dayKey(d)) ?? []), [days, layers.birthdays])

  function locate(e: { clientX: number; clientY: number }) {
    const cols = Array.from(body.current?.querySelectorAll<HTMLElement>('[data-day-col]') ?? [])
    if (!cols.length) return { day: 0, min: 0 }
    let day = cols.findIndex((c) => {
      const r = c.getBoundingClientRect()
      return e.clientX >= r.left && e.clientX < r.right
    })
    if (day < 0) day = e.clientX < cols[0].getBoundingClientRect().left ? 0 : cols.length - 1
    const r = cols[0].getBoundingClientRect()
    return { day, min: clampDay(((e.clientY - r.top) / r.height) * DAY_MIN) }
  }

  function onPointerDown(pe: React.PointerEvent) {
    if (pe.button !== 0 || pe.pointerType === 'touch' || dragRef.current) return
    const t = pe.target as HTMLElement
    if (t.closest('[data-task-chip]')) return
    const { day, min } = locate(pe)
    const evEl = t.closest<HTMLElement>('[data-ev]')
    let d: Drag
    if (evEl) {
      const ev = placed[day]?.find((p) => p.event.id === evEl.dataset.ev)
      if (!ev || !canEdit?.(ev.event) || !onMove) return
      d = {
        mode: t.closest('[data-resize]') ? 'resize' : 'move',
        ev: ev.event,
        day,
        origDay: day,
        a: ev.startMin,
        b: ev.endMin,
        anchor: min - ev.startMin,
        origStart: ev.startMin,
        moved: false,
        x0: pe.clientX,
        y0: pe.clientY,
      }
    } else {
      if (!t.closest('[data-day-col]')) return
      const m0 = Math.floor(min / Q) * Q
      d = { mode: 'create', day, origDay: day, a: m0, b: m0 + Q, anchor: m0, origStart: m0, moved: false, x0: pe.clientX, y0: pe.clientY }
    }
    dragRef.current = d
    const move = (e: PointerEvent) => {
      const c = dragRef.current
      if (!c) return
      if (!c.moved && Math.hypot(e.clientX - c.x0, e.clientY - c.y0) < DRAG_SLOP) return
      e.preventDefault()
      const { day: dy, min: m } = locate(e)
      let next: Drag
      if (c.mode === 'create') {
        const s = snapQ(m)
        next = { ...c, moved: true, a: Math.min(c.anchor, s), b: Math.max(c.anchor + Q, s) }
      } else if (c.mode === 'move') {
        const dur = c.b - c.a
        const a = Math.max(0, Math.min(DAY_MIN - Math.min(dur, DAY_MIN), snapQ(m - c.anchor)))
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
      setTimeout(() => {
        suppress.current = false
      }, 0)
      const { days: ds, onCreate: create, onMove: moved, tz: zone } = cb.current
      // Wall-clock minutes in the display zone → instants (right on DST change days too).
      const day = ds[c.day]
      if (c.mode === 'create') return create(atWallMin(day, c.a, zone), atWallMin(day, c.b, zone))
      const ev = c.ev!
      const s = new Date(ev.start)
      if (c.mode === 'resize') return moved?.(ev, s, atWallMin(day, c.b, zone))
      const ns = shiftWall(s.getTime(), c.day - c.origDay, c.a - c.origStart, zone)
      if (ns.getTime() === s.getTime()) return
      moved?.(ev, ns, ev.end ? new Date(ns.getTime() + (new Date(ev.end).getTime() - s.getTime())) : null)
    }
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        dragRef.current = null
        stop.current()
      }
    }
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
  const nowDay = zoneDay(now.getTime(), tz) // today in the display zone
  const showsToday = days.some((d) => isSameDay(d, nowDay))
  const nowMin = zoneMinutes(now.getTime(), tz)

  // Scroll to the working day (or to just before now) when the range or zone changes, not as time passes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: rangeKey and tz are the triggers; now moves every minute
  useLayoutEffect(() => {
    const el = scroller.current
    if (!el) return
    const hour = showsToday ? Math.max(0, Math.min(Math.floor(nowMin / 60) - 1.5, 16)) : 7.5
    el.scrollTop = (el.scrollHeight / 24) * hour - 4
  }, [rangeKey, tz])

  const home = useMemo(() => (dual ? homeHours(days[0], tz) : null), [dual, days, tz])
  // The zone label: its offset now (or midday of the first day shown, if today isn't in view).
  const at = showsToday ? now.getTime() : dayStartIn(days[0], tz) + 12 * 3600_000
  const zoneLabel = gmtLabel(at, tz ?? HOME_ZONE)
  const zoneTitle = `${tz ? `Showing ${tz} (${zoneLabel}) for this window; yours is ${HOME_ZONE}` : `Time zone: ${HOME_ZONE} (${zoneLabel})`}. Click to show another zone.`

  return (
    <TimeGrid
      days={days}
      wide={dual}
      scrollRef={scroller}
      bodyRef={body}
      bodyClassName={drag ? 'cursor-grabbing! select-none [&_*]:cursor-grabbing! [&_*]:select-none' : undefined}
      bodyProps={{
        onPointerDown,
        onClickCapture: (e) => {
          if (suppress.current) {
            suppress.current = false
            e.stopPropagation()
            e.preventDefault()
          }
        },
      }}
      homeHours={home}
      corner={
        onZone ? (
          <button
            type="button"
            className={cn(
              'flex cursor-pointer items-end justify-end gap-1.5 border-0 bg-transparent pt-0 pr-2 pb-1.5 pl-0 text-3xs whitespace-nowrap tabular-nums',
              'hover:bg-hover hover:text-fg max-md:pr-1 max-md:text-right max-md:leading-[1.15] max-md:whitespace-normal',
              tz ? 'font-semibold text-accent' : 'text-muted',
            )}
            onClick={onZone}
            title={zoneTitle}
            aria-label={zoneTitle}
          >
            {dual && <span className="font-normal text-muted opacity-80">{gmtLabel(at, undefined)}</span>}
            <span>{zoneLabel.replace('GMT', 'GMT​') /* may wrap after "GMT" in a phone's narrow gutter */}</span>
          </button>
        ) : undefined
      }
      head={(d) => (
        <>
          <DayHeader day={d} today={isSameDay(d, nowDay)} onClick={() => onOpenDay(d)} />
          <PhotoBadge day={d} count={layers.photos?.[dayKey(d)]} className="absolute top-1 right-1" />
        </>
      )}
      allDay={(d, i) => (
        // biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/useKeyWithClickEvents: a mouse shortcut; N creates events from the keyboard
        <div
          key={d.getTime()}
          className="grid min-w-0 cursor-default content-start gap-0.5 border-l border-border p-0.5"
          onClick={() => onCreate(d, undefined, true)}
        >
          {dayBdays[i].map((b) => (
            <BirthdayChip key={b.id} b={b} />
          ))}
          {allDay[i].map((e) => (
            <EventChip key={e.id} e={e} day={d} colour={colour(e)} onClick={() => onEvent(e)} />
          ))}
          {dayTasks[i].filter(isAllDayTask).map((t) => (
            <TaskChip key={t.id} task={t} onOpen={layers.onTask} />
          ))}
        </div>
      )}
    >
      {days.map((d, i) => (
        <DayColumn
          key={d.getTime()}
          day={d}
          tz={tz}
          items={placed[i]}
          colour={colour}
          onEvent={onEvent}
          onCreate={onCreate}
          nowMin={isSameDay(d, nowDay) ? nowMin : null}
          tasks={dayTasks[i].filter((t) => !isAllDayTask(t))}
          onTask={layers.onTask}
          canEdit={onMove ? canEdit : undefined}
          ghost={
            drag?.moved && drag.day === i
              ? { a: drag.a, b: drag.b, colour: drag.ev ? colour(drag.ev) : 'var(--app-accent)', name: drag.ev?.name ?? '' }
              : null
          }
          draggingId={drag?.moved && drag.mode === 'move' ? drag.ev?.id : undefined}
        />
      ))}
    </TimeGrid>
  )
}

function DayColumn({
  day,
  tz,
  items,
  colour,
  onEvent,
  onCreate,
  nowMin,
  tasks,
  onTask,
  canEdit,
  ghost,
  draggingId,
}: {
  day: Date
  tz: Zone
  items: Placed[]
  colour: (e: CalEvent) => string
  onEvent: (e: CalEvent) => void
  onCreate: (start: Date, end?: Date) => void
  nowMin: number | null
  tasks: Task[]
  onTask: (t: Task) => void
  canEdit?: (e: CalEvent) => boolean
  ghost: { a: number; b: number; colour: string; name: string } | null
  draggingId?: string
}) {
  const col = useRef<HTMLDivElement>(null)
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/useKeyWithClickEvents: a mouse shortcut; N creates events from the keyboard
    <div
      ref={col}
      data-day-col
      className={dayColumn()}
      onClick={(e) => {
        const r = col.current!.getBoundingClientRect()
        const min = snap(((e.clientY - r.top) / r.height) * DAY_MIN - 15)
        // Wall-clock time in the display zone; the end is an hour later on that clock too.
        onCreate(atWallMin(day, min, tz), atWallMin(day, min + 60, tz))
      }}
    >
      {items.map((p) => (
        <TimedEvent
          key={p.event.id}
          p={p}
          tz={tz}
          colour={colour(p.event)}
          onEvent={onEvent}
          movable={!!canEdit?.(p.event)}
          dragging={draggingId === p.event.id}
        />
      ))}
      {tasks.map((t) => (
        <div
          key={t.id}
          data-task-chip
          className="absolute right-0.5 left-0.5 z-2"
          style={{ top: pct(Math.floor(zoneMinutes(new Date(t.due!).getTime(), tz))) }}
        >
          <TaskChip task={t} onOpen={onTask} floating />
        </div>
      ))}
      {ghost && (
        <div
          className={cn(
            'pointer-events-none absolute right-1 left-0.5 z-6 flex min-h-4.5 flex-col gap-px overflow-hidden rounded-[5px] px-1.5 py-0.75 text-xs leading-tight text-fg',
            'bg-[color-mix(in_srgb,var(--c)_28%,var(--app-surface))] shadow-[inset_3px_0_0_var(--c),0_4px_14px_rgba(0,0,0,0.18)]',
          )}
          style={{ '--c': ghost.colour, top: pct(ghost.a), height: pct(ghost.b - ghost.a) } as CSSProperties}
          aria-hidden="true"
        >
          {ghost.name && <strong className="min-w-0 truncate">{ghost.name}</strong>}
          <span className="text-muted tabular-nums">
            {minLabel(ghost.a)} – {minLabel(ghost.b)}
          </span>
        </div>
      )}
      {nowMin != null && <NowLine min={nowMin} />}
    </div>
  )
}

/** One timed event in its column. Short ones fit name and time on a line; tall ones add place and category. */
function TimedEvent({
  p: { event: e, startMin, endMin, col, cols },
  tz,
  colour,
  onEvent,
  movable,
  dragging,
}: {
  p: Placed
  tz: Zone
  colour: string
  onEvent: (e: CalEvent) => void
  movable: boolean
  dragging: boolean
}) {
  const dur = endMin - startMin
  const s = new Date(e.start)
  const deadline = e.kind === 'deadline'
  const short = dur < 45
  const label = `${e.name}, ${deadline ? 'due ' : ''}${fmtTimeIn(s, tz)}${e.end ? ` to ${fmtTimeIn(new Date(e.end), tz)}` : ''}${e.location ? `, ${e.location}` : ''}`
  const icon = eventIcon(e)
  const cat = categoryName(e)
  const done = e.completed && 'line-through'
  return (
    <button
      type="button"
      data-ev={e.id}
      className={cn(
        'group/ev absolute z-1 flex min-h-4.5 flex-col items-start gap-px overflow-hidden rounded-[5px] border-0 px-1.5 text-left text-xs leading-tight text-fg',
        'transition-[background-color] duration-100 hover:z-3 focus-visible:z-4 [&>*]:flex-none',
        deadline
          ? 'h-5 justify-center bg-surface py-0 font-medium shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--c)_55%,var(--app-border))]'
          : 'bg-[color-mix(in_srgb,var(--c)_16%,var(--app-surface))] shadow-[inset_3px_0_0_var(--c),0_0_0_1px_var(--app-surface)] hover:bg-[color-mix(in_srgb,var(--c)_26%,var(--app-surface))]',
        !deadline && (short ? 'justify-center pt-px pb-0' : 'py-0.75'),
        dragging ? 'opacity-35' : e.completed && 'opacity-60',
        movable && 'cursor-grab',
        e.ghost && GHOST,
      )}
      style={
        {
          '--c': colour,
          top: pct(startMin),
          height: deadline ? undefined : `calc(${pct(dur)} - 2px)`,
          left: `calc(${(col / cols) * 100}% + 1px)`,
          width: `calc(${(1 / cols) * 100}% - ${cols > 1 ? 3 : 6}px)`,
        } as CSSProperties
      }
      onClick={(ev) => {
        ev.stopPropagation()
        onEvent(e)
      }}
      title={label}
      aria-label={label}
    >
      {deadline ? (
        <span className="flex max-w-full min-w-0 items-center gap-1 whitespace-nowrap">
          <Icon name="flag" size={11} className="flex-none text-(--c)" /> <span className={cn('min-w-0 truncate', done)}>{e.name}</span>
        </span>
      ) : short ? (
        <span className="flex max-w-full min-w-0 items-center gap-1 whitespace-nowrap">
          <span className={cn('min-w-0 truncate', done)}>
            <strong>{e.name}</strong> <span className="text-muted">{fmtTimeIn(s, tz)}</span>
          </span>
        </span>
      ) : (
        <>
          <strong
            className={cn(
              'overflow-hidden font-semibold wrap-break-word [&_svg]:inline [&_svg]:align-[-1px]',
              dur < 80 ? 'line-clamp-1' : 'line-clamp-2',
              done,
            )}
          >
            {icon && <Icon name={icon} size={11} />} {e.name}
            {e.recurring && <Icon name="repeat" size={10} />}
          </strong>
          <span className="max-w-full truncate font-normal text-muted tabular-nums">
            {fmtTimeIn(s, tz)} – {e.end ? fmtTimeIn(new Date(e.end), tz) : ''}
          </span>
          {e.location && dur >= 75 && <span className="max-w-full truncate text-muted">{e.location}</span>}
          {cat && dur >= 100 && <span className="max-w-full truncate text-muted">{cat}</span>}
        </>
      )}
      {!deadline && e.end && movable && zoneDayKey(s.getTime(), tz) === zoneDayKey(new Date(e.end).getTime() - 1, tz) && (
        <span
          data-resize
          className="absolute inset-x-0 bottom-0 h-1.5 cursor-ns-resize after:absolute after:bottom-0.5 after:left-1/2 after:-ml-2.5 after:h-0.5 after:w-5 after:rounded-[1px] after:bg-(--c) after:opacity-0 group-hover/ev:after:opacity-70"
          aria-hidden="true"
        />
      )}
    </button>
  )
}
