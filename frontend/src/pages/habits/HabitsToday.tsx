// The dashboard's Habits card: today's due habits with one-tap check-ins, self-contained (its own query).
import { Link } from 'react-router'
import { Icon } from '../../components/Icon'
import { buttonClass, cardClass, CardHead, QueryView, SkeletonRows } from '../../components/ui'
import { cn } from '../../lib/cn'
import { useToday } from './api'
import { HabitRow } from './HabitRow'

export function HabitsTodayCard({ className = '' }: { className?: string }) {
  const today = useToday()
  return (
    <section className={cn(cardClass, className)} aria-labelledby="habits-card-h">
      <CardHead
        titleId="habits-card-h"
        title={
          <>
            <Icon name="repeat" className="text-muted" />
            Habits
          </>
        }
      >
        {today.data && today.data.total > 0 && (
          <span className="text-xs font-medium text-muted tabular-nums">
            {today.data.done}/{today.data.total}
          </span>
        )}
        <span className="flex-1" />
        <Link className={buttonClass({ variant: 'ghost', size: 'sm', className: 'gap-0.5! hover:no-underline' })} to="/habits">
          Habits
          <Icon name="chevronRight" size={14} />
        </Link>
      </CardHead>
      <div className="grid gap-px p-1">
        <QueryView query={today} skeleton={<SkeletonRows rows={3} avatar />}>
          {(t) => {
            const rows = t.habits.filter((r) => r.due && !r.habit.paused)
            if (rows.length) return rows.map((r) => <HabitRow key={r.habit.id} row={r} compact />)
            return (
              <div className="p-4 text-center text-sm text-muted">
                {t.habits.length ? (
                  'Nothing scheduled today.'
                ) : (
                  <>
                    No habits yet. <Link to="/habits?new=1">Start one</Link>
                  </>
                )}
              </div>
            )
          }}
        </QueryView>
      </div>
    </section>
  )
}
