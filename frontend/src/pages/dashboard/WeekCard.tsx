// Home › This week: scheduled hours against last week, hours per weekday, the top categories and the week's facts.
import { Columns, HBars } from '../../components/charts'
import { Icon } from '../../components/Icon'
import { ErrorBox } from '../../components/ui'
import { addDays, dayKey, startOfWeek, weekdayName } from '../../lib/dates'
import { useInsights } from '../../lib/queries'
import { CardBody, CardLink } from '../settings/Card'
import { DashCard } from './DashCard'

const hours = (v: number) => `${v >= 10 ? v.toFixed(0) : v.toFixed(1).replace(/\.0$/, '')} h`

export function WeekCard({ now }: { now: Date }) {
  const ins = useInsights('week', dayKey(now))
  const d = ins.data
  const delta = d ? d.totals.hours - d.previous.hours : 0
  const weekStart = startOfWeek(now)
  const dayLabels = Array.from({ length: 7 }, (_, i) => weekdayName(addDays(weekStart, i), 'short').slice(0, 2))
  const todayIdx = (now.getDay() + 6) % 7
  return (
    <DashCard
      title="This week"
      icon="chart"
      titleId="week-h"
      actions={
        <>
          <span className="flex-1" />
          <CardLink to="/calendar?insights=week">Insights</CardLink>
        </>
      }
    >
      <CardBody className="grid gap-3.5">
        {d ? (
          <>
            <div className="flex flex-wrap items-baseline gap-2">
              {/* The one big number on Home (a stat tile, between the type scale's xl and a heading). */}
              <span className="text-[1.75rem] leading-[1.1] font-semibold tracking-[-0.02em] tabular-nums">
                {d.totals.hours.toFixed(1).replace(/\.0$/, '')}
              </span>
              <span className="text-base font-medium text-muted">hours scheduled</span>
              <span
                className="inline-flex items-center gap-0.5 text-xs font-medium text-muted"
                title={`Last week: ${hours(d.previous.hours)}`}
              >
                <Icon name={delta >= 0 ? 'arrowUp' : 'arrowDown'} size={12} />
                {hours(Math.abs(delta))} vs last week
              </span>
            </div>
            <Columns title="Hours per day" values={d.by_weekday} labels={dayLabels} highlight={todayIdx} format={hours} height={76} />
            {d.by_category.length > 0 ? (
              <HBars
                items={d.by_category.slice(0, 5).map((c) => ({
                  key: c.id,
                  label: c.label,
                  value: c.hours,
                  title: `${c.label}: ${hours(c.hours)} in ${c.events} events`,
                }))}
                format={hours}
              />
            ) : (
              <div className="p-4 text-sm text-muted">No timed events this week.</div>
            )}
            <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-border pt-2.5 text-xs text-muted [&_strong]:font-semibold [&_strong]:text-fg [&_strong]:tabular-nums">
              <span>
                <strong>{d.totals.events}</strong> events
              </span>
              <span>
                <strong>{hours(d.totals.meeting_hours)}</strong> meetings
              </span>
              <span>
                <strong>{hours(d.totals.focus_hours)}</strong> focus
              </span>
              <span>
                <strong>{d.todos.completed}</strong> todos done
              </span>
            </div>
          </>
        ) : ins.error ? (
          <ErrorBox error={ins.error} />
        ) : (
          <>
            <span className="sk h-8 w-2/5" />
            <span className="sk h-18" />
          </>
        )}
      </CardBody>
    </DashCard>
  )
}
