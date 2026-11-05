import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Route, Routes, useSearchParams } from 'react-router'
import { AppShell, SideSection } from '../../components/AppShell'
import { Icon } from '../../components/Icon'
import { Drawer, Menu, MenuItem, useHotkey, useMediaQuery, useNow } from '../../components/ui'
import { toast } from '../../components/toast'
import { get } from '../../lib/api'
import { addMonths, dayKey, fmtDate, fmtTime, isSameDay, monthGrid, parseDayKey, startOfDay } from '../../lib/dates'
import { keys, useCalendars, useCreateTask, useEvents } from '../../lib/queries'
import { useQueryClient } from '@tanstack/react-query'
import type { AgendaItem, CalEvent, Calendar, Task } from '../../lib/types'
import { Switch } from '../../components/ui'
import { useBirthdays, usePhotoCounts, useRangeTasks, useShowBirthdays, useShowTasks } from './extras'
import { CalendarMenu, CalendarSettings, NewCalendarDialog } from './CalendarSettings'
import { EventPeek } from './EventPeek'
import { EventSearch } from './EventSearch'
import { InlineFail } from '../../components/resilience'
import { readable, SURFACE } from '../../lib/colour'
import { useTheme } from '../../lib/theme'
import { AgendaView } from './AgendaView'
import { EventDialog, type EventDraft } from './EventDialog'
import { InsightsPanel } from './Insights'
import { DayList, MonthView } from './MonthView'
import { WeekView } from './WeekView'
import { useUpdateCalendar, useUpdateEvent } from './api'
import { CategoriesDialog } from './Categories'
import { PersonDialog, SubscribeDialog } from './Sharing'
import { eventsByDay, parseCalState, rangeTitle, stepDate, viewRange, type CalView } from './util'
import './calendar.css'

const FALLBACK = '#64748b'
// The Tasks app's drawer, loaded only when a task chip is opened.
const TaskDrawer = lazy(() => import('../tasks/TaskDrawer').then((m) => ({ default: m.TaskDrawer })))
const AvailabilityPage = lazy(() => import('./Availability'))

/** /calendar/* : the calendar, or someone's availability at /calendar/availability/:username. */
export default function CalendarPage() {
  return (
    <Routes>
      <Route path="availability/:username" element={<Suspense fallback={null}><AvailabilityPage /></Suspense>} />
      <Route path="*" element={<CalendarMain />} />
    </Routes>
  )
}

type Dlg = 'subscribe' | 'categories' | 'person' | null

function CalendarMain() {
  const [params, setParams] = useSearchParams()
  const state = parseCalState(params)
  const phone = useMediaQuery('(max-width: 760px)')
  const narrow = useMediaQuery('(max-width: 1100px)')
  const now = useNow(60_000)
  const weekDays = phone ? 3 : 7
  const [draft, setDraft] = useState<EventDraft | null>(null)

  const update = useCallback(
    (change: { view?: CalView; date?: Date; insights?: 'week' | 'month' | null }) => {
      setParams(
        (p) => {
          const next = new URLSearchParams(p)
          next.delete('new')
          if (change.view) change.view === 'month' ? next.delete('view') : next.set('view', change.view)
          if (change.date) isSameDay(change.date, new Date()) ? next.delete('date') : next.set('date', dayKey(change.date))
          if (change.insights !== undefined) change.insights ? next.set('insights', change.insights) : next.delete('insights')
          return next
        },
        { replace: true },
      )
    },
    [setParams],
  )

  // ?new=1 (from the app's "New event" menus) opens the create dialog once.
  useEffect(() => {
    if (state.isNew) {
      const s = new Date()
      s.setMinutes(s.getMinutes() < 30 ? 30 : 60, 0, 0)
      setDraft({ start: s })
      update({})
    }
  }, [state.isNew, update])

  const range = viewRange(state.view === 'agenda' ? 'week' : state.view, state.date, weekDays)
  const calendars = useCalendars()
  const [showDisabled, setShowDisabledState] = useState(() => { try { return localStorage.getItem('app.calendar.showDisabled') === '1' } catch { return false } })
  const setShowDisabled = (v: boolean) => { setShowDisabledState(v); try { localStorage.setItem('app.calendar.showDisabled', v ? '1' : '0') } catch { /* ignore */ } }
  const allCalendars = useCalendars(showDisabled)
  const [settingsFor, setSettingsFor] = useState<Calendar | null>(null)
  // Event details popover: clicking an event peeks at it; only Edit opens the form. ?event=<id> deep-links.
  const lastClicked = useRef<HTMLElement | null>(null)
  const [peek, setPeek] = useState<{ event: CalEvent; anchor: HTMLElement | null } | null>(null)
  const peekId = params.get('event')
  const setEventParam = (id: string | null) =>
    setParams((p) => { const n = new URLSearchParams(p); if (id) n.set('event', id); else n.delete('event'); return n }, { replace: true })
  const showPeek = (e: CalEvent) => {
    const el = lastClicked.current?.closest<HTMLElement>('[data-ev]') ?? null
    setPeek({ event: e, anchor: el })
    setEventParam(e.id)
  }
  const closePeek = () => { setPeek(null); setEventParam(null) }
  const editEvent = (e: CalEvent) => { setPeek(null); setEventParam(null); setDraft({ event: e }) }
  useEffect(() => {
    if (!peekId || peek?.event.id === peekId) return
    let live = true
    get<CalEvent>(`calendar/events/${peekId}`).then((e) => live && setPeek({ event: e, anchor: document.querySelector<HTMLElement>(`[data-ev="${e.id}"]`) }), () => live && setEventParam(null))
    return () => { live = false }
  }, [peekId])
  const [newCal, setNewCal] = useState(false)
  const [dlg, setDlg] = useState<Dlg>(null)
  // Events, photo counts and (optionally) tasks for the visible range load in parallel.
  const events = useEvents(range.start.toISOString(), range.end.toISOString())
  const photoCounts = usePhotoCounts(range.days).data
  // When the browser is idle, warm the next range's events so stepping forward is instant (one request, cached 2 min).
  const qc = useQueryClient()
  const nextKey = state.view === 'agenda' ? '' : dayKey(stepDate(state.view, state.date, 1, weekDays))
  useEffect(() => {
    if (!nextKey || !events.isSuccess) return
    const next = viewRange(state.view === 'agenda' ? 'week' : state.view, parseDayKey(nextKey), weekDays)
    const run = () => {
      const [s0, e0] = [next.start.toISOString(), next.end.toISOString()]
      qc.prefetchQuery({ queryKey: keys.events(s0, e0), queryFn: () => get<CalEvent[]>('calendar/events', { start: s0, end: e0 }), staleTime: 2 * 60_000 })
    }
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void }
    if (w.requestIdleCallback) {
      const id = w.requestIdleCallback(run, { timeout: 4000 })
      return () => w.cancelIdleCallback?.(id)
    }
    const t = setTimeout(run, 1500)
    return () => clearTimeout(t)
  }, [nextKey, events.isSuccess])
  const [showTasks, setShowTasks] = useShowTasks()
  const rangeTasks = useRangeTasks(range.start, range.end, showTasks && state.view !== 'agenda')
  const [showBirthdays, setShowBirthdays] = useShowBirthdays()
  const birthdays = useBirthdays(range.days, showBirthdays && state.view !== 'agenda')
  const taskId = params.get('task')
  const openTask = (t: Task) => setParams((p) => { const n = new URLSearchParams(p); n.set('task', t.id); return n })
  const closeTask = () => setParams((p) => { const n = new URLSearchParams(p); n.delete('task'); return n }, { replace: true })
  // Any #rrggbb works: marks are adjusted to keep 3:1 contrast on this theme's surface.
  const { dark } = useTheme()
  const colours = useMemo(
    () => new Map((calendars.data ?? []).map((c) => [c.id, readable(c.colour || FALLBACK, dark ? SURFACE.dark : SURFACE.light)])),
    [calendars.data, dark],
  )
  // An event's display_colour (its own colour, else my colour for its calendar) wins, contrast-adjusted.
  const colour = useCallback(
    (e: CalEvent) => (e.display_colour ? readable(e.display_colour, dark ? SURFACE.dark : SURFACE.light) : colours.get(e.calendar_id) ?? FALLBACK),
    [colours, dark],
  )
  const byDay = useMemo(() => eventsByDay(events.data ?? []), [events.data])

  const go = (dir: number) => update({ date: stepDate(state.view, state.date, dir, weekDays) })
  // Drag in the week/day grid: move or resize (an occurrence of a repeating event moves alone).
  const updateEvent = useUpdateEvent()
  const canMove = useCallback((e: CalEvent) => e.kind !== 'all_day' && !!calendars.data?.find((c) => c.id === e.calendar_id)?.can_edit, [calendars.data])
  const moveEvent = (e: CalEvent, start: Date, end: Date | null) => {
    const recurring = !!(e.recurring || e.series_id)
    const before = { start: e.start, end: e.end }
    const body = end ? { start: start.toISOString(), end: end.toISOString() } : { start: start.toISOString() }
    updateEvent.mutate({ id: e.id, scope: recurring ? 'this' : undefined, body }, {
      onSuccess: () => toast.show(start.getTime() === new Date(e.start).getTime() && end
        ? `"${e.name}" now ends at ${fmtTime(end)}`
        : `Moved "${e.name}" to ${fmtDate(start, { weekday: 'short', month: 'short', day: 'numeric' })}, ${fmtTime(start)}`, recurring ? {} : {
        action: { label: 'Undo', run: () => updateEvent.mutate({ id: e.id, body: before.end ? before : { start: before.start } }) },
      }),
    })
  }
  const today = () => update({ date: startOfDay(new Date()) })
  const newEvent = (start?: Date, end?: Date, allDay?: boolean) => {
    let s = start
    if (!s) {
      s = new Date(state.date)
      const n = new Date()
      if (isSameDay(s, n)) s.setHours(n.getHours() + 1, 0, 0, 0)
      else s.setHours(9, 0, 0, 0)
    } else if (!end && !allDay && s.getHours() === 0 && s.getMinutes() === 0) {
      s = new Date(s)
      s.setHours(9, 0, 0, 0) // a click on a month day: default to 9 AM
    }
    setDraft({ start: s, end, allDay })
  }
  const openAgenda = async (i: AgendaItem) => {
    try {
      showPeek(await get<CalEvent>(`calendar/events/${i.id}`))
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const quickStart = () => {
    const s = new Date()
    s.setSeconds(0, 0)
    s.setMinutes(Math.floor(s.getMinutes() / 15) * 15 + 15)
    setDraft({ start: s, end: new Date(s.getTime() + 3600_000) })
  }
  useHotkey((e) => !e.metaKey && !e.ctrlKey && !e.altKey && !draft && !document.querySelector('.dialog,.palette,.menu'), (e) => {
    const k = e.key
    if (k === 't') today()
    else if (k === 'j' || k === 'ArrowRight' || k === '.') state.view !== 'agenda' && go(1)
    else if (k === 'k' || k === 'ArrowLeft' || k === ',' || k === 'p') state.view !== 'agenda' && go(-1)
    else if (k === 'm') update({ view: 'month' })
    else if (k === 'w') update({ view: 'week' })
    else if (k === 'd') update({ view: 'day' })
    else if (k === 'a') update({ view: 'agenda' })
    else if (k === 'n') newEvent()
    else if (k === 'c') quickStart()
    else if (k === 's') setDlg('subscribe')
    else if (k === 'q') document.getElementById('cal-quick-task')?.focus()
    else if (k === 'i') update({ insights: state.insights ? null : state.view === 'month' ? 'month' : 'week' })
    else return
    e.preventDefault()
  })
  // Ctrl+←/→ previous/next, Ctrl+Shift+←/→ a year back/forward (as in the classic calendar).
  useHotkey((e) => (e.ctrlKey || e.metaKey) && !e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !draft && !document.querySelector('.dialog'), (e) => {
    e.preventDefault()
    const dir = e.key === 'ArrowRight' ? 1 : -1
    if (e.shiftKey) update({ date: addMonths(state.date, 12 * dir) })
    else if (state.view !== 'agenda') go(dir)
  })

  const title = rangeTitle(state.view, state.date, weekDays)
  const viewSeg = (
    <div className="seg cal-views" role="group" aria-label="View">
      {(['month', 'week', 'day', 'agenda'] as const).map((v) => (
        <button key={v} aria-pressed={state.view === v} onClick={() => update({ view: v })} title={`${v[0].toUpperCase() + v.slice(1)} (${v[0].toUpperCase()})`}>
          {v === 'week' && phone ? '3 days' : v[0].toUpperCase() + v.slice(1)}
        </button>
      ))}
    </div>
  )
  const nav = (
    <span className="cal-nav">
      <button className="btn ghost icon" onClick={() => go(-1)} aria-label="Previous" title="Previous (K)" disabled={state.view === 'agenda'}><Icon name="chevronLeft" /></button>
      <button className="btn ghost icon" onClick={() => go(1)} aria-label="Next" title="Next (J)" disabled={state.view === 'agenda'}><Icon name="chevronRight" /></button>
    </span>
  )

  const todayBtn = (
    <button className="btn cal-today" onClick={today} title={fmtDate(new Date(), { weekday: 'long', month: 'long', day: 'numeric' }) + ' (T)'}>Today</button>
  )
  const insightsBtn = (
    <button
      className={'btn ghost icon cal-ins-btn' + (state.insights ? ' on' : '')}
      aria-pressed={!!state.insights}
      onClick={() => update({ insights: state.insights ? null : state.view === 'month' ? 'month' : 'week' })}
      aria-label="Insights"
      title="Insights (I)"
    >
      <Icon name="chart" size={18} />
    </button>
  )

  const topbar = (
    <>
      {!phone && todayBtn}
      {!phone && nav}
      {!phone && <h1 className="cal-title" aria-live="polite">{title}</h1>}
      <span className="spacer" />
      <EventSearch calendars={calendars.data} onPick={(e) => {
        setPeek({ event: e, anchor: null })
        // One URL update for both, so neither overwrites the other.
        setParams((p) => { const n = new URLSearchParams(p); n.set('date', dayKey(new Date(e.start))); n.set('event', e.id); n.delete('new'); return n }, { replace: true })
      }} />
      {!phone && viewSeg}
      {!phone && insightsBtn}
      <button className="btn primary cal-new" onClick={() => newEvent()} title="New event (N)">
        <Icon name="plus" /> <span className="cal-new-text">New event</span>
      </button>
    </>
  )

  const insightsPanel = state.insights && (
    <InsightsPanel
      period={state.insights}
      date={state.date}
      onPeriod={(p) => update({ insights: p })}
      onDate={(d) => update({ date: d })}
      onClose={() => update({ insights: null })}
    />
  )

  return (
    <AppShell app="calendar" fullHeight topbar={topbar} sidebar={<Sidebar date={state.date} onDate={(d) => update({ date: d })} calendars={(showDisabled ? allCalendars.data : null) ?? calendars.data} showTasks={showTasks} onShowTasks={setShowTasks} showBirthdays={showBirthdays} onShowBirthdays={setShowBirthdays}
      showDisabled={showDisabled} onShowDisabled={setShowDisabled} onSettings={setSettingsFor} onNew={() => setNewCal(true)} onDialog={setDlg}
      updatedAt={events.dataUpdatedAt} refreshing={events.isFetching} onRefresh={() => (qc.invalidateQueries({ queryKey: ['calendar'] }), qc.invalidateQueries({ queryKey: ['photos', 'counts'] }), showTasks && qc.invalidateQueries({ queryKey: ['tasks', 'list'] }))} />}>
      <div className={'cal' + (events.isPlaceholderData ? ' loading' : '')}>
        {phone && (
          <div className="cal-subbar">
            <div className="row">
              {nav}
              <h1 className="cal-title grow">{title}</h1>
              {todayBtn}
              {insightsBtn}
            </div>
            {viewSeg}
          </div>
        )}
        {(events.isFetching || rangeTasks.isFetching) && <div className="cal-progress" role="progressbar" aria-label="Loading events" />}
        <div className="cal-main">
          <div
            className="cal-view"
            onClickCapture={(ev) => { lastClicked.current = ev.target as HTMLElement }}
            onDoubleClick={(ev) => {
              const id = (ev.target as HTMLElement).closest<HTMLElement>('[data-ev]')?.dataset.ev
              const e = id && events.data?.find((x) => x.id === id)
              if (e && colours.has(e.calendar_id) && calendars.data?.find((c) => c.id === e.calendar_id)?.can_edit) editEvent(e)
            }}
          >
            {/* A failed request never blanks the grid: the rest (tasks, birthdays, photos) still shows. */}
            {events.isError && state.view !== 'agenda' && <InlineFail what={events.data ? 'the latest events' : 'events'} retry={() => events.refetch()} />}
            {state.view === 'month' ? (
              <>
                <MonthView
                  days={range.days}
                  month={state.date.getMonth()}
                  byDay={byDay}
                  colour={colour}
                  today={now}
                  selected={state.date}
                  compact={phone}
                  onSelect={(d) => update({ date: d })}
                  onOpenDay={(d) => update({ view: 'week', date: d })}
                  onCreate={(d) => newEvent(d)}
                  onEvent={showPeek}
                  tasksByDay={rangeTasks.byDay}
                  photos={photoCounts}
                  onTask={openTask}
                  birthdaysByDay={birthdays}
                />
                {phone && (
                  <DayList day={state.date} events={byDay.get(dayKey(state.date)) ?? []} colour={colour} onEvent={showPeek} onCreate={() => newEvent()}
                    tasks={rangeTasks.byDay.get(dayKey(state.date))} onTask={openTask} photos={photoCounts?.[dayKey(state.date)]} birthdays={birthdays.get(dayKey(state.date))} />
                )}
              </>
            ) : state.view === 'week' || state.view === 'day' ? (
              <WeekView
                canEdit={canMove}
                onMove={moveEvent}
                days={range.days}
                byDay={byDay}
                colour={colour}
                now={now}
                onCreate={newEvent}
                onEvent={showPeek}
                onOpenDay={(d) => update({ date: d, view: 'day' })}
                tasksByDay={rangeTasks.byDay}
                photos={photoCounts}
                onTask={openTask}
                birthdaysByDay={birthdays}
              />
            ) : (
              <AgendaView onOpen={openAgenda} />
            )}
          </div>
          {!narrow && insightsPanel}
        </div>
      </div>
      {narrow && (
        <Drawer open={!!state.insights} onClose={() => update({ insights: null })} label="Calendar insights">
          {insightsPanel}
        </Drawer>
      )}
      {taskId && (
        <Suspense fallback={null}>
          <TaskDrawer id={taskId} onClose={closeTask} onOpen={(id) => openTask({ id } as Task)} />
        </Suspense>
      )}
      {peek && !draft && (
        <EventPeek key={peek.event.id} event={peek.event} anchor={peek.anchor} calendar={calendars.data?.find((c) => c.id === peek.event.calendar_id)} onClose={closePeek} onEdit={editEvent} />
      )}
      <CalendarSettings calendar={settingsFor} onClose={() => setSettingsFor(null)} />
      {newCal && <NewCalendarDialog open onClose={() => setNewCal(false)} onCreated={(c) => setSettingsFor(c)} />}
      <SubscribeDialog open={dlg === 'subscribe'} onClose={() => setDlg(null)} onSettings={setSettingsFor} onNewCalendar={() => setNewCal(true)} />
      {dlg === 'categories' && <CategoriesDialog open onClose={() => setDlg(null)} />}
      <PersonDialog open={dlg === 'person'} onClose={() => setDlg(null)} />
      {draft && <EventDialog key={'event' in draft ? draft.event.id : draft.start.getTime()} draft={draft} onClose={() => setDraft(null)} />}
    </AppShell>
  )
}

function Sidebar({ date, onDate, calendars, showTasks, onShowTasks, showBirthdays, onShowBirthdays, showDisabled, onShowDisabled, onSettings, onNew, onDialog, updatedAt, refreshing, onRefresh }: {
  date: Date; onDate: (d: Date) => void; calendars?: Calendar[]; showTasks: boolean; onShowTasks: (v: boolean) => void
  showBirthdays: boolean; onShowBirthdays: (v: boolean) => void
  showDisabled: boolean; onShowDisabled: (v: boolean) => void; onSettings: (c: Calendar) => void; onNew: () => void
  onDialog: (d: Dlg) => void; updatedAt: number; refreshing: boolean; onRefresh: () => void
}) {
  const toggle = useUpdateCalendar()
  const mine = (calendars ?? []).filter((c) => c.role !== 'subscriber')
  const other = (calendars ?? []).filter((c) => c.role === 'subscriber')
  const list = (cals: Calendar[]) =>
    cals.map((c) => (
      <div key={c.id} className={'cal-side-row' + (c.active ? '' : ' disabled')}>
        <label className="cal-check side-item" title={c.synced ? `${c.name} (synced)` : c.name}>
          <input
            type="checkbox"
            checked={c.visible && c.active}
            disabled={!c.active}
            onChange={(e) => toggle.mutate({ id: c.id, visible: e.target.checked })}
            style={{ '--c': readable(c.colour || FALLBACK, document.documentElement.getAttribute('data-bs-theme') === 'dark' ? SURFACE.dark : SURFACE.light) } as React.CSSProperties}
          />
          <span className="grow truncate">{c.name}</span>
          {!c.active && <span className="chip">Disabled</span>}
          {c.synced && <Icon name="refresh" size={12} className="muted" title="Synced" />}
          {c.public && <Icon name="link" size={12} className="muted" title="Public" />}
        </label>
        <CalendarMenu calendar={c} onSettings={() => onSettings(c)} onOnly={() => (calendars ?? []).forEach((o) => o.visible !== (o.id === c.id) && toggle.mutate({ id: o.id, visible: o.id === c.id }))} />
      </div>
    ))
  return (
    <div className="cal-side">
      <MiniMonth date={date} onDate={onDate} />
      <SideSection title="My calendars" action={
        <Menu align="end" label="Add calendar" trigger={(p) => <button {...p} className="btn ghost icon sm" aria-label="Add calendar" title="Add calendar (S: subscribe)"><Icon name="plus" size={14} /></button>}>
          {(close) => (
            <>
              <MenuItem icon="plus" onClick={() => (close(), onNew())}>New calendar</MenuItem>
              <MenuItem icon="link" onClick={() => (close(), onDialog('subscribe'))} end={<span className="kbd">S</span>}>Subscribe with code</MenuItem>
              <div className="menu-sep" />
              <MenuItem icon="tag" onClick={() => (close(), onDialog('categories'))}>Event categories</MenuItem>
              <MenuItem icon="users" onClick={() => (close(), onDialog('person'))}>View someone's availability</MenuItem>
            </>
          )}
        </Menu>
      }>{list(mine)}</SideSection>
      <SideSection title="Other calendars" action={<button className="btn ghost icon sm" onClick={() => onDialog('subscribe')} aria-label="Subscribe with code" title="Subscribe with code (S)"><Icon name="plus" size={14} /></button>}>
        {other.length ? list(other) : <button className="side-item muted" onClick={() => onDialog('subscribe')}><Icon name="link" size={16} /><span className="grow truncate">Subscribe with a code</span></button>}
      </SideSection>
      <SideSection>
        <button className="side-item" onClick={() => onDialog('person')}><Icon name="users" size={16} /><span className="grow truncate">View someone's availability</span></button>
        <button className="side-item" onClick={() => onDialog('categories')}><Icon name="tag" size={16} /><span className="grow truncate">Event categories</span></button>
      </SideSection>
      <QuickTask />
      <SideSection title="Show">
        <div className="side-switch"><Switch checked={showTasks} onChange={onShowTasks} label="Tasks with due dates" /></div>
        <div className="side-switch"><Switch checked={showBirthdays} onChange={onShowBirthdays} label="Birthdays" /></div>
        <div className="side-switch"><Switch checked={showDisabled} onChange={onShowDisabled} label="Disabled calendars" /></div>
      </SideSection>
      <button className="cal-refresh xsmall muted" onClick={onRefresh} disabled={refreshing} title="Refresh now">
        <Icon name="refresh" size={12} className={refreshing ? 'spin' : ''} />{updatedAt ? `Refreshed ${fmtTime(new Date(updatedAt))}` : 'Refresh'}
      </button>
      <p className="cal-keys xsmall muted">
        <span className="kbd">T</span> today <span className="kbd">J</span>/<span className="kbd">K</span> move <span className="kbd">M</span>
        <span className="kbd">W</span> <span className="kbd">D</span> <span className="kbd">A</span> views <span className="kbd">N</span>/<span className="kbd">C</span> new <span className="kbd">Q</span> task
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
    create.mutate({ quick: t }, { onSuccess: (task) => (setText(''), toast.show(`Added "${task.title}"${task.due ? ` · due ${fmtDate(new Date(task.due), { month: 'short', day: 'numeric' })}` : ''}`)) })
  }
  return (
    <SideSection title="Quick task">
      <form className="cal-quick" onSubmit={(e) => (e.preventDefault(), submit())}>
        <Icon name="plus" size={14} />
        <input id="cal-quick-task" value={text} onChange={(e) => setText(e.target.value)} maxLength={512} placeholder="Add a task" aria-label="Quick add a task" title="Try: Pay rent tomorrow 5pm !3 every month"
          onKeyDown={(e) => e.key === 'Escape' && (e.currentTarget.blur(), setText(''))} disabled={create.isPending} />
        <span className="kbd">Q</span>
      </form>
    </SideSection>
  )
}

function MiniMonth({ date, onDate }: { date: Date; onDate: (d: Date) => void }) {
  const [shown, setShown] = useState(() => new Date(date.getFullYear(), date.getMonth(), 1))
  useEffect(() => {
    setShown(new Date(date.getFullYear(), date.getMonth(), 1))
  }, [date])
  const grid = monthGrid(shown)
  const today = new Date()
  return (
    <div className="mini">
      <div className="mini-head">
        <span className="grow">{fmtDate(shown, { month: 'long', year: 'numeric' })}</span>
        <button className="btn ghost icon sm" aria-label="Previous month" onClick={() => setShown(new Date(shown.getFullYear(), shown.getMonth() - 1, 1))}><Icon name="chevronLeft" size={14} /></button>
        <button className="btn ghost icon sm" aria-label="Next month" onClick={() => setShown(new Date(shown.getFullYear(), shown.getMonth() + 1, 1))}><Icon name="chevronRight" size={14} /></button>
      </div>
      <div className="mini-grid" role="grid">
        {grid[0].map((d) => <span key={'h' + d.getDay()} className="mini-wd" aria-hidden="true">{fmtDate(d, { weekday: 'narrow' })}</span>)}
        {grid.flat().map((d) => (
          <button
            key={d.getTime()}
            type="button"
            className={'mini-day tabular' + (d.getMonth() !== shown.getMonth() ? ' out' : '') + (isSameDay(d, today) ? ' today' : '') + (isSameDay(d, date) ? ' sel' : '')}
            onClick={() => onDate(d)}
            aria-label={fmtDate(d, { weekday: 'long', month: 'long', day: 'numeric' })}
            aria-current={isSameDay(d, date) ? 'date' : undefined}
          >
            {d.getDate()}
          </button>
        ))}
      </div>
    </div>
  )
}

