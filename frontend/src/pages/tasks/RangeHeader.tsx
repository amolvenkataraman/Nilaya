// The heading of the timeline and calendar layouts: the range shown, a note, and earlier / Today / later.
import type { ReactNode } from 'react'
import { Icon } from '../../components/Icon'
import { Button } from '../../components/ui'

export function RangeHeader({
  title,
  note,
  prev,
  next,
  onPrev,
  onNext,
  onToday,
  todayDisabled,
}: {
  title: string
  note?: ReactNode
  /** Labels of the step buttons ("Two weeks earlier"). */
  prev: string
  next: string
  onPrev: () => void
  onNext: () => void
  onToday: () => void
  todayDisabled?: boolean
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <h2 className="text-sm font-semibold tabular-nums">{title}</h2>
      {note}
      <span className="flex-1" />
      <div className="inline-flex gap-1">
        <Button size="sm" icon onClick={onPrev} aria-label={prev} title={prev}>
          <Icon name="chevronLeft" size={14} />
        </Button>
        <Button size="sm" onClick={onToday} disabled={todayDisabled}>
          Today
        </Button>
        <Button size="sm" icon onClick={onNext} aria-label={next} title={next}>
          <Icon name="chevronRight" size={14} />
        </Button>
      </div>
    </div>
  )
}
