import { useLayoutEffect, useRef, useState } from 'react'
import { Dialog } from '../../components/ui'
import { Icon } from '../../components/Icon'
import { dayKey, fmtDate, isSameDay } from '../../lib/dates'
import type { CalEvent, Task } from '../../lib/types'
import { BirthdayChip, PhotoBadge, TaskChip, isAllDayTask, type Birthday } from './extras'
import { eventDays } from './util'
import { chipTime, fmtTimeIn, useCalPrefs } from './zone'

interface Props {
  days: Date[]
  month: number
  byDay: Map<string, CalEvent[]>
  colour: (e: CalEvent) => string
  today: Date
  selected: Date
  compact: boolean // phones: dots instead of chips, tap selects a day
  onSelect: (d: Date) => void
  onOpenDay: (d: Date) => void
  onCreate: (d: Date) => void
  onEvent: (e: CalEvent) => void
  tasksByDay?: Map<string, Task[]>
  photos?: Record<string, number>
  onTask?: (t: Task) => void
  birthdaysByDay?: Map<string, Birthday[]>
}

type Entry = { key: string; at: number; allDay: boolean; event?: CalEvent; task?: Task; bday?: Birthday }

/** Events and tasks of one day in display order: all-day events, all-day tasks, then by time. */
export function dayEntries(events: CalEvent[], tasks: Task[] = [], bdays: Birthday[] = []): Entry[] {
  const out: Entry[] = [
    ...bdays.map((b) => ({ key: 'b' + b.id, at: -3, allDay: true, bday: b })),
    ...events.map((e) => ({ key: 'e' + e.id, at: e.all_day ? -2 : new Date(e.start).getTime(), allDay: e.all_day, event: e })),
    ...tasks.map((t) => ({ key: 't' + t.id, at: isAllDayTask(t) ? -1 : new Date(t.due!).getTime(), allDay: isAllDayTask(t), task: t })),
  ]
  return out.sort((a, b) => a.at - b.at)
}

export function EventChip({ e, colour, day, onClick }: { e: CalEvent; colour: string; day?: Date; onClick: () => void }) {
  const { tz } = useCalPrefs()
  const style = { '--c': colour } as React.CSSProperties
  const label = `${e.name}${e.all_day ? ', all day' : `, ${fmtTimeIn(new Date(e.start), tz)}${e.end && e.kind === 'event' ? ` – ${fmtTimeIn(new Date(e.end), tz)}` : ''}`}${e.category && e.category.name !== 'Uncategorized' ? ` · ${e.category.name}` : ''}${e.location ? ` · ${e.location}` : ''}${e.recurrence_text ? ` · ${e.recurrence_text}` : ''}`
  if (e.all_day) {
    const { first, last } = eventDays(e)
    const cont = day && !isSameDay(first, day)
    const more = day && !isSameDay(last, day)
    return (
      <button type="button" data-ev={e.id} className={'chip-ev allday' + (cont ? ' cont' : '') + (more ? ' more' : '') + (e.ghost ? ' ghost' : '')} style={style} onClick={(ev) => (ev.stopPropagation(), onClick())} title={label} aria-label={label}>
        {(e.icon || e.category?.icon) && <Icon name={(e.icon || e.category?.icon)!} size={11} />}<span className="truncate">{e.name}</span>
      </button>
    )
  }
  return (
    <button type="button" data-ev={e.id} className={'chip-ev' + (e.completed ? ' done' : '') + (e.ghost ? ' ghost' : '')} style={style} onClick={(ev) => (ev.stopPropagation(), onClick())} title={label} aria-label={label}>
      {e.kind === 'deadline' ? <Icon name="flag" size={11} className="chip-flag" /> : (e.icon || e.category?.icon) ? <Icon name={(e.icon || e.category?.icon)!} size={11} className="chip-flag" /> : <span className="chip-dot" />}
      {e.recurring && <Icon name="repeat" size={9} className="chip-rep" />}
      <span className="chip-time tabular">{chipTime(new Date(e.start), tz)}</span>
      <span className="truncate">{e.name}</span>
    </button>
  )
}

export function MonthView({ days, month, byDay, colour, today, selected, compact, onSelect, onOpenDay, onCreate, onEvent, tasksByDay, photos, onTask, birthdaysByDay }: Props) {
  const [moreDay, setMoreDay] = useState<Date | null>(null)
  // As many chips as fit in a row's height (rows share the viewport; 4K scales with rem).
  const grid = useRef<HTMLDivElement>(null)
  const [maxChips, setMaxChips] = useState(3)
  useLayoutEffect(() => {
    const el = grid.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16
      const rowH = el.clientHeight / 6
      setMaxChips(Math.max(1, Math.floor((rowH - 1.875 * rem) / (1.3125 * rem))))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const head = days.slice(0, 7)
  return (
    <div className={'month' + (compact ? ' compact' : '')}>
      <div className="month-head" aria-hidden="true">
        {head.map((d) => (
          <div key={d.getDay()}>{fmtDate(d, { weekday: compact ? 'narrow' : 'short' })}</div>
        ))}
      </div>
      <div ref={grid} className="month-grid" role="grid" aria-label={fmtDate(days[10], { month: 'long', year: 'numeric' })}>
        {Array.from({ length: 6 }, (_, w) => (
          <div className="month-row" role="row" key={w}>
            {days.slice(w * 7, w * 7 + 7).map((d) => {
              const events = byDay.get(dayKey(d)) ?? []
              const list = dayEntries(events, tasksByDay?.get(dayKey(d)), birthdaysByDay?.get(dayKey(d)))
              const out = d.getMonth() !== month
              const isToday = isSameDay(d, today)
              const isSel = compact && isSameDay(d, selected)
              const shown = list.slice(0, list.length > maxChips ? maxChips - 1 : maxChips)
              const hidden = list.length - shown.length
              const label = `${fmtDate(d, { weekday: 'long', month: 'long', day: 'numeric' })}, ${list.length ? `${list.length} item${list.length > 1 ? 's' : ''}` : 'nothing scheduled'}`
              return (
                <div
                  key={d.getTime()}
                  role="gridcell"
                  className={'month-cell' + (out ? ' out' : '') + (isToday ? ' today' : '') + (isSel ? ' selected' : '')}
                  onClick={() => (compact ? onSelect(d) : onCreate(d))}
                >
                  <div className="month-cell-head">
                  <button
                    type="button"
                    className="day-num tabular"
                    aria-label={label}
                    onClick={(e) => {
                      e.stopPropagation()
                      if (compact) onSelect(d)
                      else onOpenDay(d)
                    }}
                  >
                    {d.getDate() === 1 && !compact ? fmtDate(d, { month: 'short', day: 'numeric' }) : d.getDate()}
                  </button>
                  <PhotoBadge day={d} count={photos?.[dayKey(d)]} />
                  </div>
                  {compact ? (
                    <div className="dots" aria-hidden="true">
                      {list.slice(0, 4).map((x) => <span key={x.key} className="dot" style={{ background: x.event ? colour(x.event) : x.bday ? 'var(--app-warning)' : 'var(--app-accent)' }} />)}
                    </div>
                  ) : (
                    <div className="chips">
                      {shown.map((x) => x.event
                        ? <EventChip key={x.key} e={x.event} day={d} colour={colour(x.event)} onClick={() => onEvent(x.event!)} />
                        : x.bday ? <BirthdayChip key={x.key} b={x.bday} />
                        : <TaskChip key={x.key} task={x.task!} onOpen={(t) => onTask?.(t)} />)}
                      {hidden > 0 && (
                        <button type="button" className="chip-more" onClick={(ev) => (ev.stopPropagation(), setMoreDay(d))}>
                          {hidden} more
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        ))}
      </div>
      {moreDay && (
        <Dialog open onClose={() => setMoreDay(null)} title={fmtDate(moreDay, { weekday: 'long', month: 'long', day: 'numeric' })} width="22rem">
          <div className="day-pop">
            {dayEntries(byDay.get(dayKey(moreDay)) ?? [], tasksByDay?.get(dayKey(moreDay)), birthdaysByDay?.get(dayKey(moreDay))).map((x) => x.event
              ? <EventChip key={x.key} e={x.event} day={moreDay} colour={colour(x.event)} onClick={() => (setMoreDay(null), onEvent(x.event!))} />
              : x.bday ? <BirthdayChip key={x.key} b={x.bday} big />
              : <TaskChip key={x.key} task={x.task!} big onOpen={(t) => (setMoreDay(null), onTask?.(t))} />)}
          </div>
        </Dialog>
      )}
    </div>
  )
}

/** Phone month view: the selected day's events under the grid. */
export function DayList({ day, events, colour, onEvent, onCreate, tasks = [], onTask, photos, birthdays = [] }: {
  day: Date; events: CalEvent[]; colour: (e: CalEvent) => string; onEvent: (e: CalEvent) => void; onCreate: () => void
  tasks?: Task[]; onTask?: (t: Task) => void; photos?: number; birthdays?: Birthday[]
}) {
  const { tz } = useCalPrefs()
  return (
    <section className="day-list" aria-label={fmtDate(day, { weekday: 'long', month: 'long', day: 'numeric' })}>
      <div className="day-list-head">
        <h2>{fmtDate(day, { weekday: 'long', month: 'long', day: 'numeric' })}</h2>
        <PhotoBadge day={day} count={photos} />
        <button className="btn ghost sm" onClick={onCreate}><Icon name="plus" size={14} /> Add</button>
      </div>
      {birthdays.length > 0 && <div className="day-list-tasks">{birthdays.map((b) => <BirthdayChip key={b.id} b={b} big />)}</div>}
      {tasks.length > 0 && (
        <div className="day-list-tasks">{tasks.map((t) => <TaskChip key={t.id} task={t} big onOpen={(x) => onTask?.(x)} />)}</div>
      )}
      {events.length === 0 && !tasks.length && !birthdays.length ? (
        <p className="empty left">Nothing scheduled.</p>
      ) : events.length === 0 ? null : (
        <ul>
          {events.map((e) => (
            <li key={e.id}>
              <button className="agenda-item" data-ev={e.id} onClick={() => onEvent(e)}>
                <span className="agenda-bar" style={{ background: colour(e) }} />
                <span className="agenda-time tabular">{e.all_day ? 'All day' : fmtTimeIn(new Date(e.start), tz)}</span>
                <span className="grow">
                  <span className={'agenda-title' + (e.completed ? ' done' : '')}>{e.kind === 'deadline' && <Icon name="flag" size={12} />} {e.name}</span>
                  {e.location && <span className="agenda-sub truncate">{e.location}</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
