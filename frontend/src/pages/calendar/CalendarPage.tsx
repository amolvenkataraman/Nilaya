// /calendar/*: the calendar (month, week, day, agenda) or someone's availability. This file wires the pieces:
// URL state (useCalendarUrl), data for the visible range (useCalendarData), colours, keys, the top bar and
// sidebar, and the overlays (event peek and form, settings, dialogs) that open on top.
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Route, Routes } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { AppShell } from '../../components/AppShell'
import { Drawer, useIsPhone, useMediaQuery, useNow } from '../../components/ui'
import { InlineFail } from '../../components/resilience'
import { toast } from '../../components/toast'
import { cn } from '../../lib/cn'
import { dayKey, isSameDay } from '../../lib/dates'
import { ownerId } from '../../lib/owner'
import { useCalendars, useMe } from '../../lib/queries'
import { usePref } from '../../lib/storage'
import type { AgendaItem, CalEvent, Calendar, Task } from '../../lib/types'
import { AgendaView } from './AgendaView'
import { ck, eventDetailQuery, useUpdateEvent } from './api'
import { CalendarSidebar, type SidebarDialog } from './CalendarSidebar'
import { CalendarTopbar, PhoneBar } from './CalendarTopbar'
import { useEventColours } from './colours'
import { DayList } from './DayList'
import { EventDialog, type EventDraft } from './EventDialog'
import { EventPeek } from './EventPeek'
import { EventSearch } from './EventSearch'
import { atWallMin } from './layout'
import { MonthView } from './MonthView'
import { rangeTitle, stepDate } from './range'
import { PersonDialog, SubscribeDialog } from './Sharing'
import { useCalendarData } from './useCalendarData'
import { useCalendarHotkeys } from './useCalendarHotkeys'
import { useCalendarUrl } from './useCalendarUrl'
import { WeekView } from './WeekView'
import { ZoneChip } from './ZoneChip'
import { CalPrefsContext, fmtDateIn, fmtTimeIn, useDisplayZone, useWeekStart, zoneDay, zoneMinutes } from './zone'

// The Tasks app's drawer, loaded only when a task chip is opened.
const TaskDrawer = lazy(() => import('../tasks/TaskDrawer').then((m) => ({ default: m.TaskDrawer })))
const AvailabilityPage = lazy(() => import('./Availability'))
// Opened on demand: the settings drawer (with its time-zone list), New calendar, categories, Insights, zones.
const CalendarSettings = lazy(() => import('./CalendarSettings').then((m) => ({ default: m.CalendarSettings })))
const NewCalendarDialog = lazy(() => import('./NewCalendarDialog'))
const CategoriesDialog = lazy(() => import('./Categories').then((m) => ({ default: m.CategoriesDialog })))
const InsightsPanel = lazy(() => import('./Insights').then((m) => ({ default: m.InsightsPanel })))
const ZonePicker = lazy(() => import('./ZonePicker'))

export default function CalendarPage() {
  return (
    <Routes>
      <Route
        path="availability/:username"
        element={
          <Suspense fallback={null}>
            <AvailabilityPage />
          </Suspense>
        }
      />
      <Route path="*" element={<CalendarMain />} />
    </Routes>
  )
}

/** A thin bar sliding across the top while events load (Web Animations: no stylesheet keyframes needed). */
function ProgressBar() {
  const bar = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const a = bar.current?.animate([{ transform: 'translateX(-100%)' }, { transform: 'translateX(400%)' }], {
      duration: 1100,
      delay: 200,
      easing: 'ease-in-out',
      iterations: Number.POSITIVE_INFINITY,
      fill: 'backwards',
    })
    return () => a?.cancel()
  }, [])
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-6 h-0.5 overflow-hidden" role="progressbar" aria-label="Loading events">
      <div ref={bar} className="absolute inset-y-0 left-0 w-[30%] -translate-x-full bg-accent" />
    </div>
  )
}

function CalendarMain() {
  // Display zone (temporary, this window) and first day of the week (per user).
  const [tz, setTz] = useDisplayZone()
  const me = useMe().data
  const [weekStart, setWeekStart] = useWeekStart(me?.id ?? ownerId())
  const prefs = useMemo(() => ({ tz, weekStart }), [tz, weekStart])
  const now = useNow(60_000)
  const todayZ = zoneDay(now.getTime(), tz) // today's date in the display zone
  const url = useCalendarUrl(tz, todayZ)
  const { state, update } = url
  const phone = useIsPhone()
  const narrow = useMediaQuery('(max-width: 1100px)')
  const roomyTop = useMediaQuery('(min-width: 1500px)') // room for the zone chip beside the title
  const weekDays = phone ? 3 : 7
  const qc = useQueryClient()

  const [draft, setDraft] = useState<EventDraft | null>(null)
  const [zoneOpen, setZoneOpen] = useState(false)
  const [settingsFor, setSettingsFor] = useState<Calendar | null>(null)
  const [newCal, setNewCal] = useState(false)
  const [dlg, setDlg] = useState<SidebarDialog | null>(null)
  const [showDisabled, setShowDisabled] = usePref<boolean>('app.calendar.showDisabled', false)
  const calendars = useCalendars()
  const allCalendars = useCalendars(showDisabled)
  const { colour, byCalendar } = useEventColours(calendars.data)

  const openTask = url.openTask
  const onTask = useCallback((t: Task) => openTask(t), [openTask])
  const data = useCalendarData({ state, weekDays, weekStart, tz, onTask })
  const { range, events, byDay, layers } = data

  // ?new=1 (from the app's "New event" menus) opens the create dialog once.
  useEffect(() => {
    if (!state.isNew) return
    const s = new Date()
    s.setMinutes(s.getMinutes() < 30 ? 30 : 60, 0, 0)
    setDraft({ start: s })
    update({})
  }, [state.isNew, update])

  // Event details: clicking an event peeks at it; only Edit opens the form. ?event=<id> deep-links.
  const lastClicked = useRef<HTMLElement | null>(null)
  const [peek, setPeek] = useState<{ event: CalEvent; anchor: HTMLElement | null } | null>(null)
  const showPeek = (e: CalEvent) => {
    setPeek({ event: e, anchor: lastClicked.current?.closest<HTMLElement>('[data-ev]') ?? null })
    url.setEvent(e.id)
  }
  const closePeek = () => {
    setPeek(null)
    url.setEvent(null)
  }
  const editEvent = (e: CalEvent) => {
    closePeek()
    setDraft({ event: e })
  }
  const setEvent = url.setEvent
  // biome-ignore lint/correctness/useExhaustiveDependencies: only a new ?event= id loads one; the peek itself sets it too
  useEffect(() => {
    if (!url.eventId || peek?.event.id === url.eventId) return
    let live = true
    qc.fetchQuery(eventDetailQuery(url.eventId)).then(
      (e) => live && setPeek({ event: e, anchor: document.querySelector<HTMLElement>(`[data-ev="${CSS.escape(e.id)}"]`) }),
      () => live && setEvent(null),
    )
    return () => {
      live = false
    }
  }, [url.eventId])
  const openAgenda = async (i: AgendaItem) => {
    try {
      showPeek(await qc.fetchQuery(eventDetailQuery(i.id)))
    } catch (e) {
      toast.fail(e)
    }
  }

  // Drag in the week/day grid: move or resize (an occurrence of a repeating event moves alone).
  const updateEvent = useUpdateEvent()
  const canMove = useCallback(
    (e: CalEvent) => e.kind !== 'all_day' && !!calendars.data?.find((c) => c.id === e.calendar_id)?.can_edit,
    [calendars.data],
  )
  const moveEvent = (e: CalEvent, start: Date, end: Date | null) => {
    const recurring = !!(e.recurring || e.series_id)
    const before = { start: e.start, end: e.end }
    const body = end ? { start: start.toISOString(), end: end.toISOString() } : { start: start.toISOString() }
    const undo = { label: 'Undo', run: () => updateEvent.mutate({ id: e.id, body: before.end ? before : { start: before.start } }) }
    updateEvent.mutate(
      { id: e.id, scope: recurring ? 'this' : undefined, body },
      {
        onSuccess: () =>
          toast.show(
            start.getTime() === new Date(e.start).getTime() && end
              ? `"${e.name}" now ends at ${fmtTimeIn(end, tz)}`
              : `Moved "${e.name}" to ${fmtDateIn(start, { weekday: 'short', month: 'short', day: 'numeric' }, tz)}, ${fmtTimeIn(start, tz)}`,
            recurring ? {} : { action: undo },
          ),
      },
    )
  }

  const go = (dir: number) => update({ date: stepDate(state.view, state.date, dir, weekDays) })
  const today = () => update({ date: zoneDay(Date.now(), tz) })
  /** `start`/`end` are instants, except for all-day drafts (local-midnight dates). With no start: the
   *  next hour today, else 9 AM on the selected day, on the display zone's clock. */
  const newEvent = (start?: Date, end?: Date, allDay?: boolean) => {
    let s = start
    if (!s) {
      const n = Date.now()
      s = isSameDay(state.date, zoneDay(n, tz))
        ? atWallMin(state.date, (Math.floor(zoneMinutes(n, tz) / 60) + 1) * 60, tz)
        : atWallMin(state.date, 540, tz)
    }
    setDraft({ start: s, end, allDay })
  }
  const toggleInsights = () => update({ insights: state.insights ? null : state.view === 'month' ? 'month' : 'week' })
  useCalendarHotkeys({
    state,
    editing: !!draft,
    update,
    today,
    go,
    newEvent: () => newEvent(),
    // C: a one-hour event from the next quarter hour.
    quickEvent: () => {
      const s = new Date()
      s.setSeconds(0, 0)
      s.setMinutes(Math.floor(s.getMinutes() / 15) * 15 + 15)
      setDraft({ start: s, end: new Date(s.getTime() + 3600_000) })
    },
    subscribe: () => setDlg('subscribe'),
    quickTask: () => document.getElementById('cal-quick-task')?.focus(),
    toggleInsights,
  })

  const bar = {
    view: state.view,
    title: rangeTitle(state.view, state.date, weekDays, weekStart, todayZ),
    phone,
    insights: !!state.insights,
    onView: (v: typeof state.view) => update({ view: v }),
    onStep: go,
    onToday: today,
    onInsights: toggleInsights,
  }
  const zoneChip = (inTopbar?: boolean) =>
    tz && <ZoneChip tz={tz} now={now} inTopbar={inTopbar} onOpen={() => setZoneOpen(true)} onReset={() => setTz(undefined)} />
  const insightsPanel = state.insights && (
    <Suspense fallback={null}>
      <InsightsPanel
        period={state.insights}
        date={state.date}
        weekStart={weekStart}
        inDrawer={narrow}
        onPeriod={(p) => update({ insights: p })}
        onDate={(d) => update({ date: d })}
        onClose={() => update({ insights: null })}
      />
    </Suspense>
  )
  const selected = dayKey(state.date)

  return (
    <CalPrefsContext.Provider value={prefs}>
      <AppShell
        app="calendar"
        fullHeight
        topbar={
          <CalendarTopbar
            {...bar}
            zone={roomyTop && zoneChip(true)}
            onNew={() => newEvent()}
            search={
              <EventSearch
                calendars={calendars.data}
                onPick={(e) => {
                  setPeek({ event: e, anchor: null })
                  url.showEvent(e)
                }}
              />
            }
          />
        }
        sidebar={
          <CalendarSidebar
            mini={{ date: state.date, today: todayZ, onDate: (d) => update({ date: d }) }}
            calendars={(showDisabled ? allCalendars.data : null) ?? calendars.data}
            peek={data.peek}
            show={{
              tasks: data.toggles.showTasks,
              setTasks: data.toggles.setShowTasks,
              birthdays: data.toggles.showBirthdays,
              setBirthdays: data.toggles.setShowBirthdays,
              disabled: showDisabled,
              setDisabled: setShowDisabled,
            }}
            view={{ weekStart, setWeekStart, tz, now, onZone: () => setZoneOpen(true) }}
            open={{ settings: setSettingsFor, newCalendar: () => setNewCal(true), dialog: setDlg }}
            refresh={{
              at: events.dataUpdatedAt,
              busy: events.isFetching,
              run: () => {
                qc.invalidateQueries({ queryKey: ck.all })
                qc.invalidateQueries({ queryKey: ['photos', 'counts'] })
                if (data.toggles.showTasks) qc.invalidateQueries({ queryKey: ['tasks', 'list'] })
              },
            }}
          />
        }
      >
        <div className="relative flex h-full min-h-0 flex-col bg-surface">
          {phone && <PhoneBar {...bar} zone={zoneChip()} />}
          {!phone && !roomyTop && tz && (
            <div className="flex items-center gap-3 border-b border-border px-3 py-1.5">
              {zoneChip()}
              <span className="text-xs text-muted">Times in this window only</span>
            </div>
          )}
          {data.fetching && <ProgressBar />}
          <div className="flex min-h-0 flex-1">
            {/* biome-ignore lint/a11y/noStaticElementInteractions: remembers which chip was clicked (the peek's anchor); double-click to edit is a mouse shortcut for E */}
            <div
              className={cn(
                'flex min-h-0 min-w-0 flex-1 flex-col overflow-auto transition-opacity delay-150 duration-200',
                events.isPlaceholderData && 'opacity-70',
              )}
              onClickCapture={(ev) => {
                lastClicked.current = ev.target as HTMLElement
              }}
              onDoubleClick={(ev) => {
                const id = (ev.target as HTMLElement).closest<HTMLElement>('[data-ev]')?.dataset.ev
                const e = id && data.allEvents.find((x) => x.id === id)
                if (e && byCalendar.has(e.calendar_id) && calendars.data?.find((c) => c.id === e.calendar_id)?.can_edit) editEvent(e)
              }}
            >
              {/* A failed request never blanks the grid: the rest (tasks, birthdays, photos) still shows. */}
              {events.isError && state.view !== 'agenda' && (
                <InlineFail what={events.data ? 'the latest events' : 'events'} retry={() => events.refetch()} />
              )}
              {state.view === 'month' ? (
                <>
                  <MonthView
                    days={range.days}
                    month={state.date.getMonth()}
                    byDay={byDay}
                    colour={colour}
                    layers={layers}
                    today={todayZ}
                    selected={state.date}
                    compact={phone}
                    onSelect={(d) => update({ date: d })}
                    onOpenDay={(d) => update({ view: 'week', date: d })}
                    onCreate={(d) => newEvent(atWallMin(d, 540, tz))}
                    onEvent={showPeek}
                  />
                  {phone && (
                    <DayList
                      day={state.date}
                      events={byDay.get(selected) ?? []}
                      colour={colour}
                      onEvent={showPeek}
                      onCreate={() => newEvent()}
                      tasks={layers.tasks.get(selected)}
                      onTask={onTask}
                      photos={layers.photos?.[selected]}
                      birthdays={layers.birthdays.get(selected)}
                    />
                  )}
                </>
              ) : state.view === 'week' || state.view === 'day' ? (
                <WeekView
                  days={range.days}
                  byDay={byDay}
                  colour={colour}
                  now={now}
                  layers={layers}
                  canEdit={canMove}
                  onMove={moveEvent}
                  onCreate={newEvent}
                  onEvent={showPeek}
                  onOpenDay={(d) => update({ date: d, view: 'day' })}
                  onZone={() => setZoneOpen(true)}
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
        {url.taskId && (
          <Suspense fallback={null}>
            <TaskDrawer id={url.taskId} onClose={url.closeTask} onOpen={(id) => openTask({ id })} />
          </Suspense>
        )}
        {peek && !draft && (
          <EventPeek
            key={peek.event.id}
            event={peek.event}
            anchor={peek.anchor}
            calendar={calendars.data?.find((c) => c.id === peek.event.calendar_id)}
            onClose={closePeek}
            onEdit={editEvent}
          />
        )}
        {settingsFor && (
          <Suspense fallback={null}>
            <CalendarSettings calendar={settingsFor} onClose={() => setSettingsFor(null)} />
          </Suspense>
        )}
        {newCal && (
          <Suspense fallback={null}>
            <NewCalendarDialog onClose={() => setNewCal(false)} onCreated={setSettingsFor} />
          </Suspense>
        )}
        {dlg === 'categories' && (
          <Suspense fallback={null}>
            <CategoriesDialog onClose={() => setDlg(null)} />
          </Suspense>
        )}
        {zoneOpen && (
          <Suspense fallback={null}>
            <ZonePicker tz={tz} onPick={setTz} onClose={() => setZoneOpen(false)} profileZone={me?.timezone} />
          </Suspense>
        )}
        {dlg === 'subscribe' && (
          <SubscribeDialog onClose={() => setDlg(null)} onSettings={setSettingsFor} onNewCalendar={() => setNewCal(true)} />
        )}
        {dlg === 'person' && <PersonDialog onClose={() => setDlg(null)} />}
        {draft && (
          <EventDialog key={'event' in draft ? draft.event.id : draft.start.getTime()} draft={draft} onClose={() => setDraft(null)} />
        )}
      </AppShell>
    </CalPrefsContext.Provider>
  )
}
