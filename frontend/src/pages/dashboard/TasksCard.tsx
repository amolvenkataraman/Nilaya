// Home › Tasks: quick add for today, then overdue and today's tasks grouped by due, and the week's counts.
import { useMemo } from 'react'
import { Link, useNavigate } from 'react-router'
import { QuickAddInput } from '../../components/QuickAdd'
import { TaskRow } from '../../components/TaskRow'
import { EmptyState, QueryView, SkeletonRows } from '../../components/ui'
import { cn } from '../../lib/cn'
import { groupByDue } from '../../lib/dates'
import { DASH_TODAY_PARAMS, keys, useOverview, useProjects, useSetDone, useTasks } from '../../lib/queries'
import { CardLink } from '../settings/Card'
import { Chip } from '../settings/Chip'
import { DashCard } from './DashCard'

export function TasksCard() {
  const tasks = useTasks(DASH_TODAY_PARAMS)
  const projects = useProjects().data
  const overview = useOverview().data
  const setDone = useSetDone()
  const navigate = useNavigate()
  const groups = useMemo(() => groupByDue(tasks.data?.items ?? [], (t) => t.due), [tasks.data])
  const byId = useMemo(() => new Map((projects ?? []).map((p) => [p.id, p])), [projects])
  const upcoming = overview?.upcoming ? <Link to="/tasks?view=upcoming">{overview.upcoming} coming up this week</Link> : null
  return (
    <DashCard
      title="Tasks"
      icon="tasks"
      titleId="tasks-h"
      actions={
        <>
          {overview && overview.overdue > 0 && <Chip tone="danger">{overview.overdue} overdue</Chip>}
          <span className="flex-1" />
          <CardLink to="/tasks">All tasks</CardLink>
        </>
      }
    >
      <div className="px-1.5 pt-1.5">
        <QuickAddInput compact defaultToday listKey={keys.taskList(DASH_TODAY_PARAMS)} placeholder="Add a task for today…" />
      </div>
      <div className="flex-1 px-1 pt-1 pb-2">
        <QueryView
          query={tasks}
          skeleton={<SkeletonRows rows={4} avatar />}
          isEmpty={() => groups.length === 0}
          empty={<EmptyState>Nothing due today. {upcoming}</EmptyState>}
        >
          {() =>
            groups.map((g, i) => (
              <div key={g.key} className={cn(i > 0 && 'mt-1.5')}>
                <div
                  className={cn(
                    'flex items-baseline gap-1.5 px-3 pt-1.5 pb-0.5 text-xs font-semibold',
                    g.key === 'overdue' ? 'text-danger' : 'text-muted',
                  )}
                >
                  {g.label}
                  <span className="font-normal">{g.items.length}</span>
                </div>
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
          }
        </QueryView>
      </div>
      {overview && (
        <div className="flex items-center gap-2 border-t border-border px-4 py-2 text-xs text-muted">
          <span>{overview.done_this_week} done this week</span>
          <span className="flex-1" />
          {overview.upcoming > 0 && <Link to="/tasks?view=upcoming">{overview.upcoming} upcoming</Link>}
        </div>
      )}
    </DashCard>
  )
}
