// The calendar's sidebar: a mini month, my and other calendars (with their "…" menus), shortcuts to the
// sharing dialogs, a quick task field, what to show, week start and display zone, and the refresh line.
import { useState, type CSSProperties } from 'react'
import { SideSection } from '../../components/AppShell'
import { Icon } from '../../components/Icon'
import { Button, buttonClass, Menu, MenuItem, MenuSeparator, Segmented, Switch } from '../../components/ui'
import { toast } from '../../components/toast'
import { cn } from '../../lib/cn'
import { fmtDate, isSameDay, monthGrid } from '../../lib/dates'
import { useCreateTask } from '../../lib/queries'
import type { Calendar } from '../../lib/types'
import { useSetVisible } from './api'
import { CalendarMenu } from './CalendarMenu'
import { pillSm } from './chips'
import { useReadable } from './colours'
import { HOME_ZONE, fmtTimeIn, gmtLabel, zoneCity, type WeekStart, type Zone } from './zone'

export type SidebarDialog = 'subscribe' | 'categories' | 'person'

export interface SidebarProps {
  /** The mini month: the selected day, today, and picking a day. */
  mini: { date: Date; today: Date; onDate: (d: Date) => void }
  calendars?: Calendar[]
  /** Disabled calendars whose events are shown anyway. */
  peek: { ids: number[]; toggle: (id: number) => void }
  show: {
    tasks: boolean
    setTasks: (v: boolean) => void
    birthdays: boolean
    setBirthdays: (v: boolean) => void
    disabled: boolean
    setDisabled: (v: boolean) => void
  }
  view: { weekStart: WeekStart; setWeekStart: (v: WeekStart) => void; tz: Zone; now: Date; onZone: () => void }
  open: { settings: (c: Calendar) => void; newCalendar: () => void; dialog: (d: SidebarDialog) => void }
  refresh: { at: number; busy: boolean; run: () => void }
}

const sideIcon = buttonClass({ variant: 'ghost', size: 'sm', icon: true })
/** A menu item's handler: close the menu, then act (a dialog opens on the page, not over the menu). */
const act = (close: () => void, fn: () => void) => () => {
  close()
  fn()
}

export function CalendarSidebar({ mini, calendars, peek, show, view, open, refresh }: SidebarProps) {
  const toggle = useSetVisible()
  const mark = useReadable()
  const mine = (calendars ?? []).filter((c) => c.role !== 'subscriber')
  const other = (calendars ?? []).filter((c) => c.role === 'subscriber')
  const list = (cals: Calendar[]) =>
    cals.map((c) => (
      <div key={c.id} className="group relative flex items-center">
        {/* side-item is the shell's older unlayered row style, so the overrides here need !important */}
        <label
          className={cn('side-item min-w-0 flex-1 cursor-pointer pr-8! [&>:not(.flex-auto)]:flex-none', !c.active && 'opacity-55')}
          title={c.synced ? `${c.name} (synced)` : c.name}
        >
          <input
            type="checkbox"
            checked={c.visible && c.active}
            disabled={!c.active}
            onChange={(e) => toggle.mutate({ id: c.id, visible: e.target.checked })}
            className={cn(
              'm-0 grid size-3.75 flex-none cursor-pointer appearance-none place-items-center rounded-xs border-[1.5px] border-solid border-(--c) bg-transparent',
              'checked:bg-(--c) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
              'checked:after:h-2 checked:after:w-1 checked:after:-translate-y-px checked:after:rotate-45 checked:after:border-0 checked:after:border-r-2 checked:after:border-b-2 checked:after:border-solid checked:after:border-white checked:after:content-[""]',
            )}
            style={{ '--c': mark(c.colour) } as CSSProperties}
          />
          <span className="min-w-0 flex-auto truncate">{c.name}</span>
          {!c.active && <span className={pillSm}>{peek.ids.includes(c.id) ? 'Shown' : 'Disabled'}</span>}
          {c.synced && <Icon name="refresh" size={12} className="text-muted" title="Synced" />}
          {c.public && <Icon name="link" size={12} className="text-muted" title="Public" />}
        </label>
        <CalendarMenu
          calendar={c}
          onSettings={() => open.settings(c)}
          onPeek={c.active ? undefined : () => peek.toggle(c.id)}
          peeking={peek.ids.includes(c.id)}
          onOnly={() => {
            for (const o of calendars ?? []) if (o.visible !== (o.id === c.id)) toggle.mutate({ id: o.id, visible: o.id === c.id })
          }}
        />
      </div>
    ))
  const sideLink = (icon: string, text: string, onClick: () => void, muted = false) => (
    <button type="button" className={cn('side-item', muted && 'text-muted!')} onClick={onClick}>
      <Icon name={icon} size={16} />
      <span className="min-w-0 flex-auto truncate">{text}</span>
    </button>
  )
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] content-start gap-4">
      <MiniMonth {...mini} weekStart={view.weekStart} />
      <SideSection
        title="My calendars"
        action={
          <Menu
            align="end"
            label="Add calendar"
            trigger={(p) => (
              <button {...p} type="button" className={sideIcon} aria-label="Add calendar" title="Add calendar (S: subscribe)">
                <Icon name="plus" size={14} />
              </button>
            )}
          >
            {(close) => (
              <>
                <MenuItem icon="plus" onClick={act(close, () => open.newCalendar())}>
                  New calendar
                </MenuItem>
                <MenuItem icon="link" onClick={act(close, () => open.dialog('subscribe'))} end={<span className="kbd">S</span>}>
                  Subscribe with code
                </MenuItem>
                <MenuSeparator />
                <MenuItem icon="tag" onClick={act(close, () => open.dialog('categories'))}>
                  Event categories
                </MenuItem>
                <MenuItem icon="users" onClick={act(close, () => open.dialog('person'))}>
                  View someone's availability
                </MenuItem>
              </>
            )}
          </Menu>
        }
      >
        {list(mine)}
      </SideSection>
      <SideSection
        title="Other calendars"
        action={
          <Button
            variant="ghost"
            size="sm"
            icon
            onClick={() => open.dialog('subscribe')}
            aria-label="Subscribe with code"
            title="Subscribe with code (S)"
          >
            <Icon name="plus" size={14} />
          </Button>
        }
      >
        {other.length ? list(other) : sideLink('link', 'Subscribe with a code', () => open.dialog('subscribe'), true)}
      </SideSection>
      <SideSection>
        {sideLink('users', "View someone's availability", () => open.dialog('person'))}
        {sideLink('tag', 'Event categories', () => open.dialog('categories'))}
      </SideSection>
      <QuickTask />
      <SideSection title="Show">
        <div className="px-2 py-1">
          <Switch checked={show.tasks} onChange={show.setTasks} label="Tasks with due dates" />
        </div>
        <div className="px-2 py-1">
          <Switch checked={show.birthdays} onChange={show.setBirthdays} label="Birthdays" />
        </div>
        <div className="px-2 py-1">
          <Switch checked={show.disabled} onChange={show.setDisabled} label="Disabled calendars" />
        </div>
      </SideSection>
      <SideSection title="View">
        <div className="flex items-center justify-between gap-2 px-2 py-1">
          <span className="text-sm">Week starts on</span>
          <Segmented
            label="Week starts on"
            className={cn('[&>button]:min-w-11 [&>button]:justify-center')}
            value={String(view.weekStart)}
            onChange={(v) => view.setWeekStart(Number(v) as WeekStart)}
            options={[
              { value: '0', label: 'Sun', title: 'Sunday' },
              { value: '1', label: 'Mon', title: 'Monday' },
            ]}
          />
        </div>
        <button type="button" className="side-item" onClick={view.onZone} title="Show the calendar in another time zone (this window only)">
          <Icon name="globe" size={16} />
          <span className="min-w-0 flex-auto truncate">{view.tz ? zoneCity(view.tz) : `${zoneCity(HOME_ZONE)} (yours)`}</span>
          <span className="flex-none text-xs text-muted tabular-nums">{gmtLabel(view.now.getTime(), view.tz ?? HOME_ZONE)}</span>
        </button>
      </SideSection>
      <button
        type="button"
        className="mx-2 inline-flex items-center gap-1.5 justify-self-start rounded-sm border-0 bg-transparent px-1 py-0.5 text-xs text-muted hover:bg-hover hover:text-fg"
        onClick={refresh.run}
        disabled={refresh.busy}
        title="Refresh now"
      >
        <Icon name="refresh" size={12} className={refresh.busy ? 'animate-spin' : ''} />
        {refresh.at ? `Refreshed ${fmtTimeIn(refresh.at, view.tz)}` : 'Refresh'}
      </button>
      <p className="px-2 text-xs leading-loose text-muted [&_.kbd]:mx-px">
        <span className="kbd">T</span> today <span className="kbd">J</span>/<span className="kbd">K</span> move{' '}
        <span className="kbd">M</span>
        <span className="kbd">W</span> <span className="kbd">D</span> <span className="kbd">A</span> views <span className="kbd">N</span>/
        <span className="kbd">C</span> new <span className="kbd">Q</span> task
        <span className="kbd">S</span> subscribe <span className="kbd">/</span> search <span className="kbd">I</span> insights
      </p>
    </div>
  )
}

/** Quick add a task (same natural language as the Tasks app: "Pay rent tomorrow 5pm !3"). */
function QuickTask() {
  const [text, setText] = useState('')
  const create = useCreateTask()
  const submit = () => {
    const t = text.trim()
    if (!t) return
    create.mutate(
      { quick: t },
      {
        onSuccess: (task) => {
          setText('')
          toast.show(`Added "${task.title}"${task.due ? ` · due ${fmtDate(new Date(task.due), { month: 'short', day: 'numeric' })}` : ''}`)
        },
      },
    )
  }
  return (
    <SideSection title="Quick task">
      <form
        className="group/q mx-1 flex h-8 items-center gap-1.5 rounded-sm border border-transparent bg-surface-2 px-2 text-muted focus-within:border-border focus-within:bg-surface"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <Icon name="plus" size={14} />
        <input
          id="cal-quick-task"
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={512}
          placeholder="Add a task"
          aria-label="Quick add a task"
          title="Try: Pay rent tomorrow 5pm !3 every month"
          className="min-w-0 flex-1 border-0 bg-transparent text-sm text-fg outline-none"
          onKeyDown={(e) => {
            if (e.key !== 'Escape') return
            e.currentTarget.blur()
            setText('')
          }}
          disabled={create.isPending}
        />
        <span className="kbd flex-none group-focus-within/q:hidden!">Q</span>
      </form>
    </SideSection>
  )
}

function MiniMonth({ date, today, weekStart, onDate }: { date: Date; today: Date; weekStart: WeekStart; onDate: (d: Date) => void }) {
  const first = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1)
  const [shown, setShown] = useState(() => first(date))
  // A newly selected date shows its month (during render, not in an effect); the arrows browse freely.
  const [seen, setSeen] = useState(date)
  if (seen.getTime() !== date.getTime()) {
    setSeen(date)
    setShown(first(date))
  }
  const grid = monthGrid(shown, weekStart)
  return (
    <div className="px-1 pt-1">
      <div className="flex h-7 items-center gap-0.5 pl-1.5 text-sm font-semibold">
        <span className="min-w-0 flex-auto">{fmtDate(shown, { month: 'long', year: 'numeric' })}</span>
        <Button
          variant="ghost"
          size="sm"
          icon
          aria-label="Previous month"
          onClick={() => setShown(new Date(shown.getFullYear(), shown.getMonth() - 1, 1))}
        >
          <Icon name="chevronLeft" size={14} />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          icon
          aria-label="Next month"
          onClick={() => setShown(new Date(shown.getFullYear(), shown.getMonth() + 1, 1))}
        >
          <Icon name="chevronRight" size={14} />
        </Button>
      </div>
      <div className="mt-1 grid grid-cols-7 gap-px">
        {grid[0].map((d) => (
          <span key={`h${d.getDay()}`} className="h-6 text-center text-2xs leading-6 font-medium text-muted" aria-hidden="true">
            {fmtDate(d, { weekday: 'narrow' })}
          </span>
        ))}
        {grid.flat().map((d) => {
          const isToday = isSameDay(d, today)
          const sel = isSameDay(d, date)
          return (
            <button
              key={d.getTime()}
              type="button"
              className={cn(
                'size-7 justify-self-center rounded-full border-0 p-0 text-xs tabular-nums',
                isToday
                  ? 'bg-accent font-semibold text-accent-fg'
                  : sel
                    ? 'bg-accent-soft font-semibold text-accent'
                    : cn('bg-transparent hover:bg-hover', d.getMonth() !== shown.getMonth() ? 'text-muted opacity-70' : 'text-fg'),
              )}
              onClick={() => onDate(d)}
              aria-label={fmtDate(d, { weekday: 'long', month: 'long', day: 'numeric' })}
              aria-current={sel ? 'date' : undefined}
            >
              {d.getDate()}
            </button>
          )
        })}
      </div>
    </div>
  )
}
