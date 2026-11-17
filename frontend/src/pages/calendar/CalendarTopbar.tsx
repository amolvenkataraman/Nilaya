// The calendar's controls: in the app's top bar on desktop (today, step, title, zone, search, views, insights,
// new event), split on phones between the top bar (search, new) and a bar above the grid (the rest).
import type { ReactNode } from 'react'
import { Icon } from '../../components/Icon'
import { Button, buttonClass, Segmented } from '../../components/ui'
import { cn } from '../../lib/cn'
import { fmtDate } from '../../lib/dates'
import type { CalView } from './range'
import { SEGMENTED_FIX } from './segmentedFix'

const VIEWS: CalView[] = ['month', 'week', 'day', 'agenda']
const cap = (v: string) => v[0].toUpperCase() + v.slice(1)

export interface TopbarProps {
  view: CalView
  title: string
  phone: boolean
  insights: boolean
  onView: (v: CalView) => void
  onStep: (dir: number) => void
  onToday: () => void
  onInsights: () => void
}

function Step({ view, onStep }: Pick<TopbarProps, 'view' | 'onStep'>) {
  const off = view === 'agenda'
  return (
    <span className="inline-flex">
      <Button variant="ghost" icon onClick={() => onStep(-1)} aria-label="Previous" title="Previous (K)" disabled={off}>
        <Icon name="chevronLeft" />
      </Button>
      <Button variant="ghost" icon onClick={() => onStep(1)} aria-label="Next" title="Next (J)" disabled={off}>
        <Icon name="chevronRight" />
      </Button>
    </span>
  )
}

function Today({ onToday }: Pick<TopbarProps, 'onToday'>) {
  return (
    <Button onClick={onToday} title={`${fmtDate(new Date(), { weekday: 'long', month: 'long', day: 'numeric' })} (T)`}>
      Today
    </Button>
  )
}

function Views({ view, phone, onView, className }: Pick<TopbarProps, 'view' | 'phone' | 'onView'> & { className?: string }) {
  return (
    <Segmented<CalView>
      label="View"
      className={cn(SEGMENTED_FIX, className)}
      value={view}
      onChange={onView}
      options={VIEWS.map((v) => ({
        value: v,
        label: v === 'week' && phone ? '3 days' : cap(v),
        title: `${cap(v)} (${v[0].toUpperCase()})`,
      }))}
    />
  )
}

function InsightsButton({ insights, onInsights }: Pick<TopbarProps, 'insights' | 'onInsights'>) {
  return (
    <button
      type="button"
      className={buttonClass({ variant: 'ghost', icon: true, className: cn(insights && 'bg-accent-soft! text-accent!') })}
      aria-pressed={insights}
      onClick={onInsights}
      aria-label="Insights"
      title="Insights (I)"
    >
      <Icon name="chart" size={18} />
    </button>
  )
}

/** The app top bar's contents. `zone` is the zone chip when there's room for it beside the title. */
export function CalendarTopbar({ search, zone, onNew, ...p }: TopbarProps & { search: ReactNode; zone?: ReactNode; onNew: () => void }) {
  return (
    <>
      {!p.phone && <Today onToday={p.onToday} />}
      {!p.phone && <Step view={p.view} onStep={p.onStep} />}
      {!p.phone && (
        <h1 className="ml-1 min-w-0 truncate text-md font-semibold tracking-[-0.01em] whitespace-nowrap" aria-live="polite">
          {p.title}
        </h1>
      )}
      {zone}
      <span className="flex-1" />
      {search}
      {!p.phone && <Views view={p.view} phone={p.phone} onView={p.onView} />}
      {!p.phone && <InsightsButton insights={p.insights} onInsights={p.onInsights} />}
      <Button variant="primary" className="ml-1 max-[1000px]:w-8 max-[1000px]:px-0" onClick={onNew} title="New event (N)">
        <Icon name="plus" /> <span className="max-[1000px]:hidden">New event</span>
      </Button>
    </>
  )
}

/** Phones: step, title, today and insights, then the views, then the zone chip, above the grid. */
export function PhoneBar({ zone, ...p }: TopbarProps & { zone?: ReactNode }) {
  return (
    <div className="grid gap-1.5 border-b border-border px-2 pt-1.5 pb-2">
      <div className="flex items-center gap-1">
        <Step view={p.view} onStep={p.onStep} />
        <h1 className="m-0 min-w-0 flex-auto truncate text-base font-semibold tracking-[-0.01em] whitespace-nowrap">{p.title}</h1>
        <Today onToday={p.onToday} />
        <InsightsButton insights={p.insights} onInsights={p.onInsights} />
      </div>
      <Views view={p.view} phone onView={p.onView} className="w-full [&>button]:flex-1 [&>button]:justify-center" />
      {zone}
    </div>
  )
}
