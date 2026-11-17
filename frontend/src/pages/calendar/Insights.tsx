// Calendar insights (week / month) from /calendar/insights, drawn as plain SVG sized in real pixels
// (measured), so marks stay crisp: thin columns with rounded data ends, a one-hue heat map,
// bars in calendar colours for identity. Text always uses text tokens; marks carry the colour.
import { useState, type ReactNode } from 'react'
import { ChartTooltip, PlotColumns as Columns, useSize, type ChartTip } from '../../components/charts'
import { Icon } from '../../components/Icon'
import { Button, QueryView, Segmented } from '../../components/ui'
import { cn } from '../../lib/cn'
import { addDays, dayKey, fmtDate, parseDayKey } from '../../lib/dates'
import { plural } from '../../lib/format'
import { useInsights } from '../../lib/queries'
import type { Insights as InsightsData } from '../../lib/types'
import { pill } from './chips'
import { hourFmt } from './format'
import type { InsightsPeriod } from './range'
import { SEGMENTED_FIX } from './segmentedFix'

/** Signed delta label: "+9.8 h", "−2 h" (dir 0: no change). */
export function delta(cur: number, prev: number, unit = ''): { text: string; dir: 1 | -1 | 0 } {
  const d = Math.round((cur - prev) * 10) / 10
  if (d === 0) return { text: 'same as before', dir: 0 }
  return { text: `${d > 0 ? '+' : '−'}${Math.abs(d)}${unit}`, dir: d > 0 ? 1 : -1 }
}

/** Hours as people say them: "0 h", "45 min", "9.8 h". */
export function hours(h: number): string {
  if (h === 0) return '0 h'
  if (h < 1) return `${Math.round(h * 60)} min`
  return `${Math.round(h * 10) / 10} h`
}

/** Horizontal bar with the right (data) end rounded. */
function barPath(x: number, y: number, w: number, h: number, r = 3): string {
  if (w <= 0) return ''
  const rr = Math.min(r, h / 2, w)
  return `M${x},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h - rr}Q${x + w},${y + h} ${x + w - rr},${y + h}H${x}Z`
}

function Bars({ rows }: { rows: { label: string; value: number; colour?: string; tip: string }[] }) {
  const [ref, { w }] = useSize<HTMLDivElement>()
  const max = Math.max(0.0001, ...rows.map((r) => r.value))
  return (
    <div className="grid gap-2" ref={ref}>
      {rows.map((r) => (
        <div key={r.label} className="grid grid-cols-[minmax(0,1fr)_auto] gap-y-1 text-sm" title={r.tip}>
          <span className="flex min-w-0 items-center gap-1.5 pr-2">
            {r.colour && <span className="size-2 flex-none rounded-full" style={{ background: r.colour }} />}
            <span className="min-w-0 truncate">{r.label}</span>
          </span>
          <span className="text-xs text-muted tabular-nums">{hours(r.value)}</span>
          {w > 0 && (
            <svg width={w} height={6} className="col-span-full block" aria-hidden="true">
              <rect x={0} y={0} width={w} height={6} rx={3} className="fill-surface-2" />
              <path
                d={barPath(0, 0, Math.max(3, (r.value / max) * w), 6)}
                className="fill-accent"
                style={r.colour ? { fill: r.colour } : undefined}
              />
            </svg>
          )}
        </div>
      ))}
    </div>
  )
}

const WEEKDAYS = Array.from({ length: 7 }, (_, i) => fmtDate(new Date(2026, 10, 2 + i), { weekday: 'short' }))
/** Monday-first weekday data (as the server sends it) in the user's week order. */
const inWeekOrder = <T,>(a: T[], weekStart: 0 | 1): T[] => (weekStart === 0 && a.length === 7 ? [a[6], ...a.slice(0, 6)] : a)

const WEEK = [0, 1, 2, 3, 4, 5, 6]
const DAY_HOURS = Array.from({ length: 24 }, (_, h) => h)

function Heat({ heat, labels }: { heat: number[][]; labels: string[] }) {
  const [ref, { w }] = useSize<HTMLDivElement>()
  const [tip, setTip] = useState<ChartTip | null>(null)
  const max = Math.max(0.0001, ...heat.flat())
  const gap = 2
  const cw = w ? (w - gap * 23) / 24 : 0
  const ch = Math.min(Math.max(cw, 8), 16)
  const step = (v: number) => (v <= 0 ? 0 : [0.18, 0.34, 0.52, 0.74, 1][Math.min(4, Math.floor((v / max) * 5 - 1e-9))])
  return (
    <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-1.5">
      <div
        className="grid items-center text-3xs text-muted"
        aria-hidden="true"
        style={{ gridTemplateRows: `repeat(7, ${ch}px)`, rowGap: gap }}
      >
        {labels.map((d) => (
          <span key={d}>{d}</span>
        ))}
      </div>
      <div className="grid min-w-0 gap-1">
        {/* biome-ignore lint/a11y/noStaticElementInteractions: the hover tooltip only repeats each cell's <title> */}
        <div ref={ref} className="relative" onMouseLeave={() => setTip(null)}>
          {w > 0 && (
            <svg width={w} height={7 * ch + 6 * gap} role="img" aria-label="Busy hours by weekday" className="block overflow-visible">
              {WEEK.map((d) =>
                DAY_HOURS.map((hr) => {
                  const v = heat[d]?.[hr] ?? 0
                  const text = `${labels[d]} ${hourFmt.format(new Date(2000, 0, 1, hr))}: ${hours(v)}`
                  const x = hr * (cw + gap)
                  const y = d * (ch + gap)
                  return (
                    // biome-ignore lint/a11y/noStaticElementInteractions: hover shows the cell's <title> as a tooltip
                    <rect
                      key={`${d}-${hr}`}
                      x={x}
                      y={y}
                      width={cw}
                      height={ch}
                      rx={2}
                      className={v > 0 ? 'fill-accent' : 'fill-surface-2'}
                      style={v > 0 ? { fillOpacity: step(v) } : undefined}
                      onMouseEnter={() => setTip({ x: x + cw / 2, y, text })}
                    >
                      <title>{text}</title>
                    </rect>
                  )
                }),
              )}
            </svg>
          )}
          <ChartTooltip tip={tip} width={w} />
        </div>
        <div className="relative h-3.5 text-3xs text-muted" aria-hidden="true">
          {[0, 6, 12, 18].map((h) => (
            <span key={h} className="absolute top-0" style={{ left: `${(h / 24) * 100}%` }}>
              {hourFmt.format(new Date(2000, 0, 1, h))}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}

function Section({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="grid gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-xs font-semibold tracking-[0.04em] text-muted uppercase">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  )
}

const deltaClass = 'inline-flex items-center gap-0.5 text-xs text-muted'

function Delta({ cur, prev, unit, label }: { cur: number; prev: number; unit?: string; label: string }) {
  const d = delta(cur, prev, unit)
  return (
    <span className={deltaClass}>
      {d.dir !== 0 && <Icon name={d.dir > 0 ? 'arrowUp' : 'arrowDown'} size={12} />}
      {d.dir === 0 ? `Same as ${label}` : `${d.text} vs ${label}`}
    </span>
  )
}

function periodLabel(d: InsightsData): string {
  const s = parseDayKey(d.start)
  const e = parseDayKey(d.end)
  if (d.period === 'month') return fmtDate(s, { month: 'long', year: 'numeric' })
  const sameMonth = s.getMonth() === e.getMonth()
  return `${fmtDate(s, { month: 'short', day: 'numeric' })} – ${fmtDate(e, sameMonth ? { day: 'numeric' } : { month: 'short', day: 'numeric' })}`
}

export function InsightsPanel({
  period,
  date,
  weekStart = 1,
  inDrawer,
  onPeriod,
  onDate,
  onClose,
}: {
  period: InsightsPeriod
  date: Date
  weekStart?: 0 | 1
  /** In the narrow-screen drawer: full width, no side border. */
  inDrawer?: boolean
  onPeriod: (p: InsightsPeriod) => void
  onDate: (d: Date) => void
  onClose: () => void
}) {
  const q = useInsights(period, dayKey(date))
  const prevLabel = period === 'week' ? 'last week' : 'last month'
  const step = (dir: number) => onDate(period === 'week' ? addDays(date, 7 * dir) : new Date(date.getFullYear(), date.getMonth() + dir, 1))
  const today = dayKey(new Date())
  const sk = 'block animate-pulse rounded-xs bg-surface-2'

  return (
    <aside
      className={cn('flex min-h-0 flex-col bg-surface', inDrawer ? 'w-full flex-1' : 'w-92 flex-none border-l border-border')}
      aria-label="Calendar insights"
    >
      <div className="flex items-center gap-2 pt-2.5 pr-2 pb-1.5 pl-4">
        <Icon name="chart" className="text-accent" />
        <h2 className="min-w-0 flex-auto text-base">Insights</h2>
        <Segmented<InsightsPeriod>
          className={SEGMENTED_FIX}
          label="Period"
          value={period}
          onChange={onPeriod}
          options={[
            { value: 'week', label: 'Week' },
            { value: 'month', label: 'Month' },
          ]}
        />
        <Button variant="ghost" size="sm" icon onClick={onClose} aria-label="Close insights">
          <Icon name="x" />
        </Button>
      </div>
      <div className="flex items-center gap-1 border-b border-border pr-2 pb-2 pl-4 text-sm font-medium">
        <Button variant="ghost" size="sm" icon onClick={() => step(-1)} aria-label={`Previous ${period}`}>
          <Icon name="chevronLeft" />
        </Button>
        <span className="min-w-0 flex-auto">{q.data ? periodLabel(q.data) : ' '}</span>
        <Button variant="ghost" size="sm" icon onClick={() => step(1)} aria-label={`Next ${period}`}>
          <Icon name="chevronRight" />
        </Button>
      </div>
      <div
        className={cn(
          'grid flex-1 content-start gap-5 overflow-y-auto px-4 pt-3 pb-6 transition-opacity duration-150',
          q.isPlaceholderData && 'opacity-60',
        )}
      >
        <QueryView
          query={q}
          skeleton={
            <div className="grid gap-2 py-2">
              <span className={cn(sk, 'h-10 w-[45%]')} />
              <span className={cn(sk, 'h-24')} />
              <span className={cn(sk, 'h-32')} />
            </div>
          }
        >
          {(d) => (
            <>
              <div className="flex items-end gap-3">
                <div className="text-[2rem] leading-none font-[650] tracking-[-0.03em] tabular-nums">{hours(d.totals.hours)}</div>
                <div className="grid gap-0.5 pb-0.5 text-xs text-muted">
                  <span>scheduled</span>
                  <Delta cur={d.totals.hours} prev={d.previous.hours} unit=" h" label={prevLabel} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Tile
                  label="Events"
                  value={String(d.totals.events)}
                  sub={<Delta cur={d.totals.events} prev={d.previous.events} label={prevLabel} />}
                />
                <Tile
                  label="Meetings"
                  value={hours(d.totals.meeting_hours)}
                  sub={<Delta cur={d.totals.meeting_hours} prev={d.previous.meeting_hours} unit=" h" label={prevLabel} />}
                />
                <Tile
                  label="Focus time"
                  value={hours(d.totals.focus_hours)}
                  sub={<Delta cur={d.totals.focus_hours} prev={d.previous.focus_hours} unit=" h" label={prevLabel} />}
                />
                <Tile
                  label="Free days"
                  value={String(d.totals.free_days)}
                  sub={<span className={deltaClass}>{plural(d.totals.deadlines, 'deadline')}</span>}
                />
              </div>

              <Section
                title="Hours per day"
                aside={
                  d.totals.busiest_day && (
                    <span className="text-xs text-muted">
                      Busiest: {fmtDate(parseDayKey(d.totals.busiest_day.date), { weekday: 'short', month: 'short', day: 'numeric' })}
                    </span>
                  )
                }
              >
                <Columns
                  values={d.per_day.map((p) => p.hours)}
                  labels={d.per_day.map((p) =>
                    period === 'week' ? fmtDate(parseDayKey(p.date), { weekday: 'narrow' }) : String(parseDayKey(p.date).getDate()),
                  )}
                  tips={d.per_day.map(
                    (p) =>
                      `${fmtDate(parseDayKey(p.date), { weekday: 'short', month: 'short', day: 'numeric' })}: ${hours(p.hours)}, ${plural(p.events, 'event')}`,
                  )}
                  highlight={d.per_day.findIndex((p) => p.date === today)}
                  labelEvery={period === 'week' ? 1 : 7}
                />
              </Section>

              {period === 'month' && (
                <Section title="By weekday">
                  <Columns
                    values={inWeekOrder(d.by_weekday, weekStart)}
                    labels={inWeekOrder(WEEKDAYS, weekStart)}
                    tips={inWeekOrder(
                      d.by_weekday.map((h, i) => `${WEEKDAYS[i]}: ${hours(h)}`),
                      weekStart,
                    )}
                  />
                </Section>
              )}

              {d.by_category.length > 0 && (
                <Section title="By category">
                  <Bars
                    rows={d.by_category.slice(0, 7).map((c) => ({
                      label: c.label,
                      value: c.hours,
                      tip: `${c.label}: ${hours(c.hours)} over ${plural(c.events, 'event')}`,
                    }))}
                  />
                </Section>
              )}

              {d.by_calendar.length > 0 && (
                <Section title="By calendar">
                  <Bars
                    rows={d.by_calendar.map((c) => ({
                      label: c.name,
                      value: c.hours,
                      colour: c.colour,
                      tip: `${c.name}: ${hours(c.hours)} over ${plural(c.events, 'event')}`,
                    }))}
                  />
                </Section>
              )}

              <Section
                title="When you're busy"
                aside={
                  d.totals.typical_start && (
                    <span className="text-xs text-muted">
                      Typical day {d.totals.typical_start}–{d.totals.typical_end}
                    </span>
                  )
                }
              >
                <Heat heat={inWeekOrder(d.heat, weekStart)} labels={inWeekOrder(WEEKDAYS, weekStart)} />
              </Section>

              <Section title="More">
                <dl className="m-0 grid gap-1.5 text-sm [&_dd]:m-0 [&_dd]:font-medium [&_dt]:text-muted [&>div]:flex [&>div]:justify-between [&>div]:gap-2">
                  <div>
                    <dt>Average event</dt>
                    <dd className="tabular-nums">{d.totals.avg_minutes} min</dd>
                  </div>
                  <div>
                    <dt>Longest</dt>
                    <dd className="tabular-nums">{hours(d.totals.longest_minutes / 60)}</dd>
                  </div>
                  <div>
                    <dt>Evenings (after 6 PM)</dt>
                    <dd className="tabular-nums">{hours(d.totals.evening_hours)}</dd>
                  </div>
                  <div>
                    <dt>Weekends</dt>
                    <dd className="tabular-nums">{hours(d.totals.weekend_hours)}</dd>
                  </div>
                  <div>
                    <dt>Early (before 8 AM)</dt>
                    <dd className="tabular-nums">{hours(d.totals.early_hours)}</dd>
                  </div>
                  <div>
                    <dt>All-day events</dt>
                    <dd className="tabular-nums">{d.totals.all_day}</dd>
                  </div>
                  <div>
                    <dt>Deadlines</dt>
                    <dd className="tabular-nums">
                      {d.totals.deadlines}{' '}
                      <span className="text-muted">
                        ({d.previous.deadlines} {prevLabel})
                      </span>
                    </dd>
                  </div>
                  <div>
                    <dt>Tasks due</dt>
                    <dd className="tabular-nums">{d.todos.due}</dd>
                  </div>
                  <div>
                    <dt>Tasks created</dt>
                    <dd className="tabular-nums">{d.todos.created}</dd>
                  </div>
                  <div>
                    <dt>Overdue now</dt>
                    <dd className={cn('tabular-nums', d.todos.overdue_now && 'text-danger')}>{d.todos.overdue_now}</dd>
                  </div>
                  <div>
                    <dt>Todos done</dt>
                    <dd className="tabular-nums">
                      {d.todos.completed}{' '}
                      <span className="text-muted">
                        ({d.todos.completed_previous} {prevLabel})
                      </span>
                    </dd>
                  </div>
                  <div>
                    <dt>Photos taken</dt>
                    <dd className="tabular-nums">{d.photos}</dd>
                  </div>
                </dl>
                {d.top_locations.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {d.top_locations.map((l) => (
                      <span key={l.name} className={pill}>
                        <Icon name="pin" size={11} className="text-muted" />
                        {l.name}
                        <span className="text-muted tabular-nums">{l.count}</span>
                      </span>
                    ))}
                  </div>
                )}
              </Section>
            </>
          )}
        </QueryView>
      </div>
    </aside>
  )
}

function Tile({ label, value, sub }: { label: string; value: string; sub: ReactNode }) {
  return (
    <div className="grid min-w-0 gap-px rounded-sm border border-border bg-bg px-2.5 py-2">
      <span className="text-xs text-muted">{label}</span>
      <span className="text-md font-semibold tabular-nums">{value}</span>
      {sub}
    </div>
  )
}
