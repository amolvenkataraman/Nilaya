// The habit page's two charts, plain SVG in the habit's colour (--hc): a GitHub-style year heat map (one
// column per week, Monday first, four steps plus skipped / not scheduled) and habit strength over time.
import { useMemo, useState } from 'react'
import { addDays, fmtDate, parseDayKey } from '../../lib/dates'
import type { Habit, Stats } from './api'
import { fmtNum } from './habitRules'

const LEVEL: Record<string, string> = {
  '0': 'fill-surface-2',
  '1': 'fill-[color-mix(in_srgb,var(--hc)_30%,var(--app-surface-2))]',
  '2': 'fill-[color-mix(in_srgb,var(--hc)_55%,var(--app-surface-2))]',
  '3': 'fill-[color-mix(in_srgb,var(--hc)_78%,var(--app-surface-2))]',
  '4': 'fill-(--hc)',
  s: 'fill-[url(#h-skip)] stroke-border stroke-[0.5]',
  o: 'fill-transparent stroke-border stroke-[0.75]',
}
const axisLabel = 'fill-muted font-sans [font-size:8px]'

export function Heatmap({ stats, habit }: { stats: Stats; habit: Habit }) {
  const { start, levels, values } = stats.heatmap
  const first = parseDayKey(start)
  const lead = (first.getDay() + 6) % 7 // rows are Mon..Sun
  const weeks = Math.ceil((lead + levels.length) / 7)
  const C = 11
  const G = 2
  const top = 14
  const left = 18
  const W = left + weeks * (C + G)
  const H = top + 7 * (C + G)
  const months: { x: number; label: string }[] = []
  let lastMonth = -1
  for (let w = 0; w < weeks; w++) {
    const d = addDays(first, w * 7 - lead + 6)
    if (d.getMonth() !== lastMonth && d.getDate() <= 7) {
      months.push({ x: left + w * (C + G), label: fmtDate(d, { month: 'short' }) })
      lastMonth = d.getMonth()
    }
  }
  const unit = habit.unit ? ' ' + habit.unit : ''
  return (
    <div className="grid gap-2 overflow-x-auto">
      <svg
        className="block h-auto w-full"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`${habit.name}: daily history for the last year`}
        style={{ minWidth: `${W / 16}rem` }}
      >
        <defs>
          <pattern id="h-skip" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="4" className="stroke-[color-mix(in_srgb,var(--app-muted)_50%,transparent)]" strokeWidth="1.5" />
          </pattern>
        </defs>
        {months.map((m) => (
          <text key={m.x} x={m.x} y={9} className={axisLabel}>
            {m.label}
          </text>
        ))}
        {[0, 2, 4].map((r) => (
          <text key={r} x={0} y={top + r * (C + G) + 9} className={axisLabel}>
            {['M', '', 'W', '', 'F'][r]}
          </text>
        ))}
        {Array.from(levels).map((ch, i) => {
          if (ch === '-') return null
          const n = i + lead
          const x = left + Math.floor(n / 7) * (C + G)
          const y = top + (n % 7) * (C + G)
          const d = addDays(first, i)
          const v = values[i]
          const desc =
            ch === 's' ? 'skipped' : ch === 'o' ? 'not scheduled' : v ? fmtNum(v) + (habit.kind === 'measurable' ? unit : '') : 'not done'
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: one cell per day of a fixed year; the index is the day
            <rect key={i} x={x} y={y} width={C} height={C} rx={2.5} className={LEVEL[ch]}>
              <title>{`${fmtDate(d, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}: ${desc}`}</title>
            </rect>
          )
        })}
      </svg>
      <div className="flex items-center justify-end gap-1.5 text-xs text-muted">
        Less{' '}
        <svg viewBox="0 0 66 11" width="4.125rem" height="0.6875rem" aria-hidden="true">
          {['0', '1', '2', '3', '4'].map((l, i) => (
            <rect key={l} x={i * 13} y={0} width={11} height={11} rx={2.5} className={LEVEL[l]} />
          ))}
        </svg>{' '}
        More
        <span className="ml-3 inline-flex items-center gap-1">
          <svg viewBox="0 0 11 11" width="0.6875rem" height="0.6875rem" aria-hidden="true">
            <rect width={11} height={11} rx={2.5} className={LEVEL.s} />
          </svg>{' '}
          Skipped
        </span>
      </div>
    </div>
  )
}

export function ScoreTrend({ points }: { points: { date: string; score: number }[] }) {
  const [hover, setHover] = useState<number | null>(null)
  const data = useMemo(() => points.slice(-120), [points])
  if (data.length < 2) return <div className="p-4 text-sm text-muted">Check in for a few days to see a trend.</div>
  const W = 320
  const H = 110
  const pad = { l: 22, r: 6, t: 8, b: 16 }
  const x = (i: number) => pad.l + (i / (data.length - 1)) * (W - pad.l - pad.r)
  const y = (v: number) => pad.t + (1 - v / 100) * (H - pad.t - pad.b)
  const line = data.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.score).toFixed(1)}`).join('')
  const area = `${line}L${x(data.length - 1)},${y(0)}L${x(0)},${y(0)}Z`
  const h = hover !== null ? data[hover] : null
  return (
    <svg
      className="block h-auto w-full"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={`Habit strength from ${Math.round(data[0].score)} to ${Math.round(data[data.length - 1].score)} out of 100`}
      onMouseMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect()
        const px = ((e.clientX - r.left) / r.width) * W
        setHover(Math.max(0, Math.min(data.length - 1, Math.round(((px - pad.l) / (W - pad.l - pad.r)) * (data.length - 1)))))
      }}
      onMouseLeave={() => setHover(null)}
    >
      {[0, 50, 100].map((v) => (
        <g key={v}>
          <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} className="stroke-border stroke-[0.5]" />
          <text x={pad.l - 4} y={y(v) + 3} textAnchor="end" className={axisLabel}>
            {v}
          </text>
        </g>
      ))}
      <path d={area} className="fill-[color-mix(in_srgb,var(--hc)_12%,transparent)]" />
      <path
        d={line}
        className="fill-none stroke-(--hc) stroke-2 [stroke-linecap:round] [stroke-linejoin:round] [vector-effect:non-scaling-stroke]"
      />
      <text x={pad.l} y={H - 3} className={axisLabel}>
        {fmtDate(parseDayKey(data[0].date))}
      </text>
      <text x={W - pad.r} y={H - 3} textAnchor="end" className={axisLabel}>
        {fmtDate(parseDayKey(data[data.length - 1].date))}
      </text>
      {h && hover !== null && (
        <g>
          <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={y(0)} className="stroke-muted stroke-[0.75] [stroke-dasharray:2_2]" />
          <circle cx={x(hover)} cy={y(h.score)} r={3.5} className="fill-(--hc) stroke-surface stroke-2" />
          <text
            x={Math.min(Math.max(x(hover), pad.l + 30), W - 40)}
            y={pad.t + 8}
            textAnchor="middle"
            className="fill-fg font-sans font-semibold [font-size:9px]"
          >
            {fmtDate(parseDayKey(h.date))}: {Math.round(h.score)}
          </text>
        </g>
      )}
    </svg>
  )
}
