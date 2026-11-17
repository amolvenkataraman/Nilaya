// Home: a calm, dense personal command centre. Today's agenda (now/next), tasks due, the week in
// hours, habits, unread notifications and quick links, in a grid that folds to two columns and then one.
import { Link } from 'react-router'
import { AppShell } from '../../components/AppShell'
import { Icon } from '../../components/Icon'
import { useGlobals } from '../../components/Shell'
import { Button, buttonClass, SearchBox, useNow } from '../../components/ui'
import { dayKey, fmtLongDate, fmtTime, greeting, relTime } from '../../lib/dates'
import { plural } from '../../lib/format'
import { useMe, useOverview } from '../../lib/queries'
// Imported statically: a lazy card under Suspense made React 19 hold the fallback ~300 ms. Its data
// is still fetched only when the card is near the viewport (DashSlot lazy).
import { HabitsTodayCard } from '../habits/HabitsToday'
import { Kbd } from '../settings/Chip'

import { AgendaCard } from './AgendaCard'
import { DashSlot, dashGrid } from './DashCard'
import { InboxCard } from './InboxCard'
import { LinksCard } from './LinksCard'
import { TasksCard } from './TasksCard'
import { useTodayAgenda } from './todayAgenda'
import { WeekCard } from './WeekCard'

/** Live clock, its own tiny component so the page doesn't re-render every second. */
function Clock() {
  const t = useNow(1000)
  return (
    <time className="ml-2 text-md font-medium tracking-normal text-muted tabular-nums" dateTime={t.toISOString()}>
      {fmtTime(t)}
    </time>
  )
}

export default function Dashboard() {
  const me = useMe().data
  const now = useNow(30_000)
  const overview = useOverview().data
  const { agenda, split } = useTodayAgenda(now)
  const { openQuickAdd } = useGlobals()

  const summary: string[] = []
  if (split?.soon) summary.push(`${split.soon.title} ${relTime(new Date(split.soon.start as string), now)}`)
  if (split) summary.push(split.left ? `${plural(split.left, 'item')} left today` : 'Nothing else scheduled today')
  if (overview) {
    if (overview.today) summary.push(`${plural(overview.today, 'task')} due`)
    if (overview.overdue) summary.push(`${overview.overdue} overdue`)
  }

  return (
    <AppShell app="home" title="Home">
      <div className="mx-auto max-w-[100rem] px-6 pt-5 pb-8 max-md:px-3 max-md:pt-3.5 max-md:pb-6">
        <header className="mb-4 flex flex-wrap items-end gap-4">
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-semibold tracking-[-0.02em] max-md:text-lg">
              {greeting(now)}
              {me?.first_name ? `, ${me.first_name}` : ''} <Clock />
            </h1>
            <p className="mt-0.5 text-sm text-muted">
              <time dateTime={dayKey(now)}>{fmtLongDate(now)}</time>
              {summary.map((s) => (
                <span key={s}>
                  <span aria-hidden="true"> · </span>
                  {s}
                </span>
              ))}
            </p>
          </div>
          <search className="w-[min(18rem,100%)] max-md:order-3 max-md:w-full">
            <form
              onSubmit={(e) => {
                // Navigate (not a form post) so the page's CSP form-action 'self' stays strict.
                e.preventDefault()
                const q = (new FormData(e.currentTarget).get('q') ?? '').toString().trim()
                if (q) window.open(`https://duckduckgo.com/?q=${encodeURIComponent(q)}`, '_blank', 'noopener,noreferrer')
              }}
            >
              <SearchBox name="q" placeholder="Search DuckDuckGo" aria-label="Search DuckDuckGo" maxLength={300} />
            </form>
          </search>
          <div className="flex gap-2 max-md:hidden">
            <Button onClick={openQuickAdd}>
              <Icon name="plus" />
              Task<Kbd className="ml-1">Q</Kbd>
            </Button>
            <Link className={buttonClass({ className: 'hover:no-underline' })} to="/calendar?new=1">
              <Icon name="calendar" />
              Event
            </Link>
          </div>
        </header>

        {/* The habits card (HabitsToday.tsx) still renders the old card head: muted icon and a tight
            chevron link as DashCard draws them. Drop these when it uses DashCard. */}
        <div className={dashGrid}>
          <DashSlot area="agenda" label="the agenda">
            <AgendaCard
              items={split?.today ?? []}
              later={split?.later ?? []}
              loading={agenda.isPending}
              error={agenda.data ? null : agenda.error}
              now={now}
            />
          </DashSlot>
          <DashSlot area="tasks" label="tasks">
            <TasksCard />
          </DashSlot>
          <DashSlot area="week" label="this week">
            <WeekCard now={now} />
          </DashSlot>
          <DashSlot
            area="habits"
            label="habits"
            lazy={{ title: 'Habits', rows: 4 }}
            className="[&_.card-head_.btn]:gap-0.5! [&_.card-head_h2_svg]:text-muted"
          >
            <HabitsTodayCard className="flex-1" />
          </DashSlot>
          <DashSlot area="inbox" label="notifications" lazy={{ title: 'Notifications', rows: 3 }}>
            <InboxCard />
          </DashSlot>
          <DashSlot area="links" label="links">
            <LinksCard onTask={openQuickAdd} />
          </DashSlot>
        </div>
      </div>
    </AppShell>
  )
}
