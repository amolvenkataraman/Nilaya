import { useLayoutEffect, useMemo, useRef } from 'react'
import { Icon } from '../../components/Icon'
import { dayKey, fmtDate, fmtTime, isSameDay } from '../../lib/dates'
import type { CalEvent, Task } from '../../lib/types'
import { BirthdayChip, PhotoBadge, TaskChip, isAllDayTask, type Birthday } from './extras'
import { EventChip } from './MonthView'
import { layoutDay, snap } from './util'

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
}

const hourFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric' })
const HOURS = Array.from({ length: 24 }, (_, h) => h)

export function WeekView({ days, byDay, colour, now, onCreate, onEvent, onOpenDay, tasksByDay, photos, onTask, birthdaysByDay }: Props) {
  const scroller = useRef<HTMLDivElement>(null)
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
        <div className="week-body">
          <div className="gutter hours" aria-hidden="true">
            {HOURS.map((h) => (
              <span key={h} style={{ top: `${(h / 24) * 100}%` }}>{h === 0 ? '' : hourFmt.format(new Date(2000, 0, 1, h))}</span>
            ))}
          </div>
          {days.map((d, i) => (
            <DayColumn key={d.getTime()} day={d} items={placed[i]} colour={colour} onEvent={onEvent} onCreate={onCreate} nowMin={isSameDay(d, now) ? nowMin : null}
              tasks={dayTasks[i].filter((t) => !isAllDayTask(t))} onTask={onTask} />
          ))}
        </div>
      </div>
    </div>
  )
}

function DayColumn({ day, items, colour, onEvent, onCreate, nowMin, tasks, onTask }: {
  day: Date; items: ReturnType<typeof layoutDay>; colour: (e: CalEvent) => string; onEvent: (e: CalEvent) => void
  onCreate: (start: Date, end?: Date) => void; nowMin: number | null; tasks: Task[]; onTask?: (t: Task) => void
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
            className={'ev' + (e.kind === 'deadline' ? ' deadline' : '') + (dur < 45 ? ' short' : dur < 80 ? ' mid' : '') + (e.completed ? ' done' : '')}
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
      {nowMin != null && <div className="now-line" style={{ top: `${(nowMin / 1440) * 100}%` }} aria-hidden="true" />}
    </div>
  )
}
