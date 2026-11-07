// Small single-series charts in plain SVG/CSS (one hue, thin marks, rounded data ends, values in
// text tokens, hover readouts). Larger chart sets live with their page.
import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'

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

/** Size of an element in whole CSS pixels, kept current with a ResizeObserver. */
export function useSize<T extends HTMLElement>() {
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
export function colPath(x: number, y: number, w: number, h: number, r = 3): string {
  if (h <= 0) return ''
  const rr = Math.min(r, w / 2, h)
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`
}

export interface ChartTip { x: number; y: number; text: string }
/** Hover/focus readout. Kept inside the plot: it flips to start or end alignment near the edges. */
export function ChartTooltip({ tip, width }: { tip: ChartTip | null; width?: number }) {
  if (!tip) return null
  const edge = width && tip.x < 70 ? ' start' : width && tip.x > width - 70 ? ' end' : ''
  return <div className={'chart-tip' + edge} style={{ left: tip.x, top: tip.y }} role="tooltip">{tip.text}</div>
}

/** Thin columns drawn in real (measured) pixels: rounded data ends, one hue, a tooltip per column on
 *  hover and on keyboard focus (arrow keys), and x labels thinned so they never overlap or leave the plot. */
export function PlotColumns({ values, labels, tips, highlight, labelEvery = 1, height = 88, title }: {
  values: number[]; labels: string[]; tips: string[]; highlight?: number; labelEvery?: number; height?: number; title?: string
}) {
  const [ref, { w }] = useSize<HTMLDivElement>()
  const [tip, setTip] = useState<ChartTip | null>(null)
  const [hover, setHover] = useState<number | null>(null)
  const max = Math.max(1e-9, ...values)
  const n = values.length
  const slot = n ? w / n : 0
  const bw = Math.max(1.5, Math.min(18, slot * (n > 14 ? 0.62 : 0.5)))
  const plotH = height - 4
  const top = (i: number) => plotH - (values[i] / max) * (plotH - 2)
  const show = (i: number | null) => {
    setHover(i)
    setTip(i == null ? null : { x: i * slot + slot / 2, y: Math.max(0, top(i) - 6), text: tips[i] })
  }
  // At least ~6.5px per character between label centres, so labels never collide.
  const longest = Math.max(1, ...labels.map((l) => l.length))
  const every = Math.max(labelEvery, slot ? Math.ceil((longest * 6.5 + 8) / slot) : 1)
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!n) return
    const step = { ArrowRight: 1, ArrowLeft: -1, Home: -n, End: n }[e.key]
    if (step == null) return
    e.preventDefault()
    show(Math.min(n - 1, Math.max(0, (hover ?? (step > 0 ? -1 : n)) + step)))
  }
  return (
    <div className="chart-cols-wrap">
      <div ref={ref} className="chart-cols" style={{ height }} tabIndex={0} aria-label={title ? `${title}. Use the arrow keys for values.` : undefined}
        onMouseLeave={() => show(null)} onBlur={() => show(null)} onKeyDown={onKey}>
        {w > 0 && (
          <svg width={w} height={height} role="img" aria-label={(title ? title + ': ' : '') + tips.join('; ')}>
            <line x1={0} x2={w} y1={plotH + 0.5} y2={plotH + 0.5} className="chart-base" />
            {values.map((v, i) => {
              const bh = (v / max) * (plotH - 2)
              const x = i * slot + (slot - bw) / 2
              return (
                <g key={i}>
                  <path d={colPath(x, plotH - bh, bw, bh)} className={'chart-mark' + (i === highlight ? ' strong' : '') + (hover != null && hover !== i ? ' dim' : '')} />
                  <rect x={i * slot} y={0} width={slot} height={height} fill="transparent" onMouseEnter={() => show(i)}>
                    <title>{tips[i]}</title>
                  </rect>
                </g>
              )
            })}
          </svg>
        )}
        <ChartTooltip tip={tip} width={w} />
      </div>
      <div className="chart-xlabels" aria-hidden="true">
        {w > 0 && labels.map((l, i) => {
          if (i % every !== 0 || !l) return null
          const left = i * slot + slot / 2
          // Centred under the column, but pushed back inside the plot at either end.
          return <span key={i} style={{ left, transform: `translateX(max(${-left}px, min(-50%, calc(${w - left}px - 100%))))` }}>{l}</span>
        })}
      </div>
    </div>
  )
}

/** One bar split into parts (each a share of the whole), with a readout per part. */
export function StackBar({ parts, label }: { parts: { key: string; value: number; className: string; label: string }[]; label: string }) {
  const total = parts.reduce((a, p) => a + Math.max(0, p.value), 0)
  return (
    <div className="stackbar" role="img" aria-label={label} title={label}>
      {total > 0 && parts.map((p) => p.value > 0 && (
        <span key={p.key} className={p.className} style={{ width: `${(p.value / total) * 100}%` }} />
      ))}
    </div>
  )
}
