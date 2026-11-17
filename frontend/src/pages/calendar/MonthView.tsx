// The month grid. On desktop each day lists as many chips as fit (birthdays, events, tasks) and "N more" opens
// the rest; on phones (compact) days show coloured dots and a tap selects the day for the list below.
import { useLayoutEffect, useRef, useState } from 'react'
import { Dialog } from '../../components/ui'
import { cn } from '../../lib/cn'
import { dayKey, fmtDate, isSameDay } from '../../lib/dates'
import { plural } from '../../lib/format'
import type { CalEvent, Task } from '../../lib/types'
import { BirthdayChip, EventChip, PhotoBadge, TaskChip } from './chips'
import { isAllDayTask } from './layers'
import type { Birthday, Layers } from './types'

interface Props {
  days: Date[]
  month: number
  byDay: Map<string, CalEvent[]>
  colour: (e: CalEvent) => string
  layers: Layers
  today: Date
  selected: Date
  compact: boolean // phones: dots instead of chips, tap selects a day
  onSelect: (d: Date) => void
  onOpenDay: (d: Date) => void
  onCreate: (d: Date) => void
  onEvent: (e: CalEvent) => void
}

type Entry = { key: string; at: number; allDay: boolean; event?: CalEvent; task?: Task; bday?: Birthday }

/** Events and tasks of one day in display order: birthdays, all-day events, all-day tasks, then by time. */
export function dayEntries(events: CalEvent[], tasks: Task[] = [], bdays: Birthday[] = []): Entry[] {
  const out: Entry[] = [
    ...bdays.map((b) => ({ key: `b${b.id}`, at: -3, allDay: true, bday: b })),
    ...events.map((e) => ({ key: `e${e.id}`, at: e.all_day ? -2 : new Date(e.start).getTime(), allDay: e.all_day, event: e })),
    ...tasks.map((t) => ({ key: `t${t.id}`, at: isAllDayTask(t) ? -1 : new Date(t.due!).getTime(), allDay: isAllDayTask(t), task: t })),
  ]
  return out.sort((a, b) => a.at - b.at)
}

/** Chip heights in rem (1.25 rem + the 1/16 rem gap) and the day number's row, for "how many fit". */
const CHIP_REM = 1.3125
const HEAD_REM = 1.875

export function MonthView({ days, month, byDay, colour, layers, today, selected, compact, onSelect, onOpenDay, onCreate, onEvent }: Props) {
  const [moreDay, setMoreDay] = useState<Date | null>(null)
  // As many chips as fit in a row's height (rows share the viewport; 4K scales with rem).
  const grid = useRef<HTMLDivElement>(null)
  const [maxChips, setMaxChips] = useState(3)
  useLayoutEffect(() => {
    const el = grid.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16
      const rowH = el.clientHeight / 6
      setMaxChips(Math.max(1, Math.floor((rowH - HEAD_REM * rem) / (CHIP_REM * rem))))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const entries = (d: Date) => dayEntries(byDay.get(dayKey(d)) ?? [], layers.tasks.get(dayKey(d)), layers.birthdays.get(dayKey(d)))
  const head = days.slice(0, 7)
  const weeks = Array.from({ length: 6 }, (_, w) => days.slice(w * 7, w * 7 + 7))
  return (
    <div className={cn('flex flex-col', compact ? 'min-h-0 flex-none' : 'min-h-128 flex-1')}>
      <div className="grid grid-cols-7 border-b border-border" aria-hidden="true">
        {head.map((d) => (
          <div
            key={d.getDay()}
            className={cn('py-1.5 text-xs font-medium tracking-[0.04em] text-muted uppercase', compact ? 'px-0 text-center' : 'px-2')}
          >
            {fmtDate(d, { weekday: compact ? 'narrow' : 'short' })}
          </div>
        ))}
      </div>
      <div
        ref={grid}
        className={cn('grid min-h-0', compact ? 'grid-rows-[repeat(6,3rem)]' : 'flex-1 grid-rows-6')}
        role="grid"
        aria-label={fmtDate(days[10], { month: 'long', year: 'numeric' })}
      >
        {weeks.map((week) => (
          <div className="grid min-h-0 grid-cols-7 border-b border-border last:border-b-0" role="row" key={week[0].getTime()}>
            {week.map((d) => {
              const list = entries(d)
              const out = d.getMonth() !== month
              const isToday = isSameDay(d, today)
              const isSel = compact && isSameDay(d, selected)
              const shown = list.slice(0, list.length > maxChips ? maxChips - 1 : maxChips)
              const hidden = list.length - shown.length
              const label = `${fmtDate(d, { weekday: 'long', month: 'long', day: 'numeric' })}, ${list.length ? plural(list.length, 'item') : 'nothing scheduled'}`
              return (
                // biome-ignore lint/a11y/useKeyWithClickEvents: the day number inside is the keyboard target; N creates events
                <div
                  key={d.getTime()}
                  role="gridcell"
                  className={cn(
                    'flex min-h-0 min-w-0 flex-col gap-px overflow-hidden',
                    compact
                      ? 'cursor-pointer items-center px-0 py-1'
                      : 'cursor-default border-r border-border px-1 pt-1 pb-0.5 last:border-r-0',
                    out && 'bg-[color-mix(in_srgb,var(--app-bg)_55%,var(--app-surface))]',
                  )}
                  onClick={() => (compact ? onSelect(d) : onCreate(d))}
                >
                  <div className="flex min-w-0 items-center gap-1">
                    <button
                      type="button"
                      className={cn(
                        'mb-px flex-none rounded-full border-0 text-xs font-medium tabular-nums',
                        compact ? 'size-7 self-center p-0' : 'h-6 min-w-6 self-start px-1.5',
                        isToday
                          ? 'bg-accent font-semibold text-accent-fg'
                          : isSel
                            ? 'bg-accent-soft font-semibold text-accent'
                            : cn('bg-transparent hover:bg-hover', out ? 'text-muted' : 'text-fg'),
                      )}
                      aria-label={label}
                      onClick={(e) => {
                        e.stopPropagation()
                        if (compact) onSelect(d)
                        else onOpenDay(d)
                      }}
                    >
                      {d.getDate() === 1 && !compact ? fmtDate(d, { month: 'short', day: 'numeric' }) : d.getDate()}
                    </button>
                    {!compact && <PhotoBadge day={d} count={layers.photos?.[dayKey(d)]} />}
                  </div>
                  {compact ? (
                    <div className="flex h-1.5 items-center gap-0.5" aria-hidden="true">
                      {list.slice(0, 4).map((x) => (
                        <span
                          key={x.key}
                          className="size-1.25 flex-none rounded-full"
                          style={{ background: x.event ? colour(x.event) : x.bday ? 'var(--app-warning)' : 'var(--app-accent)' }}
                        />
                      ))}
                    </div>
                  ) : (
                    <div className="grid min-w-0 gap-0.5">
                      {shown.map((x) => (
                        <EntryChip key={x.key} x={x} day={d} colour={colour} onEvent={onEvent} onTask={layers.onTask} />
                      ))}
                      {hidden > 0 && (
                        <button
                          type="button"
                          className="h-4.5 rounded-xs border-0 bg-transparent px-1.25 text-left text-xs font-medium text-muted hover:bg-hover hover:text-fg"
                          onClick={(ev) => {
                            ev.stopPropagation()
                            setMoreDay(d)
                          }}
                        >
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
        <Dialog
          open
          onClose={() => setMoreDay(null)}
          title={fmtDate(moreDay, { weekday: 'long', month: 'long', day: 'numeric' })}
          width="22rem"
        >
          <div className="grid gap-0.5">
            {entries(moreDay).map((x) => (
              <EntryChip
                key={x.key}
                x={x}
                day={moreDay}
                big
                colour={colour}
                onEvent={(e) => {
                  setMoreDay(null)
                  onEvent(e)
                }}
                onTask={(t) => {
                  setMoreDay(null)
                  layers.onTask(t)
                }}
              />
            ))}
          </div>
        </Dialog>
      )}
    </div>
  )
}

function EntryChip({
  x,
  day,
  big,
  colour,
  onEvent,
  onTask,
}: {
  x: Entry
  day: Date
  big?: boolean
  colour: (e: CalEvent) => string
  onEvent: (e: CalEvent) => void
  onTask: (t: Task) => void
}) {
  if (x.event) return <EventChip e={x.event} day={day} big={big} colour={colour(x.event)} onClick={() => onEvent(x.event!)} />
  if (x.bday) return <BirthdayChip b={x.bday} big={big} />
  return <TaskChip task={x.task!} big={big} onOpen={onTask} />
}
