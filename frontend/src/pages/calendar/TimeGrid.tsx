// The 24-hour grid both the week/day view and someone's availability draw on: day headers, an optional all-day
// row, and a scrolling body with the hour gutter and one column per day. Callers fill the columns; the grid
// owns the geometry (--hour per hour, --gutter for the labels, --cols days) so both views line up the same.
// An hour is 3rem, or a 24th of the body's height when that's taller (a tall or 4K screen), so the day fills the
// screen instead of ending halfway down; the body is a size container and --hour is resolved inside it (cqh).
import type { CSSProperties, ReactNode, Ref } from 'react'
import { cn } from '../../lib/cn'
import { fmtDate } from '../../lib/dates'
import { hourFmt } from './format'
import { pct } from './layout'

const HOURS = Array.from({ length: 24 }, (_, h) => h)
const row = 'grid grid-cols-[var(--gutter)_repeat(var(--cols),minmax(0,1fr))]'

export function TimeGrid({
  days,
  wide,
  corner,
  head,
  allDay,
  allDayLabel = 'all-day',
  scrollRef,
  bodyRef,
  bodyClassName,
  bodyProps,
  homeHours,
  children,
}: {
  days: Date[]
  /** A wider gutter, for a second column of hour labels (the home zone's). */
  wide?: boolean
  /** The gutter cell above the hour labels. */
  corner?: ReactNode
  /** What goes under each day's header button (a photo count). */
  head: (day: Date) => ReactNode
  /** The all-day row's cells, one per day; leave out for no all-day row. */
  allDay?: (day: Date, i: number) => ReactNode
  allDayLabel?: string
  scrollRef?: Ref<HTMLDivElement>
  bodyRef?: Ref<HTMLDivElement>
  bodyClassName?: string
  bodyProps?: Pick<React.HTMLAttributes<HTMLDivElement>, 'onPointerDown' | 'onClickCapture'>
  /** Second labels at each hour (index = hour), drawn at the gutter's left edge. */
  homeHours?: string[] | null
  /** The day columns, in order. */
  children: ReactNode
}) {
  return (
    <div
      className={cn(
        'flex min-h-0 flex-1 flex-col [--hour:max(3rem,100cqh/24)] max-md:[--hour:2.75rem]',
        wide ? '[--gutter:6.5rem]' : '[--gutter:3.5rem] max-md:[--gutter:2.75rem]',
      )}
      style={{ '--cols': days.length } as CSSProperties}
    >
      <div className={cn(row, 'overflow-y-hidden border-b border-border [scrollbar-gutter:stable]')}>
        {corner ?? <div aria-hidden="true" />}
        {days.map((d) => (
          <div key={d.getTime()} className="relative grid">
            {head(d)}
          </div>
        ))}
      </div>
      {allDay && (
        <div
          className={cn(row, 'max-h-26 min-h-7 overflow-y-hidden border-b border-border [scrollbar-gutter:stable] hover:overflow-y-auto')}
        >
          <div className="pt-1.5 pr-2 text-right text-3xs whitespace-nowrap text-muted">{allDayLabel}</div>
          {days.map((d, i) => allDay(d, i))}
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto [container-type:size] [scrollbar-gutter:stable]" ref={scrollRef}>
        <div className={cn(row, 'relative h-[calc(var(--hour)*24)]', bodyClassName)} ref={bodyRef} {...bodyProps}>
          <div className="relative" aria-hidden="true">
            {HOURS.map(
              (h) =>
                h > 0 && (
                  <span key={h} className={cn(hourText, 'right-2')} style={{ top: pct(h * 60) }}>
                    {hourFmt.format(new Date(2000, 0, 1, h))}
                  </span>
                ),
            )}
            {homeHours &&
              HOURS.map(
                (h) =>
                  h > 0 && (
                    <span key={`home${h}`} className={cn(hourText, 'left-1.5 opacity-70')} style={{ top: pct(h * 60) }}>
                      {homeHours[h]}
                    </span>
                  ),
              )}
          </div>
          {children}
        </div>
      </div>
    </div>
  )
}

const hourText = 'absolute -translate-y-1/2 text-2xs whitespace-nowrap text-muted tabular-nums'

/** A day's column: hour lines every --hour, a faint hover tint when it can be clicked to create. */
export const dayColumn = (interactive = true) =>
  cn(
    'relative min-w-0 border-l border-border bg-[linear-gradient(to_bottom,var(--app-border)_1px,transparent_1px)] bg-[length:100%_var(--hour)]',
    interactive ? 'hover:bg-[color-mix(in_srgb,var(--app-fg)_1.5%,transparent)]' : 'cursor-default',
  )

/** The weekday and date at the top of a column; today's date is filled. */
export function DayHeader({ day, today, onClick }: { day: Date; today: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      className="group grid justify-items-center gap-0.5 border-0 bg-transparent px-0 pt-1.5 pb-2 text-muted"
      onClick={onClick}
      aria-label={fmtDate(day, { weekday: 'long', month: 'long', day: 'numeric' })}
    >
      <span className={cn('text-xs font-medium tracking-[0.04em] uppercase', today && 'text-accent')}>
        {fmtDate(day, { weekday: 'short' })}
      </span>
      <span
        className={cn(
          'grid size-9 place-items-center rounded-full text-lg font-medium tabular-nums max-md:size-8 max-md:text-md',
          today ? 'bg-accent text-accent-fg' : 'text-fg group-hover:bg-hover',
        )}
      >
        {day.getDate()}
      </span>
    </button>
  )
}

/** The red "now" line across today's column, at `min` minutes past midnight. */
export function NowLine({ min }: { min: number }) {
  return (
    <div
      className="pointer-events-none absolute right-0 -left-px z-5 h-0.5 bg-danger before:absolute before:-top-1 before:-left-1.25 before:size-2.5 before:rounded-full before:bg-danger"
      style={{ top: pct(min) }}
      aria-hidden="true"
    />
  )
}
