// Home: a calm, dense personal command centre. Today's agenda (now/next), tasks due, the week in
// hours, photos, unread notifications and quick links.
import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router'
import { AppShell, AppLogo } from '../../components/AppShell'
import { Icon } from '../../components/Icon'
import { ErrorBox, SkeletonRows, useNow } from '../../components/ui'
import { TaskRow } from '../../components/TaskRow'
import { QuickAddInput } from '../../components/QuickAdd'
import { HBars, Columns } from '../../components/charts'
import { NotificationRow, useOpenNotification } from '../../components/NotificationBell'
import { useGlobals } from '../../components/Shell'
import { APPS } from '../../components/nav'
import { Boundary } from '../../components/resilience'
import {
  DASH_AGENDA_DAYS, DASH_INBOX_LIMIT, DASH_TODAY_PARAMS, keys, useAgenda, useInbox, useInsights, useMe,
  useOverview, useProjects, useReadAll, useSetDone, useTasks,
} from '../../lib/queries'
import { dayKey, fmtDate, fmtLongDate, fmtTime, greeting, groupByDue, isSameDay, relTime, addDays, startOfDay, startOfWeek, weekdayName } from '../../lib/dates'
import type { AgendaItem } from '../../lib/types'
import './dashboard.css'

// Habits lives in its own chunk (shared with the Habits app), fetched only when its card is near the viewport.
const HabitsTodayCard = lazy(() => import('../habits/HabitsToday').then((m) => ({ default: m.HabitsTodayCard })))

function CardSkeleton({ className, title, rows }: { className: string; title: string; rows: number }) {
  return (
    <section className={'card ' + className} aria-busy="true" aria-label={title}>
      <div className="card-head"><h2>{title}</h2></div>
      <SkeletonRows rows={rows} />
    </section>
  )
}

/** Mount children (and so start their requests) only once the slot is within ~one screen of the viewport. */
function WhenVisible({ className, title, rows, children }: { className: string; title: string; rows: number; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [shown, setShown] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el || shown) return
    if (!('IntersectionObserver' in window)) return setShown(true)
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && setShown(true), { rootMargin: '400px 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [shown])
  if (shown) return <>{children}</>
  return <div ref={ref} className={className}><CardSkeleton className="" title={title} rows={rows} /></div>
}

/** Live clock, its own tiny component so the page doesn't re-render every second. */
function Clock() {
  const t = useNow(1000)
  return <time className="dash-clock tabular" dateTime={t.toISOString()}>{fmtTime(t)}</time>
}

export default function Dashboard() {
  const me = useMe().data
  const now = useNow(30_000)
  const overview = useOverview().data
  const agenda = useAgenda(DASH_AGENDA_DAYS)
  const { openQuickAdd } = useGlobals()

  const todayItems = useMemo(
    () => (agenda.data ?? []).filter((i) => i.kind !== 'todo' && (!i.start || isSameDay(new Date(i.start), now) || (i.end && new Date(i.end) > now && new Date(i.start) < now))),
    [agenda.data, now],
  )
  const left = todayItems.filter((i) => i.kind !== 'all_day' && i.start && new Date(i.end ?? i.start) > now).length

  const soon = (agenda.data ?? []).find((i) => i.kind !== 'todo' && i.kind !== 'all_day' && i.start && new Date(i.start) > now && new Date(i.start).getTime() - now.getTime() < 2 * 3600_000)
  const summary: string[] = []
  if (soon) summary.push(`${soon.title} ${relTime(new Date(soon.start!), now)}`)
  if (agenda.data) summary.push(left ? `${left} ${left === 1 ? 'item' : 'items'} left today` : 'Nothing else scheduled today')
  if (overview) {
    if (overview.today) summary.push(`${overview.today} ${overview.today === 1 ? 'task' : 'tasks'} due`)
    if (overview.overdue) summary.push(`${overview.overdue} overdue`)
  }

  return (
    <AppShell app="home" title="Home">
      <div className="dash">
        <header className="dash-hero">
          <div className="grow">
            <h1>{greeting(now)}{me?.first_name ? `, ${me.first_name}` : ''} <Clock /></h1>
            <p className="dash-sub">
              <time dateTime={dayKey(now)}>{fmtLongDate(now)}</time>
              {summary.map((s) => <span key={s}><span aria-hidden="true"> · </span>{s}</span>)}
            </p>
          </div>
          <div className="dash-actions">
            <button className="btn" onClick={openQuickAdd}><Icon name="plus" />Task<span className="kbd">Q</span></button>
            <Link className="btn" to="/calendar?new=1"><Icon name="calendar" />Event</Link>
          </div>
        </header>

        <div className="dash-grid">
          <Boundary className="a-agenda" label="the agenda"><AgendaCard className="a-agenda" items={todayItems} tomorrow={(agenda.data ?? []).filter((i) => i.kind !== 'todo' && i.start && new Date(i.start) >= startOfDay(addDays(now, 1)))} loading={agenda.isPending} error={agenda.data ? null : agenda.error} now={now} /></Boundary>
          <Boundary className="a-tasks" label="tasks"><TasksCard className="a-tasks" /></Boundary>
          <Boundary className="a-week" label="this week"><WeekCard className="a-week" now={now} /></Boundary>
          <WhenVisible className="a-habits" title="Habits" rows={4}>
            <Suspense fallback={<CardSkeleton className="a-habits" title="Habits" rows={4} />}>
              <Boundary className="a-habits" label="habits"><HabitsTodayCard className="a-habits" /></Boundary>
            </Suspense>
          </WhenVisible>
          <WhenVisible className="a-inbox" title="Notifications" rows={3}>
            <Boundary className="a-inbox" label="notifications"><InboxCard className="a-inbox" /></Boundary>
          </WhenVisible>
          <Boundary className="a-links" label="links"><LinksCard className="a-links" onTask={openQuickAdd} /></Boundary>
        </div>
      </div>
    </AppShell>
  )
}

// ---------------------------------------------------------------- agenda
function AgendaCard({ items, tomorrow, loading, error, now, className }: {
  items: AgendaItem[]; tomorrow: AgendaItem[]; loading: boolean; error: unknown; now: Date; className: string
}) {
  const allDay = items.filter((i) => i.kind === 'all_day')
  const timed = items.filter((i) => i.kind !== 'all_day')
  const current = timed.filter((i) => i.start && i.end && new Date(i.start) <= now && new Date(i.end) > now)
  const next = timed.find((i) => i.start && new Date(i.start) > now)
  return (
    <section className={'card ' + className} aria-labelledby="agenda-h">
      <div className="card-head">
        <h2 id="agenda-h"><Icon name="calendar" />Today</h2>
        <span className="spacer" />
        <Link className="btn ghost sm" to="/calendar">Calendar<Icon name="chevronRight" size={14} /></Link>
      </div>
      {loading ? (
        <SkeletonRows rows={5} />
      ) : error ? (
        <ErrorBox error={error} />
      ) : (
        <div className="agenda">
          {allDay.length > 0 && (
            <div className="agenda-allday">
              {allDay.map((i) => (
                <span key={i.id} className="allday-chip" style={{ '--c': i.colour } as React.CSSProperties}>{i.title}</span>
              ))}
            </div>
          )}
          {timed.length === 0 && <div className="empty left">No events today.</div>}
          <ol className="agenda-list">
            {timed.map((i) => {
              const start = i.start ? new Date(i.start) : null
              const end = i.end ? new Date(i.end) : null
              const isNow = current.includes(i)
              const isNext = next === i
              const past = !isNow && (end ?? start) !== null && (end ?? start)! <= now
              return (
                <li key={i.kind + i.id} className={'agenda-item' + (isNow ? ' now' : '') + (isNext ? ' next' : '') + (past ? ' past' : '')}>
                  <div className="agenda-time tabular">
                    {start ? (i.kind === 'deadline' ? <span className="dl"><Icon name="flag" size={12} />{fmtTime(start)}</span> : fmtTime(start)) : ''}
                    {end && i.kind === 'event' && <span className="agenda-end">{fmtTime(end)}</span>}
                  </div>
                  <span className="agenda-bar" style={{ background: i.colour }} aria-hidden="true" />
                  <div className="agenda-body">
                    <div className="agenda-title">
                      <span className="truncate">{i.title}</span>
                      {isNow && <span className="chip accent">Now</span>}
                      {isNext && start && <span className="chip">Next · {relTime(start, now)}</span>}
                      {i.kind === 'deadline' && <span className="chip warning">Due</span>}
                    </div>
                    <div className="agenda-meta truncate">
                      {[i.calendar, i.location].filter(Boolean).join(' · ')}
                    </div>
                  </div>
                </li>
              )
            })}
          </ol>
          {tomorrow.length > 0 && (
            <div className="agenda-tomorrow">
              <div className="label">Next 7 days</div>
              {tomorrow.slice(0, 8).map((i, idx) => {
                const d = new Date(i.start!)
                const newDay = idx === 0 || !isSameDay(d, new Date(tomorrow[idx - 1].start!))
                return (
                  <div key={i.kind + i.id} className="tomorrow-item">
                    <span className="tomorrow-day">{newDay ? (isSameDay(d, addDays(now, 1)) ? 'Tomorrow' : fmtDate(d, { weekday: 'short', day: 'numeric' })) : ''}</span>
                    <span className="dot" style={{ background: i.colour }} />
                    <span className="tabular muted">{i.kind === 'all_day' || !i.start ? 'All day' : fmtTime(d)}</span>
                    <span className="truncate">{i.kind === 'deadline' ? 'Due: ' : ''}{i.title}</span>
                  </div>
                )
              })}
              {tomorrow.length > 8 && <Link className="muted xsmall" to="/calendar?view=agenda">+{tomorrow.length - 8} more in the agenda</Link>}
            </div>
          )}
        </div>
      )}
    </section>
  )
}

// ---------------------------------------------------------------- tasks
const TODAY_PARAMS = DASH_TODAY_PARAMS

function TasksCard({ className }: { className: string }) {
  const tasks = useTasks(TODAY_PARAMS)
  const projects = useProjects().data
  const overview = useOverview().data
  const setDone = useSetDone()
  const navigate = useNavigate()
  const groups = useMemo(() => groupByDue(tasks.data?.items ?? [], (t) => t.due), [tasks.data])
  const byId = useMemo(() => new Map((projects ?? []).map((p) => [p.id, p])), [projects])
  return (
    <section className={'card ' + className} aria-labelledby="tasks-h">
      <div className="card-head">
        <h2 id="tasks-h"><Icon name="tasks" />Tasks</h2>
        {overview && overview.overdue > 0 && <span className="chip danger">{overview.overdue} overdue</span>}
        <span className="spacer" />
        <Link className="btn ghost sm" to="/tasks">All tasks<Icon name="chevronRight" size={14} /></Link>
      </div>
      <div className="dash-quick">
        <QuickAddInput compact defaultToday listKey={keys.taskList(TODAY_PARAMS)} placeholder="Add a task for today…" />
      </div>
      <div className="dash-tasks">
        {tasks.isPending ? (
          <SkeletonRows rows={4} avatar />
        ) : tasks.error && !tasks.data ? (
          <ErrorBox error={tasks.error} retry={() => tasks.refetch()} />
        ) : groups.length === 0 ? (
          <div className="empty">Nothing due today. {overview?.upcoming ? <Link to="/tasks?view=upcoming">{overview.upcoming} coming up this week</Link> : null}</div>
        ) : (
          groups.map((g) => (
            <div key={g.key} className="task-group">
              <div className={'task-group-label' + (g.key === 'overdue' ? ' danger' : '')}>{g.label}<span>{g.items.length}</span></div>
              {g.items.map((t) => (
                <TaskRow
                  key={t.id}
                  task={t}
                  project={t.project_id ? byId.get(t.project_id) : undefined}
                  onToggle={() => setDone.mutate({ task: t, done: !t.done })}
                  onOpen={() => navigate(`/tasks?task=${t.id}`)}
                />
              ))}
            </div>
          ))
        )}
      </div>
      {overview && (
        <div className="card-foot row muted">
          <span>{overview.done_this_week} done this week</span>
          <span className="spacer" />
          {overview.upcoming > 0 && <Link to="/tasks?view=upcoming">{overview.upcoming} upcoming</Link>}
        </div>
      )}
    </section>
  )
}

// ---------------------------------------------------------------- week insight
const hours = (v: number) => (v >= 10 ? v.toFixed(0) : v.toFixed(1).replace(/\.0$/, '')) + ' h'

function WeekCard({ className, now }: { className: string; now: Date }) {
  const ins = useInsights('week', dayKey(now))
  const d = ins.data
  const delta = d ? d.totals.hours - d.previous.hours : 0
  const weekStart = startOfWeek(now)
  const dayLabels = Array.from({ length: 7 }, (_, i) => weekdayName(addDays(weekStart, i), 'short').slice(0, 2))
  const todayIdx = (now.getDay() + 6) % 7
  return (
    <section className={'card ' + className} aria-labelledby="week-h">
      <div className="card-head">
        <h2 id="week-h"><Icon name="chart" />This week</h2>
        <span className="spacer" />
        <Link className="btn ghost sm" to="/calendar?insights=week">Insights<Icon name="chevronRight" size={14} /></Link>
      </div>
      <div className="card-body week-body">
        {ins.isPending ? (
          <><span className="sk" style={{ height: '2rem', width: '40%' }} /><span className="sk" style={{ height: '4.5rem' }} /></>
        ) : ins.error && !ins.data ? (
          <ErrorBox error={ins.error} />
        ) : d ? (
          <>
            <div className="stat-hero">
              <span className="value">{d.totals.hours.toFixed(1).replace(/\.0$/, '')}</span>
              <span className="unit">hours scheduled</span>
              <span className="delta" title={`Last week: ${hours(d.previous.hours)}`}>
                <Icon name={delta >= 0 ? 'arrowUp' : 'arrowDown'} size={12} />
                {hours(Math.abs(delta))} vs last week
              </span>
            </div>
            <Columns
              title="Hours per day"
              values={d.by_weekday}
              labels={dayLabels}
              highlight={todayIdx}
              format={hours}
              height={76}
            />
            {d.by_category.length > 0 ? (
              <HBars items={d.by_category.slice(0, 5).map((c) => ({ key: c.id, label: c.label, value: c.hours, title: `${c.label}: ${hours(c.hours)} in ${c.events} events` }))} format={hours} />
            ) : (
              <div className="empty left">No timed events this week.</div>
            )}
            <div className="week-facts">
              <span><strong>{d.totals.events}</strong> events</span>
              <span><strong>{hours(d.totals.meeting_hours)}</strong> meetings</span>
              <span><strong>{hours(d.totals.focus_hours)}</strong> focus</span>
              <span><strong>{d.todos.completed}</strong> todos done</span>
            </div>
          </>
        ) : null}
      </div>
    </section>
  )
}

// ---------------------------------------------------------------- notifications
function InboxCard({ className }: { className: string }) {
  const inbox = useInbox(true, DASH_INBOX_LIMIT)
  const readAll = useReadAll()
  const open = useOpenNotification()
  const unread = inbox.data?.unread ?? 0
  return (
    <section className={'card ' + className} aria-labelledby="inbox-h">
      <div className="card-head">
        <h2 id="inbox-h"><Icon name="bell" />Notifications{unread > 0 && <span className="badge">{unread}</span>}</h2>
        <span className="spacer" />
        {unread > 0 && <button className="btn ghost sm" onClick={() => readAll.mutate()}>Mark all read</button>}
        <Link className="btn ghost icon sm" to="/notifications" aria-label="All notifications"><Icon name="chevronRight" size={14} /></Link>
      </div>
      <div className="dash-inbox">
        {inbox.isPending ? <SkeletonRows rows={3} /> : !inbox.data?.items.length ? (
          <div className="empty"><Icon name="check" size={14} /> You're all caught up.</div>
        ) : (
          inbox.data.items.map((n) => <NotificationRow key={n.id} n={n} onOpen={open} compact />)
        )}
      </div>
    </section>
  )
}

// ---------------------------------------------------------------- quick links
function LinksCard({ className, onTask }: { className: string; onTask: () => void }) {
  const app = (id: string) => APPS.find((a) => a.id === id)!
  const links: { label: string; sub: string; app: string; to?: string; run?: () => void }[] = [
    { label: 'New task', sub: 'Quick add', app: 'tasks', run: onTask },
    { label: 'New event', sub: 'Calendar', app: 'calendar', to: '/calendar?new=1' },
    { label: 'Progress', sub: 'Habits', app: 'habits', to: '/habits/progress' },
    { label: 'Albums', sub: 'Photos', app: 'photos', to: '/photos/albums' },
    { label: 'Places', sub: 'Map', app: 'places', to: '/places' },
    { label: 'Contacts', sub: 'People', app: 'contacts', to: '/contacts' },
  ]
  return (
    <section className={'card ' + className} aria-labelledby="links-h">
      <div className="card-head"><h2 id="links-h"><Icon name="zap" />Quick links</h2></div>
      <div className="links">
        {links.map((l) => {
          const inner = (
            <>
              <AppLogo app={app(l.app)} size={2} />
              <span className="link-text"><span className="truncate">{l.label}</span><span className="muted xsmall truncate">{l.sub}</span></span>
            </>
          )
          return l.to ? (
            <Link key={l.label} to={l.to} className="link-tile">{inner}</Link>
          ) : (
            <button key={l.label} className="link-tile" onClick={l.run}>{inner}</button>
          )
        })}
        <a href="/" className="link-tile">
          <AppLogo app={{ id: 'classic', to: '/', label: 'Classic', icon: 'classic', hue: '#64748b' }} size={2} />
          <span className="link-text"><span>Classic view</span><span className="muted xsmall">All apps</span></span>
        </a>
      </div>
    </section>
  )
}
