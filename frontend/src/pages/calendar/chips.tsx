// The small marks the views share: an event chip (month cells, the all-day row, the "N more" list), a task chip
// with its checkbox, a birthday chip and a day's photo count. Colours come in as --c, so one chip serves every
// calendar colour and theme.
import type { CSSProperties } from 'react'
import { Link, useNavigate } from 'react-router'
import { Icon } from '../../components/Icon'
import { TaskCheck } from '../../components/TaskRow'
import { cn } from '../../lib/cn'
import { dayKey, fmtDate, isSameDay } from '../../lib/dates'
import { plural } from '../../lib/format'
import { useSetDone } from '../../lib/queries'
import type { CalEvent, Task } from '../../lib/types'
import { categoryName, eventIcon } from './format'
import { isAllDayTask } from './layers'
import { eventDays } from './range'
import type { Birthday } from './types'
import { chipTime, fmtTimeIn, useCalPrefs } from './zone'

/** Events of a disabled calendar shown on request ("Show events"): greyed and dashed, read-only. */
export const GHOST = 'opacity-60 outline-1 outline-dashed outline-current -outline-offset-1 grayscale-60'

/** A small rounded label (a tag, "View only", "Owner"). Master has a shared Chip for this; switch when merged. */
const pillBase =
  'inline-flex items-center gap-1 rounded-full border border-border bg-surface-2 px-1.75 font-medium whitespace-nowrap text-muted'
export const pill = `${pillBase} h-5 text-xs`
/** The smaller pill used inside dense rows (sidebar, people list). */
export const pillSm = `${pillBase} h-4 text-3xs`
/** A coloured dot (calendar colour); the colour comes in as style. */
export const dot = 'size-2 flex-none rounded-full'

const chipBase = 'flex w-full min-w-0 items-center rounded-xs border-0 text-left text-fg leading-none'

export function EventChip({
  e,
  colour,
  day,
  big,
  onClick,
}: {
  e: CalEvent
  colour: string
  day?: Date
  /** The roomier rows of the "N more" list. */
  big?: boolean
  onClick: () => void
}) {
  const { tz } = useCalPrefs()
  const style = { '--c': colour } as CSSProperties
  const cat = categoryName(e)
  const label = `${e.name}${e.all_day ? ', all day' : `, ${fmtTimeIn(new Date(e.start), tz)}${e.end && e.kind === 'event' ? ` – ${fmtTimeIn(new Date(e.end), tz)}` : ''}`}${cat ? ` · ${cat}` : ''}${e.location ? ` · ${e.location}` : ''}${e.recurrence_text ? ` · ${e.recurrence_text}` : ''}`
  const icon = eventIcon(e)
  const size = big ? 'h-7 text-sm' : 'h-5 text-xs'
  if (e.all_day) {
    const { first, last } = eventDays(e)
    const cont = day && !isSameDay(first, day)
    const more = day && !isSameDay(last, day)
    return (
      <button
        type="button"
        data-ev={e.id}
        className={cn(
          chipBase,
          size,
          'gap-1.25 pr-1.25 pl-2 font-medium',
          'bg-[color-mix(in_srgb,var(--c)_18%,var(--app-surface))] hover:bg-[color-mix(in_srgb,var(--c)_26%,var(--app-surface))]',
          cont ? 'rounded-l-none' : 'shadow-[inset_3px_0_0_var(--c)]',
          more && 'rounded-r-none',
          e.ghost && GHOST,
        )}
        style={style}
        onClick={(ev) => {
          ev.stopPropagation()
          onClick()
        }}
        title={label}
        aria-label={label}
      >
        {icon && <Icon name={icon} size={11} />}
        <span className="min-w-0 truncate">{e.name}</span>
      </button>
    )
  }
  return (
    <button
      type="button"
      data-ev={e.id}
      className={cn(chipBase, size, 'gap-1.25 bg-transparent px-1.25 hover:bg-hover', e.ghost && GHOST)}
      style={style}
      onClick={(ev) => {
        ev.stopPropagation()
        onClick()
      }}
      title={label}
      aria-label={label}
    >
      {e.kind === 'deadline' || icon ? (
        <Icon name={e.kind === 'deadline' ? 'flag' : icon!} size={11} className="flex-none text-(--c)" />
      ) : (
        <span className="size-1.75 flex-none rounded-full bg-(--c)" />
      )}
      {e.recurring && <Icon name="repeat" size={9} className="-ml-0.75 flex-none text-muted" />}
      <span className="flex-none text-muted tabular-nums">{chipTime(new Date(e.start), tz)}</span>
      <span className={cn('min-w-0 truncate', e.completed && 'text-muted line-through')}>{e.name}</span>
    </button>
  )
}

export function TaskChip({
  task,
  onOpen,
  big,
  floating,
}: {
  task: Task
  onOpen: (t: Task) => void
  big?: boolean
  /** On the time grid, over the hour lines: a solid card. */
  floating?: boolean
}) {
  const setDone = useSetDone()
  const { tz } = useCalPrefs()
  const timed = !isAllDayTask(task)
  const label = `Task: ${task.title}${timed ? `, due ${fmtTimeIn(new Date(task.due!), tz)}` : ''}`
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/useKeyWithClickEvents: only stops the click reaching the day (which would create an event); the controls inside are buttons
    <div
      className={cn(
        'flex w-full min-w-0 items-center gap-1.25 rounded-xs px-1.25',
        // TaskCheck's .check is older unlayered CSS, so these overrides need !important to win.
        big ? 'h-8 text-sm [&_.check]:size-4!' : 'h-5 text-xs [&_.check]:size-3.25!',
        '[&_.check]:border-[1.25px]! [&_.check_svg]:size-2!',
        floating
          ? 'bg-surface shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--app-accent)_35%,var(--app-border)),0_1px_2px_rgba(16,24,40,0.08)]'
          : 'bg-[color-mix(in_srgb,var(--app-accent)_7%,transparent)] shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--app-accent)_22%,transparent)] hover:bg-[color-mix(in_srgb,var(--app-accent)_12%,transparent)]',
      )}
      title={label}
      onClick={(e) => e.stopPropagation()}
    >
      <TaskCheck task={task} onToggle={() => setDone.mutate({ task, done: !task.done })} />
      {timed && <span className="flex-none text-muted tabular-nums">{chipTime(new Date(task.due!), tz)}</span>}
      <button
        type="button"
        className={cn('min-w-0 flex-1 truncate border-0 bg-transparent p-0 text-left', task.done ? 'text-muted line-through' : 'text-fg')}
        onClick={() => onOpen(task)}
        aria-label={`Open ${label}`}
      >
        {task.title}
      </button>
    </div>
  )
}

export function PhotoBadge({ day, count, className }: { day: Date; count?: number; className?: string }) {
  if (!count) return null
  const label = `${plural(count, 'photo')} on ${fmtDate(day, { weekday: 'long', month: 'long', day: 'numeric' })}`
  return (
    <Link
      to={`/photos?date=${dayKey(day)}`}
      className={cn(
        'inline-flex h-4.5 flex-none items-center gap-0.75 rounded-full px-1.25 text-2xs leading-none text-muted tabular-nums',
        'hover:bg-hover hover:text-fg hover:no-underline [&_svg]:opacity-80',
        className ?? 'ml-auto',
      )}
      title={label}
      aria-label={label}
      onClick={(e) => e.stopPropagation()}
    >
      <Icon name="photo" size={11} />
      {count > 999 ? '999+' : count}
    </Link>
  )
}

export function BirthdayChip({ b, big }: { b: Birthday; big?: boolean }) {
  const navigate = useNavigate()
  const first = b.name.split(/\s+/)[0] || b.name
  const text = b.age ? `${first} turns ${b.age}` : `${first}'s birthday`
  return (
    <button
      type="button"
      className={cn(
        'flex w-full min-w-0 items-center gap-1.25 rounded-xs border-0 px-1.5 text-left font-medium text-fg',
        'bg-warning-soft shadow-[inset_3px_0_0_var(--app-warning)] hover:bg-[color-mix(in_srgb,var(--app-warning)_24%,transparent)]',
        big ? 'h-8 text-sm' : 'h-5 text-xs',
      )}
      title={`${b.name}${b.age ? ` turns ${b.age}` : ''}: open contact`}
      onClick={(e) => {
        e.stopPropagation()
        navigate(`/contacts?person=${b.id}`)
      }}
    >
      <Icon name="gift" size={12} className="flex-none text-warning" />
      <span className="min-w-0 truncate">{text}</span>
    </button>
  )
}
