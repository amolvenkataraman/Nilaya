// Under the phone month grid: the selected day's birthdays, tasks and events, in agenda rows.
import { Icon } from '../../components/Icon'
import { Button } from '../../components/ui'
import { fmtDate } from '../../lib/dates'
import type { CalEvent, Task } from '../../lib/types'
import { AgendaLine, agendaItem } from './AgendaView'
import { BirthdayChip, PhotoBadge, TaskChip } from './chips'
import type { Birthday } from './types'
import { fmtTimeIn, useCalPrefs } from './zone'

export function DayList({
  day,
  events,
  colour,
  onEvent,
  onCreate,
  tasks = [],
  onTask,
  photos,
  birthdays = [],
}: {
  day: Date
  events: CalEvent[]
  colour: (e: CalEvent) => string
  onEvent: (e: CalEvent) => void
  onCreate: () => void
  tasks?: Task[]
  onTask: (t: Task) => void
  photos?: number
  birthdays?: Birthday[]
}) {
  const { tz } = useCalPrefs()
  const title = fmtDate(day, { weekday: 'long', month: 'long', day: 'numeric' })
  const chips = 'grid gap-0.5 px-2 pb-2'
  return (
    <section className="border-t border-border px-2 pt-2 pb-4" aria-label={title}>
      <div className="flex items-center px-2 pt-1 pb-2">
        <h2 className="flex-1 text-sm">{title}</h2>
        <PhotoBadge day={day} count={photos} />
        <Button variant="ghost" size="sm" onClick={onCreate}>
          <Icon name="plus" size={14} /> Add
        </Button>
      </div>
      {birthdays.length > 0 && (
        <div className={chips}>
          {birthdays.map((b) => (
            <BirthdayChip key={b.id} b={b} big />
          ))}
        </div>
      )}
      {tasks.length > 0 && (
        <div className={chips}>
          {tasks.map((t) => (
            <TaskChip key={t.id} task={t} big onOpen={onTask} />
          ))}
        </div>
      )}
      {events.length === 0 && !tasks.length && !birthdays.length ? (
        <p className="p-4 text-sm text-muted">Nothing scheduled.</p>
      ) : events.length === 0 ? null : (
        <ul>
          {events.map((e) => (
            <li key={e.id}>
              <button type="button" className={agendaItem} data-ev={e.id} onClick={() => onEvent(e)}>
                <AgendaLine
                  colour={colour(e)}
                  time={e.all_day ? 'All day' : fmtTimeIn(new Date(e.start), tz)}
                  icon={e.kind === 'deadline' ? 'flag' : undefined}
                  title={e.name}
                  done={e.completed}
                  sub={e.location || undefined}
                />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
