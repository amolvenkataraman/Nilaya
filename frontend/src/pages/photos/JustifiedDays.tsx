// Justified photo rows in sections (days on the timeline, one block on a shared album), windowed: every row's
// height is known from the justify layout, so only the rows within ~1.5 screens of the viewport are in the DOM
// and the rest is empty space of the right height. A 10,000-photo scroll keeps a few hundred tiles mounted.
// Sections and rows are absolutely placed inside a box of the total height (no spacers to keep in sync);
// a section's header is measured once, since every header has the same height at a given width.
import { memo, type ReactNode, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { type Box, justify, type Row } from '../../lib/justify'
import type { Photo } from '../../lib/types'

export interface PhotoSection {
  key: string
  items: Photo[]
}

interface Placed {
  top: number
  rows: Row[]
  rowTops: number[]
  rowsH: number
  height: number
}

/** Scroll positions are rounded to this, so scrolling re-renders only every few rows. */
const STEP = 160

export function JustifiedDays<S extends PhotoSection>({
  sections,
  width,
  target,
  gap,
  sectionGap = 0,
  headerGuess = 0,
  renderHeader,
  renderTile,
  sectionClassName,
}: {
  /** Keep each section object stable while its photos don't change: its layout is cached on it. */
  sections: readonly S[]
  width: number
  target: number
  gap: number
  /** Space between sections, px. */
  sectionGap?: number
  /** Header height before one has been measured, px. */
  headerGuess?: number
  renderHeader?: (s: S) => ReactNode
  renderTile: (p: Photo, box: Box) => ReactNode
  sectionClassName?: string
}) {
  const box = useRef<HTMLDivElement>(null)
  const [headH, setHeadH] = useState(renderHeader ? headerGuess : 0)
  // Justify each section once per width/size; a new page only lays out the sections it added or changed.
  const cache = useRef(new WeakMap<S, { sig: string; rows: Row[] }>())
  const placed = useMemo(() => {
    const sig = `${width}:${target}:${gap}`
    let top = 0
    return sections.map((s): Placed => {
      let c = cache.current.get(s)
      if (!c || c.sig !== sig) {
        c = {
          sig,
          rows: justify(
            s.items.map((p) => p.aspect),
            width,
            target,
            gap,
          ),
        }
        cache.current.set(s, c)
      }
      const rowTops: number[] = []
      let y = 0
      for (const r of c.rows) {
        rowTops.push(y)
        y += r.height + gap
      }
      const rowsH = Math.max(0, y - gap)
      const p = { top, rows: c.rows, rowTops, rowsH, height: headH + rowsH }
      top += p.height + sectionGap
      return p
    })
  }, [sections, width, target, gap, headH, sectionGap])
  const total = placed.length ? placed[placed.length - 1].top + placed[placed.length - 1].height : 0

  // The window, in px from the top of the box.
  const [win, setWin] = useState({ y0: 0, y1: 0 })
  useLayoutEffect(() => {
    let frame = 0
    const update = () => {
      frame = 0
      const el = box.current
      if (!el) return
      const top = el.getBoundingClientRect().top
      const vh = window.innerHeight
      const y0 = Math.max(0, Math.floor((-top - vh * 1.5) / STEP) * STEP)
      const y1 = Math.ceil((-top + vh * 2.5) / STEP) * STEP
      setWin((w) => (w.y0 === y0 && w.y1 === y1 ? w : { y0, y1 }))
    }
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update)
    }
    update()
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    // Content above the box (a loading banner, the selection bar) moves it without a scroll.
    const ro = new ResizeObserver(schedule)
    if (box.current?.parentElement) ro.observe(box.current.parentElement)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      ro.disconnect()
    }
  }, [])

  // Measure the real header height once one is on screen (and again when the width changes).
  useLayoutEffect(() => {
    if (!renderHeader) return
    const h = box.current?.querySelector<HTMLElement>('[data-section-head]')?.offsetHeight
    if (h && Math.abs(h - headH) > 0.5) setHeadH(h)
  })

  const shown: ReactNode[] = []
  placed.forEach((p, i) => {
    if (p.top > win.y1 || p.top + p.height < win.y0) return
    const s = sections[i]
    // Rows of this section inside the window.
    const from = win.y0 - p.top - headH
    const to = win.y1 - p.top - headH
    let a = 0
    while (a < p.rows.length && p.rowTops[a] + p.rows[a].height < from) a++
    let b = a
    while (b < p.rows.length && p.rowTops[b] <= to) b++
    shown.push(
      <Section
        key={s.key}
        section={s}
        placed={p}
        from={a}
        to={b}
        gap={gap}
        header={renderHeader}
        tile={renderTile}
        className={sectionClassName}
      />,
    )
  })

  return (
    <div ref={box} className="relative" style={{ height: total }}>
      {shown}
    </div>
  )
}

function SectionInner<S extends PhotoSection>({
  section,
  placed,
  from,
  to,
  gap,
  header,
  tile,
  className,
}: {
  section: S
  placed: Placed
  from: number
  to: number
  gap: number
  header?: (s: S) => ReactNode
  tile: (p: Photo, box: Box) => ReactNode
  className?: string
}) {
  const rows = []
  for (let i = from; i < to; i++) {
    const r = placed.rows[i]
    rows.push(
      <div key={i} className="absolute inset-x-0 flex" style={{ top: placed.rowTops[i], height: r.height, gap }}>
        {r.boxes.map((b) => tile(section.items[b.index], b))}
      </div>,
    )
  }
  return (
    <section className={className ? `absolute inset-x-0 ${className}` : 'absolute inset-x-0'} style={{ top: placed.top }}>
      {header && (
        <div data-section-head className="flow-root">
          {header(section)}
        </div>
      )}
      <div className="relative" style={{ height: placed.rowsH }}>
        {rows}
      </div>
    </section>
  )
}
const Section = memo(SectionInner) as typeof SectionInner
