// Calendar insights (week / month) from /calendar/insights, drawn as plain SVG sized in real pixels
// (measured), so marks stay crisp: thin columns with rounded data ends, a one-hue heat map,
// bars in calendar colours for identity. Text always uses text tokens; marks carry the colour.
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Icon } from '../../components/Icon'
import { ErrorBox } from '../../components/ui'
import { addDays, dayKey, fmtDate, parseDayKey } from '../../lib/dates'
import { useInsights } from '../../lib/queries'
import type { Insights as InsightsData } from '../../lib/types'
import { delta, hours } from './util'

function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setSize({ w: Math.floor(e.contentRect.width), h: Math.floor(e.contentRect.height) }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, size] as const
}

/** Rect with only the data end (top) rounded; anchored square to the baseline. */
function colPath(x: number, y: number, w: number, h: number, r = 3): string {
  if (h <= 0) return ''
  const rr = Math.min(r, w / 2, h)
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`
}
/** Horizontal bar with the right (data) end rounded. */
function barPath(x: number, y: number, w: number, h: number, r = 3): string {
  if (w <= 0) return ''
  const rr = Math.min(r, h / 2, w)
  return `M${x},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h - rr}Q${x + w},${y + h} ${x + w - rr},${y + h}H${x}Z`
}

interface Tip { x: number; y: number; text: string }
function Tooltip({ tip }: { tip: Tip | null }) {
  if (!tip) return null
  return <div className="ins-tip" style={{ left: tip.x, top: tip.y }} role="tooltip">{tip.text}</div>
}

function Columns({ values, labels, tips, highlight, labelEvery = 1 }: { values: number[]; labels: string[]; tips: string[]; highlight?: number; labelEvery?: number }) {
  const [ref, { w, h }] = useSize<HTMLDivElement>()
  const [tip, setTip] = useState<Tip | null>(null)
  const [hover, setHover] = useState<number | null>(null)
  const max = Math.max(1, ...values)
  const n = values.length
  const slot = n ? w / n : 0
  const bw = Math.max(2, Math.min(18, slot * (n > 14 ? 0.62 : 0.5)))
  const plotH = Math.max(0, h - 4)
  return (
    <div className="ins-cols-wrap">
      <div ref={ref} className="ins-cols" onMouseLeave={() => (setTip(null), setHover(null))}>
        {w > 0 && (
          <svg width={w} height={h} role="img" aria-label={tips.join('; ')}>
            <line x1={0} x2={w} y1={plotH + 0.5} y2={plotH + 0.5} className="ins-base" />
            {values.map((v, i) => {
              const bh = (v / max) * (plotH - 2)
              const x = i * slot + (slot - bw) / 2
              return (
                <g key={i}>
                  <path d={colPath(x, plotH - bh, bw, bh)} className={'ins-mark' + (i === highlight ? ' strong' : '') + (hover != null && hover !== i ? ' dim' : '')} />
                  <rect
                    x={i * slot}
                    y={0}
                    width={slot}
                    height={h}
                    fill="transparent"
                    onMouseEnter={() => (setHover(i), setTip({ x: i * slot + slot / 2, y: Math.max(0, plotH - bh - 6), text: tips[i] }))}
                  >
                    <title>{tips[i]}</title>
                  </rect>
                </g>
              )
            })}
          </svg>
        )}
        <Tooltip tip={tip} />
      </div>
      <div className="ins-xlabels" style={{ gridTemplateColumns: `repeat(${n}, 1fr)` }} aria-hidden="true">
        {labels.map((l, i) => <span key={i}>{i % labelEvery === 0 ? l : ''}</span>)}
      </div>
    </div>
  )
}

function Bars({ rows }: { rows: { label: string; value: number; colour?: string; tip: string }[] }) {
  const [ref, { w }] = useSize<HTMLDivElement>()
  const max = Math.max(0.0001, ...rows.map((r) => r.value))
  return (
    <div className="ins-bars" ref={ref}>
      {rows.map((r) => (
        <div key={r.label} className="ins-bar-row" title={r.tip}>
          <span className="ins-bar-label truncate">
            {r.colour && <span className="dot" style={{ background: r.colour }} />}
            {r.label}
          </span>
          <span className="ins-bar-value tabular">{hours(r.value)}</span>
          {w > 0 && (
            <svg width={w} height={6} className="ins-bar-svg" aria-hidden="true">
              <rect x={0} y={0} width={w} height={6} rx={3} className="ins-track" />
              <path d={barPath(0, 0, Math.max(3, (r.value / max) * w), 6)} className="ins-mark" style={r.colour ? { fill: r.colour } : undefined} />
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
const hourFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric' })

function Heat({ heat, labels }: { heat: number[][]; labels: string[] }) {
  const [ref, { w }] = useSize<HTMLDivElement>()
  const [tip, setTip] = useState<Tip | null>(null)
  const max = Math.max(0.0001, ...heat.flat())
  const gap = 2
  const cw = w ? (w - gap * 23) / 24 : 0
  const ch = Math.min(Math.max(cw, 8), 16)
  const step = (v: number) => (v <= 0 ? 0 : [0.18, 0.34, 0.52, 0.74, 1][Math.min(4, Math.floor((v / max) * 5 - 1e-9))])
  return (
    <div className="ins-heat">
      <div className="ins-heat-days" aria-hidden="true" style={{ gridTemplateRows: `repeat(7, ${ch}px)`, rowGap: gap }}>
        {labels.map((d) => <span key={d}>{d}</span>)}
      </div>
      <div className="ins-heat-plot">
        <div ref={ref} style={{ position: 'relative' }} onMouseLeave={() => setTip(null)}>
          {w > 0 && (
            <svg width={w} height={7 * ch + 6 * gap} role="img" aria-label="Busy hours by weekday">
              {heat.map((row, d) =>
                row.map((v, hr) => {
                  const text = `${labels[d]} ${hourFmt.format(new Date(2000, 0, 1, hr))}: ${hours(v)}`
                  const x = hr * (cw + gap)
                  const y = d * (ch + gap)
                  return (
                    <rect
                      key={`${d}-${hr}`}
                      x={x}
                      y={y}
                      width={cw}
                      height={ch}
                      rx={2}
                      className={v > 0 ? 'ins-heat-on' : 'ins-heat-off'}
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
          <Tooltip tip={tip} />
        </div>
        <div className="ins-heat-hours" aria-hidden="true">
          {[0, 6, 12, 18].map((h) => <span key={h} style={{ left: `${(h / 24) * 100}%` }}>{hourFmt.format(new Date(2000, 0, 1, h))}</span>)}
        </div>
      </div>
    </div>
  )
}

function Section({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="ins-section">
      <div className="ins-section-head">
        <h3>{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  )
}

function Delta({ cur, prev, unit, label }: { cur: number; prev: number; unit?: string; label: string }) {
  const d = delta(cur, prev, unit)
  return (
    <span className="ins-delta">
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

export function InsightsPanel({ period, date, weekStart = 1, onPeriod, onDate, onClose }: {
  period: 'week' | 'month'; date: Date; weekStart?: 0 | 1; onPeriod: (p: 'week' | 'month') => void; onDate: (d: Date) => void; onClose: () => void
}) {
  const q = useInsights(period, dayKey(date))
  const d = q.data
  const prevLabel = period === 'week' ? 'last week' : 'last month'
  const step = (dir: number) => onDate(period === 'week' ? addDays(date, 7 * dir) : new Date(date.getFullYear(), date.getMonth() + dir, 1))
  const today = dayKey(new Date())

  return (
    <aside className="insights" aria-label="Calendar insights">
      <div className="ins-head">
        <Icon name="chart" />
        <h2 className="grow">Insights</h2>
        <div className="seg" role="group" aria-label="Period">
          <button aria-pressed={period === 'week'} onClick={() => onPeriod('week')}>Week</button>
          <button aria-pressed={period === 'month'} onClick={() => onPeriod('month')}>Month</button>
        </div>
        <button className="btn ghost icon sm" onClick={onClose} aria-label="Close insights"><Icon name="x" /></button>
      </div>
      <div className="ins-period">
        <button className="btn ghost icon sm" onClick={() => step(-1)} aria-label={`Previous ${period}`}><Icon name="chevronLeft" /></button>
        <span className="grow">{d ? periodLabel(d) : ' '}</span>
        <button className="btn ghost icon sm" onClick={() => step(1)} aria-label={`Next ${period}`}><Icon name="chevronRight" /></button>
      </div>
      <div className="ins-body" style={{ opacity: q.isPlaceholderData ? 0.6 : 1 }}>
        {q.isError && !q.data ? (
          <ErrorBox error={q.error} retry={() => q.refetch()} />
        ) : !d ? (
          <div className="stack" style={{ padding: '0.5rem 0' }}>
            <span className="sk" style={{ height: '2.5rem', width: '45%' }} />
            <span className="sk" style={{ height: '6rem' }} />
            <span className="sk" style={{ height: '8rem' }} />
          </div>
        ) : (
          <>
            <div className="ins-hero">
              <div className="ins-big tabular">{hours(d.totals.hours)}</div>
              <div className="ins-hero-sub">
                <span>scheduled</span>
                <Delta cur={d.totals.hours} prev={d.previous.hours} unit=" h" label={prevLabel} />
              </div>
            </div>
            <div className="ins-tiles">
              <Tile label="Events" value={String(d.totals.events)} sub={<Delta cur={d.totals.events} prev={d.previous.events} label={prevLabel} />} />
              <Tile label="Meetings" value={hours(d.totals.meeting_hours)} sub={<Delta cur={d.totals.meeting_hours} prev={d.previous.meeting_hours} unit=" h" label={prevLabel} />} />
              <Tile label="Focus time" value={hours(d.totals.focus_hours)} sub={<Delta cur={d.totals.focus_hours} prev={d.previous.focus_hours} unit=" h" label={prevLabel} />} />
              <Tile label="Free days" value={String(d.totals.free_days)} sub={<span className="ins-delta">{d.totals.deadlines} deadline{d.totals.deadlines === 1 ? '' : 's'}</span>} />
            </div>

            <Section title="Hours per day" aside={d.totals.busiest_day && <span className="muted xsmall">Busiest: {fmtDate(parseDayKey(d.totals.busiest_day.date), { weekday: 'short', month: 'short', day: 'numeric' })}</span>}>
              <Columns
                values={d.per_day.map((p) => p.hours)}
                labels={d.per_day.map((p) => (period === 'week' ? fmtDate(parseDayKey(p.date), { weekday: 'narrow' }) : String(parseDayKey(p.date).getDate())))}
                tips={d.per_day.map((p) => `${fmtDate(parseDayKey(p.date), { weekday: 'short', month: 'short', day: 'numeric' })}: ${hours(p.hours)}, ${p.events} event${p.events === 1 ? '' : 's'}`)}
                highlight={d.per_day.findIndex((p) => p.date === today)}
                labelEvery={period === 'week' ? 1 : 7}
              />
            </Section>

            {period === 'month' && (
              <Section title="By weekday">
                <Columns values={inWeekOrder(d.by_weekday, weekStart)} labels={inWeekOrder(WEEKDAYS, weekStart)} tips={inWeekOrder(d.by_weekday.map((h, i) => `${WEEKDAYS[i]}: ${hours(h)}`), weekStart)} />
              </Section>
            )}

            {d.by_category.length > 0 && (
              <Section title="By category">
                <Bars rows={d.by_category.slice(0, 7).map((c) => ({ label: c.label, value: c.hours, tip: `${c.label}: ${hours(c.hours)} over ${c.events} event${c.events === 1 ? '' : 's'}` }))} />
              </Section>
            )}

            {d.by_calendar.length > 0 && (
              <Section title="By calendar">
                <Bars rows={d.by_calendar.map((c) => ({ label: c.name, value: c.hours, colour: c.colour, tip: `${c.name}: ${hours(c.hours)} over ${c.events} event${c.events === 1 ? '' : 's'}` }))} />
              </Section>
            )}

            <Section title="When you're busy" aside={d.totals.typical_start && <span className="muted xsmall">Typical day {d.totals.typical_start}–{d.totals.typical_end}</span>}>
              <Heat heat={inWeekOrder(d.heat, weekStart)} labels={inWeekOrder(WEEKDAYS, weekStart)} />
            </Section>

            <Section title="More">
              <dl className="ins-facts">
                <div><dt>Average event</dt><dd className="tabular">{d.totals.avg_minutes} min</dd></div>
                <div><dt>Longest</dt><dd className="tabular">{hours(d.totals.longest_minutes / 60)}</dd></div>
                <div><dt>Evenings (after 6 PM)</dt><dd className="tabular">{hours(d.totals.evening_hours)}</dd></div>
                <div><dt>Weekends</dt><dd className="tabular">{hours(d.totals.weekend_hours)}</dd></div>
                <div><dt>Early (before 8 AM)</dt><dd className="tabular">{hours(d.totals.early_hours)}</dd></div>
                <div><dt>All-day events</dt><dd className="tabular">{d.totals.all_day}</dd></div>
                <div><dt>Deadlines</dt><dd className="tabular">{d.totals.deadlines} <span className="muted">({d.previous.deadlines} {prevLabel})</span></dd></div>
                <div><dt>Tasks due</dt><dd className="tabular">{d.todos.due}</dd></div>
                <div><dt>Tasks created</dt><dd className="tabular">{d.todos.created}</dd></div>
                <div><dt>Overdue now</dt><dd className={'tabular' + (d.todos.overdue_now ? ' danger-text' : '')}>{d.todos.overdue_now}</dd></div>
                <div><dt>Todos done</dt><dd className="tabular">{d.todos.completed} <span className="muted">({d.todos.completed_previous} {prevLabel})</span></dd></div>
                <div><dt>Photos taken</dt><dd className="tabular">{d.photos}</dd></div>
              </dl>
              {d.top_locations.length > 0 && (
                <div className="ins-places">
                  {d.top_locations.map((l) => (
                    <span key={l.name} className="chip"><Icon name="pin" size={11} />{l.name}<span className="muted tabular">{l.count}</span></span>
                  ))}
                </div>
              )}
            </Section>
          </>
        )}
      </div>
    </aside>
  )
}

function Tile({ label, value, sub }: { label: string; value: string; sub: ReactNode }) {
  return (
    <div className="ins-tile">
      <span className="ins-tile-label">{label}</span>
      <span className="ins-tile-value tabular">{value}</span>
      {sub}
    </div>
  )
}
