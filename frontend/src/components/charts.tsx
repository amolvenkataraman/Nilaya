// Small single-series charts in plain SVG/CSS (one hue, thin marks, rounded data ends, values in
// text tokens, hover readouts). Larger chart sets live with their page.
import { useState } from 'react'

export function HBars({ items, format = (v) => String(v), max }: {
  items: { key: string | number; label: string; value: number; colour?: string; title?: string }[]
  format?: (v: number) => string
  max?: number
}) {
  const top = max ?? Math.max(1e-9, ...items.map((i) => i.value))
  return (
    <div className="hbars" role="list">
      {items.map((i) => (
        <div key={i.key} className="hbar" role="listitem" title={i.title ?? `${i.label}: ${format(i.value)}`}>
          <span className="hbar-label">{i.label}</span>
          <span className="hbar-track" aria-hidden="true">
            <span className="hbar-fill" style={{ width: `${(i.value / top) * 100}%`, ...(i.colour ? { ['--bar' as string]: i.colour } : {}) }} />
          </span>
          <span className="hbar-value">{format(i.value)}</span>
        </div>
      ))}
    </div>
  )
}

/** Thin vertical columns with labels under each and a value readout on hover/focus. Bars are SVG
 *  (stretched to the width); text is HTML so it never distorts. */
export function Columns({ values, labels, highlight, format = (v) => String(v), height = 72, title }: {
  values: number[]; labels: string[]; highlight?: number; format?: (v: number) => string; height?: number; title: string
}) {
  const [hover, setHover] = useState<number | null>(null)
  const n = values.length
  const W = 100 * n
  const H = 100
  const max = Math.max(1e-9, ...values)
  const bw = 34
  const shown = hover ?? highlight ?? null
  return (
    <figure className="cols" role="img" aria-label={`${title}: ${values.map((v, i) => `${labels[i]} ${format(v)}`).join(', ')}`} style={{ ['--n' as string]: n }}>
      <div className="cols-values" aria-hidden="true">
        {values.map((v, i) => <span key={i} className={i === shown && v > 0 ? 'on' : ''}>{v > 0 ? format(v) : ''}</span>)}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ height: `${(height - 30) / 16}rem` }} aria-hidden="true">
        {values.map((v, i) => {
          const h = v > 0 ? Math.max(3, (v / max) * H) : 0
          const x = i * 100 + (100 - bw) / 2
          return (
            <g key={i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect x={i * 100} y={0} width={100} height={H} fill="transparent" />
              {h > 0 && <rect className={'col' + (i === highlight ? ' hl' : '')} x={x} y={H - h} width={bw} height={h} rx={6} ry={4} />}
              {h > 6 && <rect className={'col' + (i === highlight ? ' hl' : '')} x={x} y={H - Math.min(h, 6)} width={bw} height={Math.min(h, 6)} />}
            </g>
          )
        })}
      </svg>
      <div className="cols-labels" aria-hidden="true">
        {labels.map((l, i) => <span key={i} className={i === highlight ? 'hl' : ''}>{l}</span>)}
      </div>
    </figure>
  )
}
