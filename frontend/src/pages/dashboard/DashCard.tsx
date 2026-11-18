// Home's grid slots and cards. A slot owns its grid area, the error boundary and (for cards below the fold)
// mounting only near the viewport, so the area is named once instead of on the boundary, the placeholder
// and the card. A card fills its slot: a titled head with actions, then the body.
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { cardClass, CardHead, SkeletonRows } from '../../components/ui'
import { Boundary } from '../../components/resilience'
import { cn } from '../../lib/cn'
import type { IconName } from '../../components/Icon'

export type DashArea = 'agenda' | 'tasks' | 'week' | 'habits' | 'inbox' | 'links'

// Agenda, tasks and inbox stretch to their rows so the columns end together; habits does once it shares a
// column with week and inbox (two columns, below 1200px).
const AREA: Record<DashArea, string> = {
  agenda: '[grid-area:agenda] flex flex-col self-stretch',
  tasks: '[grid-area:tasks] flex flex-col self-stretch',
  week: '[grid-area:week] flex flex-col',
  habits: '[grid-area:habits] flex flex-col max-[1200px]:self-stretch',
  inbox: '[grid-area:inbox] flex flex-col self-stretch',
  links: '[grid-area:links] flex flex-col',
}

export const dashGrid = cn(
  'grid items-start gap-3',
  'grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,0.95fr)] grid-rows-[auto_auto_1fr_auto]',
  "[grid-template-areas:'agenda_tasks_week'_'agenda_tasks_habits'_'agenda_tasks_inbox'_'links_links_links']",
  'max-[1200px]:grid-cols-2 max-[1200px]:grid-rows-none',
  "max-[1200px]:[grid-template-areas:'agenda_tasks'_'week_habits'_'inbox_habits'_'links_links']",
  "max-md:grid-cols-1 max-md:[grid-template-areas:'agenda'_'tasks'_'habits'_'week'_'inbox'_'links']",
)

export function DashSlot({
  area,
  label,
  lazy,
  className,
  children,
}: {
  area: DashArea
  /** For the boundary's "Couldn't load …". */
  label: string
  /** Mount only near the viewport, showing this card skeleton until then. */
  lazy?: { title: string; rows: number }
  className?: string
  children: ReactNode
}) {
  return (
    <div className={cn(AREA[area], className)}>
      <Boundary label={label}>{lazy ? <WhenVisible {...lazy}>{children}</WhenVisible> : children}</Boundary>
    </div>
  )
}

/** Mount children (and so start their requests) only once the slot is within ~one screen of the viewport. */
function WhenVisible({ title, rows, children }: { title: string; rows: number; children: ReactNode }) {
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
  return (
    <div ref={ref}>
      <DashCard title={title} busy>
        <SkeletonRows rows={rows} />
      </DashCard>
    </div>
  )
}

export function DashCard({
  title,
  icon,
  titleId,
  actions,
  busy,
  children,
}: {
  title: ReactNode
  icon?: IconName
  titleId?: string
  /** Right of the title: counts, links, buttons. */
  actions?: ReactNode
  busy?: boolean
  children: ReactNode
}) {
  return (
    <section
      className={cn(cardClass, 'flex flex-1 flex-col')}
      aria-labelledby={busy ? undefined : titleId}
      aria-busy={busy || undefined}
      aria-label={busy && typeof title === 'string' ? title : undefined}
    >
      <CardHead title={title} icon={icon} titleId={titleId}>
        {actions}
      </CardHead>
      {children}
    </section>
  )
}
